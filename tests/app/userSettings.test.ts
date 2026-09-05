import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeUserSettings, emptyUserSettings, upsertStoredGroup } from '../../src/app/services/userSettingsOneDrive'

test('OneDrive user settings decode only valid version-1 groups', () => {
  const settings = decodeUserSettings({
    version: 1,
    groups: [
      { id: '1', name: 'Amici', repository: 'owner/Fantazone.Amici' },
      { id: '', name: 'broken', repository: '' },
    ],
  })
  assert.deepEqual(settings.groups, [{ id: '1', name: 'Amici', repository: 'owner/Fantazone.Amici' }])
})

test('unknown settings versions fail closed to an empty catalog', () => {
  assert.deepEqual(decodeUserSettings({ version: 2, groups: [] }), emptyUserSettings())
})

test('upsert keeps one entry per repository', () => {
  const updated = upsertStoredGroup(
    { version: 1, groups: [{ id: 'old', name: 'Old', repository: 'owner/Fantazone.Amici' }] },
    { id: 'new', name: 'Amici', repository: 'OWNER/fantazone.amici' },
  )
  assert.equal(updated.groups.length, 1)
  assert.equal(updated.groups[0].id, 'new')
})
