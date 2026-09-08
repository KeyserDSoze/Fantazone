import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
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

function file(path, value, extra = {}) {
  return { path, content: `${JSON.stringify(value, null, 2)}\n`, source: `test/${path}`, ...extra }
}
function sha256(content) { return createHash('sha256').update(content).digest('hex') }

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
    assert.deepEqual(second.forcedOverwrites, [])
    assert.deepEqual(second.safeUpdates, [])
    assert.deepEqual(second.preservedCollisions, ['existing.json'])
    assert.equal(JSON.parse(await showRemoteFile(remote, 'existing.json')).value, 1)
    assert.equal(JSON.parse(await showRemoteFile(remote, 'new.json')).value, 2)
  })
})

test('preserve mode safely updates a changed Azure record when GitHub still matches the previous import', async () => {
  await fixture(async root => {
    const remote = await createBareRemote(root)
    const common = {
      repository: 'owner/group', branch: 'main', remoteUrl: remote,
      gitRoot: join(root, 'transport'), mode: 'preserve', message: 'feat: sync changed legacy data',
    }
    const previous = file('value.json', { value: 1 })
    await writeFilesWithGit({ ...common, files: [previous] })

    const updated = file('value.json', { value: 2 }, { previousContentSha256: sha256(previous.content) })
    const result = await writeFilesWithGit({ ...common, files: [updated] })

    assert.equal(result.planned, 1)
    assert.equal(result.written, 1)
    assert.deepEqual(result.safeUpdates, ['value.json'])
    assert.deepEqual(result.preservedCollisions, [])
    assert.equal(JSON.parse(await showRemoteFile(remote, 'value.json')).value, 2)
  })
})

test('preserve mode does not overwrite a target that diverged after the previous import', async () => {
  await fixture(async root => {
    const remote = await createBareRemote(root)
    const common = {
      repository: 'owner/group', branch: 'main', remoteUrl: remote,
      gitRoot: join(root, 'transport'), message: 'test data',
    }
    const previous = file('value.json', { value: 1 })
    await writeFilesWithGit({ ...common, mode: 'preserve', files: [previous] })
    await writeFilesWithGit({ ...common, mode: 'overwrite', files: [file('value.json', { value: 99 })] })

    const incoming = file('value.json', { value: 2 }, { previousContentSha256: sha256(previous.content) })
    const result = await writeFilesWithGit({ ...common, mode: 'preserve', files: [incoming] })

    assert.equal(result.planned, 0)
    assert.equal(result.written, 0)
    assert.deepEqual(result.safeUpdates, [])
    assert.deepEqual(result.preservedCollisions, ['value.json'])
    assert.equal(JSON.parse(await showRemoteFile(remote, 'value.json')).value, 99)
  })
})

test('preserve mode can explicitly overwrite one proven repair without opening every collision', async () => {
  await fixture(async root => {
    const remote = await createBareRemote(root)
    const common = {
      repository: 'owner/group', branch: 'main', remoteUrl: remote,
      gitRoot: join(root, 'transport'), mode: 'preserve', message: 'fix: repair imported calendar',
    }

    await writeFilesWithGit({
      ...common,
      files: [file('calendar.json', { year: 0 }), file('untouched.json', { value: 1 })],
    })
    const repaired = await writeFilesWithGit({
      ...common,
      files: [
        file('calendar.json', { year: 13 }, { forceOverwrite: true }),
        file('untouched.json', { value: 999 }),
        file('new.json', { value: 2 }),
      ],
    })

    assert.equal(repaired.planned, 2)
    assert.equal(repaired.written, 2)
    assert.deepEqual(repaired.forcedOverwrites, ['calendar.json'])
    assert.equal(JSON.parse(await showRemoteFile(remote, 'calendar.json')).year, 13)
    assert.equal(JSON.parse(await showRemoteFile(remote, 'untouched.json')).value, 1)
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
