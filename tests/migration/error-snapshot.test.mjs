import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clearMigrationErrorSnapshot,
  diagnosticDestination,
  migrationErrorSnapshotPath,
  writeMigrationErrorSnapshot,
} from '../../scripts/migration/error-snapshot.mjs'

const failingRecord = {
  container: 'team',
  blobName: 'group|||10|||basket|||owner@example.com',
  key: { g: 'group', y: 10, b: 'basket', e: 'owner@example.com' },
  value: {
    n: 'Legacy Team',
    o: 'owner@example.com',
    p: [{ n: '', p: 7, rv: 0, s: 0, k: 3 }],
  },
}

async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'fantazone-error-snapshot-'))
  try { await fn(root) }
  finally { await rm(root, { recursive: true, force: true }) }
}

test('derives destination path from key without parsing the legacy value', () => {
  assert.deepEqual(diagnosticDestination(failingRecord), {
    target: 'group',
    path: 'data/groups/seasons/10/teams/basket/owner@example.com.json',
  })
})

test('writes last-error.json with raw key/value and no credentials', async () => {
  await fixture(async workDir => {
    await writeFile(join(workDir, 'state.json'), `${JSON.stringify({
      status: 'failed',
      currentRecord: 'team/group|||10|||basket|||owner@example.com',
      totalRecords: 10420,
      processedRecords: 9325,
      convertedRecords: 9325,
      skippedRecords: 0,
      resumedRecords: 9000,
      groupFiles: 9212,
      platformFiles: 113,
      identity: { selectedGroupId: 'group' },
    })}\n`, 'utf8')

    const target = await writeMigrationErrorSnapshot({
      workDir,
      records: [failingRecord],
      args: {
        groupRepository: 'owner/Fantazone.Group',
        platformRepository: 'owner/Fantazone',
        branch: 'main',
      },
      error: new Error("Player '' does not produce a valid legacy player key"),
    })

    assert.equal(target, migrationErrorSnapshotPath(workDir))
    const snapshot = JSON.parse(await readFile(target, 'utf8'))
    assert.equal(snapshot.source.recordId, 'team/group|||10|||basket|||owner@example.com')
    assert.deepEqual(snapshot.source.key, failingRecord.key)
    assert.deepEqual(snapshot.source.value, failingRecord.value)
    assert.equal(snapshot.source.sourcePath, `team/${failingRecord.blobName}`)
    assert.equal(snapshot.destination.path, 'data/groups/seasons/10/teams/basket/owner@example.com.json')
    assert.equal(snapshot.progress.processedRecords, 9325)
    assert.equal(snapshot.migration.selectedGroupId, 'group')
    assert.equal(snapshot.error.message, "Player '' does not produce a valid legacy player key")

    const serialized = JSON.stringify(snapshot)
    assert.equal(serialized.includes('FANTAZONE_GROUP_PAT'), false)
    assert.equal(serialized.includes('FANTAZONE_AZURE_CONNECTION_STRING'), false)
  })
})

test('successful completion can remove a stale last-error.json', async () => {
  await fixture(async workDir => {
    const target = migrationErrorSnapshotPath(workDir)
    await writeFile(target, '{}\n', 'utf8')
    await clearMigrationErrorSnapshot(workDir)
    await assert.rejects(readFile(target, 'utf8'), error => error?.code === 'ENOENT')
  })
})
