import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stageMigrationRecords } from '../../scripts/migration/staging.mjs'

const groupRaw = { i: 'my-group', n: 'My Group', l: [], u: [], b: [] }
const teamRaw = {
  n: 'T', o: 'owner@example.com', a: [],
  p: [{ n: 'Mario Rossi', t: { n: 'Roma', a: 'ROM' }, r: 3, a: true, vh: true, p: 10, rv: 0, s: 0, k: 3 }],
  m: 0, d: null,
}
const masterPlayer = { n: 'Mario Rossi', t: { n: 'Roma', a: 'ROM' }, r: 3, a: true, vh: true }
const livePlayerWithoutTeam = {
  n: 'Mario Rossi', t: null, r: 0, a: false,
  v: { r: 3, v: 6.5, i: false, g: 1, p: 0, a: 0, s: 0, d: 0, w: 0, o: 0, t: 0, h: true, u: false, n: false, j: false, c: false },
}

const records = [
  { container: 'group', blobName: 'g', key: 'my-group', value: groupRaw },
  { container: 'team', blobName: 't', key: { g: 'my-group', y: 14, b: 'basket', e: 'owner@example.com' }, value: teamRaw },
  { container: 'realplayerswrapper', blobName: '14', key: 14, value: { p: [masterPlayer] } },
  { container: 'live', blobName: '14|||2', key: { y: 14, d: 2 }, value: { p: [livePlayerWithoutTeam] } },
]

function options(workDir, overrides = {}) {
  return {
    workDir,
    sourceFingerprint: 'source-a',
    groupRepository: 'owner/Fantazone.My-Group',
    platformRepository: 'owner/Fantazone',
    branch: 'main',
    ...overrides,
  }
}

async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'fantazone-staging-'))
  try { await fn(root) }
  finally { await rm(root, { recursive: true, force: true }) }
}

test('stages git-ready repository trees and enriches legacy live players with null team from RealPlayers master', async () => {
  await fixture(async workDir => {
    const result = await stageMigrationRecords(records, options(workDir))
    assert.equal(result.groupFiles.length, 2)
    assert.equal(result.platformFiles.length, 2)

    const livePath = join(workDir, 'platform-repo', 'data', 'serie-a', 'votes', 'live', '14', '2.json')
    const live = JSON.parse(await readFile(livePath, 'utf8'))
    assert.equal(live.players[0].team.name, 'Roma')
    assert.equal(live.players[0].role, 3)
    assert.equal(live.players[0].vote.value, 6.5)

    const state = JSON.parse(await readFile(join(workDir, 'state.json'), 'utf8'))
    assert.equal(state.status, 'ready')
    assert.equal(state.convertedRecords, 4)
    assert.equal(state.groupFiles, 2)
    assert.equal(state.platformFiles, 2)
  })
})

test('second run resumes every completed source record without reconverting it', async () => {
  await fixture(async workDir => {
    const first = await stageMigrationRecords(records, options(workDir))
    assert.equal(first.staging.convertedThisRun, 4)
    assert.equal(first.staging.resumed, 0)

    const second = await stageMigrationRecords(records, options(workDir))
    assert.equal(second.staging.convertedThisRun, 0)
    assert.equal(second.staging.resumed, 4)
    assert.equal(second.groupFiles.length, first.groupFiles.length)
    assert.equal(second.platformFiles.length, first.platformFiles.length)
  })
})

test('changed source record carries the previous staged content hash for safe target updates', async () => {
  await fixture(async workDir => {
    const first = await stageMigrationRecords(records, options(workDir))
    const originalTeam = first.groupFiles.find(file => file.source === 'team/t')
    assert.ok(originalTeam)

    const changedRecords = records.map(record => record.container === 'team'
      ? { ...record, value: { ...teamRaw, m: 25 } }
      : record)
    const second = await stageMigrationRecords(changedRecords, options(workDir))
    assert.equal(second.staging.convertedThisRun, 1)
    assert.equal(second.staging.resumed, 3)

    const changedTeam = second.groupFiles.find(file => file.source === 'team/t')
    assert.ok(changedTeam)
    assert.equal(typeof changedTeam.previousContentSha256, 'string')
    assert.equal(changedTeam.previousContentSha256.length, 64)
    assert.notEqual(changedTeam.content, originalTeam.content)
  })
})

test('missing staged output is rebuilt without discarding other checkpoints', async () => {
  await fixture(async workDir => {
    await stageMigrationRecords(records, options(workDir))
    const livePath = join(workDir, 'platform-repo', 'data', 'serie-a', 'votes', 'live', '14', '2.json')
    await rm(livePath, { force: true })

    const resumed = await stageMigrationRecords(records, options(workDir))
    assert.equal(resumed.staging.convertedThisRun, 1)
    assert.equal(resumed.staging.resumed, 3)
    const live = JSON.parse(await readFile(livePath, 'utf8'))
    assert.equal(live.players[0].team.name, 'Roma')
  })
})

test('staging refuses to mix a checkpoint with another target selection', async () => {
  await fixture(async workDir => {
    await stageMigrationRecords(records, options(workDir))
    await assert.rejects(
      stageMigrationRecords(records, options(workDir, { groupRepository: 'owner/Fantazone.Other' })),
      /belongs to another source\/target selection/,
    )
  })
})
