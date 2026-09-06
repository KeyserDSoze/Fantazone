import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createStoredGroup,
  decodeUserSettings,
  emptyUserSettings,
  removeStoredGroup,
  upsertStoredGroup,
} from '../../src/app/services/userSettingsOneDrive'

test('migrates valid version-1 groups into version 2 without inventing a PAT', () => {
  const settings = decodeUserSettings({
    version: 1,
    groups: [
      { id: '1', name: 'Amici', repository: 'owner/Fantazone.Amici' },
      { id: '', name: 'broken', repository: '' },
    ],
  })
  assert.equal(settings.version, 2)
  assert.deepEqual(settings.groups, [{ id: '1', name: 'Amici', repository: 'owner/Fantazone.Amici' }])
})

test('decodes and trims shared PATs from version-2 settings', () => {
  const settings = decodeUserSettings({
    version: 2,
    groups: [{
      id: ' group-1 ',
      name: ' Amici ',
      repository: ' owner/Fantazone.Amici ',
      pat: ' github_pat_shared ',
    }],
  })
  assert.deepEqual(settings, {
    version: 2,
    groups: [{ id: 'group-1', name: 'Amici', repository: 'owner/Fantazone.Amici', pat: 'github_pat_shared' }],
  })
})

test('unknown settings versions fail closed to an empty catalog', () => {
  assert.deepEqual(decodeUserSettings({ version: 3, groups: [] }), emptyUserSettings())
})

test('createStoredGroup persists a normalized shared PAT', () => {
  const stored = createStoredGroup({
    name: ' Amici ',
    repository: ' owner/Fantazone.Amici ',
    pat: ' github_pat_shared ',
  })
  assert.equal(stored.name, 'Amici')
  assert.equal(stored.repository, 'owner/Fantazone.Amici')
  assert.equal(stored.pat, 'github_pat_shared')
  assert.ok(stored.id)
})

test('upsert keeps one entry per repository and replaces the credential', () => {
  const updated = upsertStoredGroup(
    { version: 2, groups: [{ id: 'old', name: 'Old', repository: 'owner/Fantazone.Amici', pat: 'old-token' }] },
    { id: 'new', name: 'Amici', repository: 'OWNER/fantazone.amici', pat: 'new-token' },
  )
  assert.equal(updated.groups.length, 1)
  assert.equal(updated.groups[0].id, 'new')
  assert.equal(updated.groups[0].pat, 'new-token')
})

test('removeStoredGroup removes only the requested group without mutating the input', () => {
  const original = {
    version: 2 as const,
    groups: [
      { id: 'amici', name: 'Amici', repository: 'owner/Fantazone.Amici', pat: 'token-a' },
      { id: 'ufficio', name: 'Ufficio', repository: 'owner/Fantazone.Ufficio', pat: 'token-b' },
    ],
  }

  const updated = removeStoredGroup(original, ' amici ')

  assert.deepEqual(updated.groups, [
    { id: 'ufficio', name: 'Ufficio', repository: 'owner/Fantazone.Ufficio', pat: 'token-b' },
  ])
  assert.equal(original.groups.length, 2)
})

test('removeStoredGroup normalizes a legacy catalog even when group id is empty', () => {
  const settings = {
    version: 2 as const,
    groups: [{ id: 'amici', name: 'Amici', repository: 'owner/Fantazone.Amici', pat: 'token-a' }],
  }

  assert.deepEqual(removeStoredGroup(settings, '   '), settings)
})
