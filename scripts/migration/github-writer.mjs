import { createHash } from 'node:crypto'

const BOOTSTRAP_PATH = '.fantazone-migration-bootstrap'

function parseRepo(fullName) {
  const [owner, repo, ...rest] = String(fullName).split('/')
  if (!owner || !repo || rest.length) throw new Error(`Repository must be in owner/name form: '${fullName}'`)
  return { owner, repo }
}
function branchPath(branch) { return branch.split('/').map(encodeURIComponent).join('/') }
function contentFingerprint(content) { return createHash('sha256').update(content).digest('hex') }

export class GitHubApi {
  constructor(pat, fetchImpl = globalThis.fetch) {
    if (!pat?.trim()) throw new Error('GitHub PAT is required')
    this.pat = pat
    this.fetch = fetchImpl
  }
  async request(method, path, body) {
    const response = await this.fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json', Authorization: `Bearer ${this.pat}`,
        'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'fantazone-azure-migration',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    const parsed = text ? (() => { try { return JSON.parse(text) } catch { return { message: text } } })() : null
    if (!response.ok) {
      const error = new Error(`GitHub ${method} ${path} failed (${response.status}): ${parsed?.message ?? response.statusText}`)
      error.status = response.status
      throw error
    }
    return parsed
  }
}

export async function inspectRepository(api, repository, branchOption) {
  const { owner, repo } = parseRepo(repository)
  const metadata = await api.request('GET', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`)
  const defaultBranch = metadata.default_branch || 'main'
  const branch = branchOption || defaultBranch
  let ref = null
  try { ref = await api.request('GET', `/repos/${owner}/${repo}/git/ref/heads/${branchPath(branch)}`) }
  catch (error) { if (error.status !== 404 && error.status !== 409) throw error }
  return { owner, repo, branch, defaultBranch, empty: !ref, ref }
}

async function bootstrapEmptyRepository(api, info) {
  if (info.branch !== info.defaultBranch) throw new Error(`Empty repository '${info.owner}/${info.repo}' cannot be bootstrapped directly on custom branch '${info.branch}'. Use '${info.defaultBranch}' first.`)
  const content = Buffer.from('temporary bootstrap marker; safe to delete\n').toString('base64')
  await api.request('PUT', `/repos/${info.owner}/${info.repo}/contents/${BOOTSTRAP_PATH}`, {
    message: 'chore: bootstrap repository for migration', content, branch: info.defaultBranch,
  })
  return inspectRepository(api, `${info.owner}/${info.repo}`, info.branch)
}

async function currentTree(api, info) {
  const headSha = info.ref.object.sha
  const commit = await api.request('GET', `/repos/${info.owner}/${info.repo}/git/commits/${headSha}`)
  const tree = await api.request('GET', `/repos/${info.owner}/${info.repo}/git/trees/${commit.tree.sha}?recursive=1`)
  return { headSha, treeSha: commit.tree.sha, paths: new Map((tree.tree ?? []).filter(x => x.type === 'blob').map(x => [x.path, x.sha])) }
}

async function cleanupBootstrap(api, info) {
  try {
    const file = await api.request('GET', `/repos/${info.owner}/${info.repo}/contents/${BOOTSTRAP_PATH}?ref=${encodeURIComponent(info.branch)}`)
    if (file?.sha) await api.request('DELETE', `/repos/${info.owner}/${info.repo}/contents/${BOOTSTRAP_PATH}`, {
      message: 'chore: remove interrupted migration bootstrap marker', sha: file.sha, branch: info.branch,
    })
  } catch (error) { if (error.status !== 404) throw error }
}

export function selectFilesForCollisionMode(files, existingPaths, mode = 'fail') {
  const collisions = files.filter(file => existingPaths.has(file.path))
  if (mode === 'fail' && collisions.length) throw new Error(`Target repository already contains ${collisions.length} migration path(s): ${collisions.slice(0, 5).map(x => x.path).join(', ')}`)
  const forcedOverwrites = mode === 'preserve' ? collisions.filter(file => file.forceOverwrite === true) : []
  return {
    files: mode === 'preserve' ? files.filter(file => !existingPaths.has(file.path) || file.forceOverwrite === true) : files,
    collisions,
    forcedOverwrites,
  }
}

function decodeGitBlob(blob) {
  if (!blob?.content) return ''
  if (blob.encoding === 'base64') return Buffer.from(String(blob.content).replace(/\s/g, ''), 'base64').toString('utf8')
  return String(blob.content)
}

async function addSafePreserveUpdates(api, info, base, files, selection, mode) {
  if (mode !== 'preserve') return { ...selection, safeUpdates: [], preservedCollisions: [] }

  const safeUpdates = []
  for (const file of selection.collisions) {
    if (file.forceOverwrite === true || !file.previousContentSha256) continue
    const blobSha = base.paths.get(file.path)
    if (!blobSha) continue
    const blob = await api.request('GET', `/repos/${info.owner}/${info.repo}/git/blobs/${blobSha}`)
    if (contentFingerprint(decodeGitBlob(blob)) === file.previousContentSha256) safeUpdates.push(file)
  }

  const selectedPaths = new Set([...selection.files, ...safeUpdates].map(file => file.path))
  return {
    ...selection,
    files: files.filter(file => selectedPaths.has(file.path)),
    safeUpdates,
    preservedCollisions: selection.collisions.filter(file => !selectedPaths.has(file.path)),
  }
}

export async function writeFilesAtomically({ api, repository, branch, files, message, mode = 'fail', apply = false }) {
  if (!['fail', 'preserve', 'overwrite'].includes(mode)) throw new Error(`Invalid collision mode '${mode}'`)
  let info = await inspectRepository(api, repository, branch)
  let bootstrapped = false
  if (info.empty) {
    if (info.branch !== info.defaultBranch) throw new Error(`Empty repository '${info.owner}/${info.repo}' cannot be bootstrapped directly on custom branch '${info.branch}'. Use '${info.defaultBranch}' first.`)
    if (!apply) return {
      repository, branch: info.branch, empty: true, planned: files.length, written: 0,
      collisions: [], forcedOverwrites: [], safeUpdates: [], preservedCollisions: [],
    }
    info = await bootstrapEmptyRepository(api, info)
    bootstrapped = true
  }

  try {
    const base = await currentTree(api, info)
    const basicSelection = selectFilesForCollisionMode(files, base.paths, mode)
    const selection = await addSafePreserveUpdates(api, info, base, files, basicSelection, mode)
    if (!apply) return {
      repository, branch: info.branch, empty: false, planned: selection.files.length, written: 0,
      collisions: selection.collisions.map(x => x.path),
      forcedOverwrites: selection.forcedOverwrites.map(x => x.path),
      safeUpdates: selection.safeUpdates.map(x => x.path),
      preservedCollisions: selection.preservedCollisions.map(x => x.path),
    }

    const treeEntries = []
    for (const file of selection.files) {
      const blob = await api.request('POST', `/repos/${info.owner}/${info.repo}/git/blobs`, { content: file.content, encoding: 'utf-8' })
      treeEntries.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha })
    }
    if (base.paths.has(BOOTSTRAP_PATH)) treeEntries.push({ path: BOOTSTRAP_PATH, mode: '100644', type: 'blob', sha: null })
    if (!treeEntries.length) {
      if (base.paths.has(BOOTSTRAP_PATH)) await cleanupBootstrap(api, info)
      return {
        repository, branch: info.branch, planned: 0, written: 0,
        collisions: selection.collisions.map(x => x.path),
        forcedOverwrites: selection.forcedOverwrites.map(x => x.path),
        safeUpdates: selection.safeUpdates.map(x => x.path),
        preservedCollisions: selection.preservedCollisions.map(x => x.path),
        commit: null,
      }
    }
    const tree = await api.request('POST', `/repos/${info.owner}/${info.repo}/git/trees`, { base_tree: base.treeSha, tree: treeEntries })
    const commit = await api.request('POST', `/repos/${info.owner}/${info.repo}/git/commits`, { message, tree: tree.sha, parents: [base.headSha] })
    await api.request('PATCH', `/repos/${info.owner}/${info.repo}/git/refs/heads/${branchPath(info.branch)}`, { sha: commit.sha, force: false })
    return {
      repository, branch: info.branch, planned: selection.files.length, written: selection.files.length,
      collisions: selection.collisions.map(x => x.path),
      forcedOverwrites: selection.forcedOverwrites.map(x => x.path),
      safeUpdates: selection.safeUpdates.map(x => x.path),
      preservedCollisions: selection.preservedCollisions.map(x => x.path),
      commit: commit.sha,
    }
  } catch (error) {
    if (bootstrapped) {
      try { await cleanupBootstrap(api, info) } catch { /* preserve original migration error */ }
    }
    throw error
  }
}
