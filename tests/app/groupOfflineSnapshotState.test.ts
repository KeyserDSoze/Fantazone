import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decodeGroupOfflineSnapshotState,
  shouldRefreshGroupOfflineSnapshot,
} from '../../src/app/services/groupOfflineSnapshotState'

test('refreshes when no successful offline snapshot revision has been recorded', () => {
  assert.equal(shouldRefreshGroupOfflineSnapshot(null, 12), true)
})

test('skips the group pack when the recorded offline snapshot revision is current', () => {
  const state = decodeGroupOfflineSnapshotState({ version: 1, revision: 12, documents: 9607, bytes: 123456 })
  assert.ok(state)
  assert.equal(shouldRefreshGroupOfflineSnapshot(state, 12), false)
})

test('refreshes when the repository revision changed', () => {
  const state = decodeGroupOfflineSnapshotState({ version: 1, revision: 12, documents: 9607, bytes: 123456 })
  assert.ok(state)
  assert.equal(shouldRefreshGroupOfflineSnapshot(state, 13), true)
})

test('rejects malformed snapshot state instead of trusting it', () => {
  assert.equal(decodeGroupOfflineSnapshotState({ version: 1, revision: -1, documents: 10, bytes: 100 }), null)
  assert.equal(decodeGroupOfflineSnapshotState({ version: 2, revision: 1, documents: 10, bytes: 100 }), null)
})
