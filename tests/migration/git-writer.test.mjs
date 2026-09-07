import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { writeFilesWithGit } from '../../scripts/migration/git-writer.mjs'

const execFile = promisify(execFileCallback)

async function git(args, cwd) {
  const result = await execFile('git', args, { cwd, windowsHide: true })
  return String(result.stdout ?? '').trim()
}

async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'fantazone-git-writer-'))
  try { await fn(root) }
  finally { await rm(root, { recursive: true, force: true }) }
}

async function createBareRemote(root) {
  const remote = join(root, 'remote.git')
  await git(['init', '--bare', '--initial-branch=main', remote], root)
  return remote
}

async function showRemoteFile(remote, path) {
  return git([`--git-dir=${remote}`, 'show', `main:${path}`])
}

function file(path, value) {
  return { path, content: `${JSON.stringify(value, null, 2)}\n`, source: `test/${path}` }
}

test('native git writer creates one commit and pushes staged files directly to main', async () => {
  await fixture(async root => {
    const remote = await createBareRemote(root)
    const result = await writeFilesWithGit({
      repository: 'owner/group', branch: 'main', remoteUrl: remote,
      gitRoot: join(root, 'transport'), mode: 'preserve',
      message: 'feat: migrate test data',
      files: [file('config/group.json', { id: 'g' }), file('data/value.json', { value: 1 })],
    })

    assert.equal(result.written, 2)
    assert.ok(result.commit)
    assert.equal(JSON.parse(await showRemoteFile(remote, 'config/group.json')).id, 'g')
    assert.equal(JSON.parse(await showRemoteFile(remote, 'data/value.json')).value, 1)

    const subjects = await git([`--git-dir=${remote}`, 'log', '--format=%s', 'main'])
    assert.equal(subjects, 'feat: migrate test data')
  })
})

test('preserve mode makes reruns idempotent and only commits paths still missing remotely', async () => {
  await fixture(async root => {
    const remote = await createBareRemote(root)
    const common = {
      repository: 'owner/group', branch: 'main', remoteUrl: remote,
      gitRoot: join(root, 'transport'), mode: 'preserve', message: 'feat: migrate test data',
    }

    await writeFilesWithGit({ ...common, files: [file('existing.json', { value: 1 })] })
    const second = await writeFilesWithGit({
      ...common,
      files: [file('existing.json', { value: 999 }), file('new.json', { value: 2 })],
    })

    assert.equal(second.planned, 1)
    assert.equal(second.written, 1)
    assert.deepEqual(second.collisions, ['existing.json'])
    assert.equal(JSON.parse(await showRemoteFile(remote, 'existing.json')).value, 1)
    assert.equal(JSON.parse(await showRemoteFile(remote, 'new.json')).value, 2)
  })
})

test('overwrite mode replaces an existing canonical path in a normal non-force commit', async () => {
  await fixture(async root => {
    const remote = await createBareRemote(root)
    const common = {
      repository: 'owner/group', branch: 'main', remoteUrl: remote,
      gitRoot: join(root, 'transport'), message: 'feat: migrate test data',
    }

    await writeFilesWithGit({ ...common, mode: 'preserve', files: [file('value.json', { value: 1 })] })
    const overwritten = await writeFilesWithGit({ ...common, mode: 'overwrite', files: [file('value.json', { value: 2 })] })

    assert.equal(overwritten.written, 1)
    assert.deepEqual(overwritten.collisions, ['value.json'])
    assert.equal(JSON.parse(await showRemoteFile(remote, 'value.json')).value, 2)
  })
})

test('transport clone is removed after completion and never becomes a second persistent migration state', async () => {
  await fixture(async root => {
    const remote = await createBareRemote(root)
    const gitRoot = join(root, 'transport')
    await writeFilesWithGit({
      repository: 'owner/group', branch: 'main', remoteUrl: remote,
      gitRoot, mode: 'preserve', message: 'feat: migrate test data', files: [file('value.json', { value: 1 })],
    })

    await assert.rejects(readFile(join(gitRoot, 'owner_group', '.git', 'config'), 'utf8'), error => error?.code === 'ENOENT')
  })
})
