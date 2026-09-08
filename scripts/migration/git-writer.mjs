import { createHash } from 'node:crypto'
import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

function parseRepo(fullName) {
  const [owner, repo, ...rest] = String(fullName).split('/')
  if (!owner || !repo || rest.length) throw new Error(`Repository must be in owner/name form: '${fullName}'`)
  return { owner, repo }
}

function safeDirectoryName(value) {
  return String(value).replace(/[^a-z0-9._-]+/gi, '_')
}

function safeOutputPath(root, relativePath) {
  const base = resolve(root)
  const target = resolve(base, ...String(relativePath).split('/'))
  if (target !== base && !target.startsWith(`${base}${sep}`)) throw new Error(`Unsafe git target path '${relativePath}'`)
  return target
}

function contentFingerprint(content) {
  return createHash('sha256').update(content).digest('hex')
}

function redact(value, secret) {
  const text = String(value ?? '')
  return secret ? text.split(secret).join('[REDACTED]') : text
}

function gitEnvironment(pat) {
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'Never',
    GIT_TRACE: '0',
    GIT_TRACE_CURL: '0',
    GIT_CURL_VERBOSE: '0',
  }
  if (pat) {
    env.GIT_CONFIG_COUNT = '1'
    env.GIT_CONFIG_KEY_0 = 'http.https://github.com/.extraHeader'
    env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${pat}`).toString('base64')}`
  } else {
    delete env.GIT_CONFIG_COUNT
    delete env.GIT_CONFIG_KEY_0
    delete env.GIT_CONFIG_VALUE_0
  }
  return env
}

async function runGit(args, { cwd, pat, allowFailure = false } = {}) {
  try {
    const result = await execFile('git', args, {
      cwd,
      env: gitEnvironment(pat),
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    })
    return { ok: true, stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? '') }
  } catch (error) {
    if (allowFailure) {
      return {
        ok: false,
        code: error.code,
        stdout: String(error.stdout ?? ''),
        stderr: String(error.stderr ?? ''),
      }
    }
    const detail = redact(error.stderr || error.stdout || error.message, pat).trim()
    const command = ['git', ...args].map(value => String(value)).join(' ')
    throw new Error(`${command} failed${detail ? `: ${detail}` : ''}`)
  }
}

async function ensureGitIdentity(repoDir, pat) {
  const name = await runGit(['config', '--get', 'user.name'], { cwd: repoDir, pat, allowFailure: true })
  if (!name.ok || !name.stdout.trim()) await runGit(['config', 'user.name', 'Fantazone Migration'], { cwd: repoDir, pat })
  const email = await runGit(['config', '--get', 'user.email'], { cwd: repoDir, pat, allowFailure: true })
  if (!email.ok || !email.stdout.trim()) await runGit(['config', 'user.email', 'migration@fantazone.local'], { cwd: repoDir, pat })
}

async function checkoutTargetBranch(repoDir, branch, pat) {
  await runGit(['check-ref-format', '--branch', branch], { cwd: repoDir, pat })
  const remoteRef = await runGit(['rev-parse', '--verify', `refs/remotes/origin/${branch}`], { cwd: repoDir, pat, allowFailure: true })
  if (remoteRef.ok) {
    await runGit(['checkout', '--quiet', '-B', branch, `origin/${branch}`], { cwd: repoDir, pat })
    return
  }

  const commits = await runGit(['rev-list', '--all', '--count'], { cwd: repoDir, pat })
  if (Number(commits.stdout.trim() || 0) > 0) {
    throw new Error(`Target branch '${branch}' does not exist, but the repository is not empty. Refusing to create it implicitly.`)
  }

  const current = await runGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: repoDir, pat, allowFailure: true })
  if (current.ok && current.stdout.trim() === branch) return
  await runGit(['checkout', '--quiet', '--orphan', branch], { cwd: repoDir, pat })
}

async function selectFiles(files, repoDir, existingPaths, mode) {
  const collisions = files.filter(file => existingPaths.has(file.path))
  if (mode === 'fail' && collisions.length) {
    throw new Error(`Target repository already contains ${collisions.length} migration path(s): ${collisions.slice(0, 5).map(file => file.path).join(', ')}`)
  }
  if (mode !== 'preserve') {
    return { files, collisions, forcedOverwrites: [], safeUpdates: [], preservedCollisions: [] }
  }

  const forcedOverwrites = collisions.filter(file => file.forceOverwrite === true)
  const safeUpdates = []
  for (const file of collisions) {
    if (file.forceOverwrite === true || !file.previousContentSha256) continue
    const currentContent = await readFile(safeOutputPath(repoDir, file.path), 'utf8')
    if (contentFingerprint(currentContent) === file.previousContentSha256) safeUpdates.push(file)
  }

  const selectedCollisionPaths = new Set([...forcedOverwrites, ...safeUpdates].map(file => file.path))
  const selected = files.filter(file => !existingPaths.has(file.path) || selectedCollisionPaths.has(file.path))
  const preservedCollisions = collisions.filter(file => !selectedCollisionPaths.has(file.path))
  return { files: selected, collisions, forcedOverwrites, safeUpdates, preservedCollisions }
}

async function writeSelectedFiles(repoDir, files) {
  for (const file of files) {
    const target = safeOutputPath(repoDir, file.path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, file.content, 'utf8')
  }
}

/**
 * Apply one staged repository tree with native git. The remote is cloned into an isolated
 * migration-output directory, the selected files are committed once, then pushed non-force.
 * In preserve mode a changed Azure record is updated automatically only when the current
 * target still matches the previous staged content hash. Diverged target files stay preserved.
 */
export async function writeFilesWithGit({
  repository,
  branch = 'main',
  files,
  message,
  mode = 'fail',
  pat,
  gitRoot,
  remoteUrl,
  onProgress,
}) {
  if (!['fail', 'preserve', 'overwrite'].includes(mode)) throw new Error(`Invalid collision mode '${mode}'`)
  if (!Array.isArray(files)) throw new Error('files must be an array')
  const { owner, repo } = parseRepo(repository)
  const remote = remoteUrl ?? `https://github.com/${owner}/${repo}.git`
  if (!remoteUrl && !pat?.trim()) throw new Error(`GitHub PAT is required for '${repository}'`)
  const root = resolve(gitRoot)
  const repoDir = resolve(root, safeDirectoryName(repository))

  await rm(repoDir, { recursive: true, force: true })
  await mkdir(root, { recursive: true })
  onProgress?.({ type: 'clone', repository, branch, path: repoDir })

  try {
    await runGit(['clone', '--quiet', '--no-tags', remote, repoDir], { pat })
    await checkoutTargetBranch(repoDir, branch, pat)
    await ensureGitIdentity(repoDir, pat)

    const listed = await runGit(['ls-files', '-z'], { cwd: repoDir, pat })
    const existingPaths = new Set(listed.stdout.split('\0').filter(Boolean))
    const selection = await selectFiles(files, repoDir, existingPaths, mode)
    onProgress?.({
      type: 'selection', repository, branch,
      total: files.length, selected: selection.files.length, collisions: selection.collisions.length,
      forcedOverwrites: selection.forcedOverwrites.length,
      safeUpdates: selection.safeUpdates.length,
      preservedCollisions: selection.preservedCollisions.length,
    })

    await writeSelectedFiles(repoDir, selection.files)
    await runGit(['add', '-A'], { cwd: repoDir, pat })
    const changedResult = await runGit(['diff', '--cached', '--name-only', '-z'], { cwd: repoDir, pat })
    const changed = changedResult.stdout.split('\0').filter(Boolean)

    if (!changed.length) {
      onProgress?.({ type: 'complete', repository, branch, commit: null, written: 0 })
      return {
        repository,
        branch,
        planned: selection.files.length,
        written: 0,
        collisions: selection.collisions.map(file => file.path),
        forcedOverwrites: selection.forcedOverwrites.map(file => file.path),
        safeUpdates: selection.safeUpdates.map(file => file.path),
        preservedCollisions: selection.preservedCollisions.map(file => file.path),
        commit: null,
      }
    }

    onProgress?.({ type: 'commit', repository, branch, changed: changed.length })
    await runGit(['commit', '--quiet', '-m', message], { cwd: repoDir, pat })
    const commit = (await runGit(['rev-parse', 'HEAD'], { cwd: repoDir, pat })).stdout.trim()

    onProgress?.({ type: 'push', repository, branch, commit })
    await runGit(['push', '--quiet', 'origin', `HEAD:refs/heads/${branch}`], { cwd: repoDir, pat })
    onProgress?.({ type: 'complete', repository, branch, commit, written: changed.length })

    return {
      repository,
      branch,
      planned: selection.files.length,
      written: changed.length,
      collisions: selection.collisions.map(file => file.path),
      forcedOverwrites: selection.forcedOverwrites.map(file => file.path),
      safeUpdates: selection.safeUpdates.map(file => file.path),
      preservedCollisions: selection.preservedCollisions.map(file => file.path),
      commit,
    }
  } finally {
    await rm(repoDir, { recursive: true, force: true }).catch(() => {})
  }
}
