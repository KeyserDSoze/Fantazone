import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createStoredGroup,
  decodeUserSettings,
  emptyUserSettings,
  reconcileStoredGroup,
  removeStoredGroup,
  upsertStoredGroup,
} from '../../src/app/services/userSettingsOneDrive'

test('migrates valid version-1 groups into version 3 and defaults a single group', () => {
  const settings = decodeUserSettings({
    version: 1,
    groups: [
      { id: '1', name: 'Amici', repository: 'owner/Fantazone.Amici' },
      { id: '', name: 'broken', repository: '' },
    ],
  })
  assert.equal(settings.version, 3)
  assert.deepEqual(settings.groups, [{ id: '1', name: 'Amici', repository: 'owner/Fantazone.Amici', isDefault: true }])
})

test('decodes version-2 shared PATs and migrates them to version 3', () => {
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
    version: 3,
    groups: [{ id: 'group-1', name: 'Amici', repository: 'owner/Fantazone.Amici', pat: 'github_pat_shared', isDefault: true }],
  })
})

test('preserves one explicit default group when decoding version 3', () => {
  const settings = decodeUserSettings({
    version: 3,
    groups: [
      { id: 'a', name: 'A', repository: 'owner/a', isDefault: true },
      { id: 'b', name: 'B', repository: 'owner/b', isDefault: true },
    ],
  })

  assert.equal(settings.groups[0].isDefault, true)
  assert.equal(settings.groups[1].isDefault, undefined)
})

test('unknown settings versions fail closed to an empty catalog', () => {
  assert.deepEqual(decodeUserSettings({ version: 4, groups: [] }), emptyUserSettings())
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
    { version: 3, groups: [{ id: 'old', name: 'Old', repository: 'owner/Fantazone.Amici', pat: 'old-token', isDefault: true }] },
    { id: 'new', name: 'Amici', repository: 'OWNER/fantazone.amici', pat: 'new-token' },
  )
  assert.equal(updated.groups.length, 1)
  assert.equal(updated.groups[0].id, 'new')
  assert.equal(updated.groups[0].pat, 'new-token')
  assert.equal(updated.groups[0].isDefault, true)
})

test('making another group default clears the previous default', () => {
  const updated = upsertStoredGroup(
    {
      version: 3,
      groups: [
        { id: 'a', name: 'A', repository: 'owner/a', isDefault: true },
        { id: 'b', name: 'B', repository: 'owner/b' },
      ],
    },
    { id: 'b', name: 'B', repository: 'owner/b', isDefault: true },
  )

  assert.equal(updated.groups.find(group => group.id === 'a')?.isDefault, undefined)
  assert.equal(updated.groups.find(group => group.id === 'b')?.isDefault, true)
})

test('reconciles the per-user catalog name and default flag without changing the stable id', () => {
  const original = {
    version: 3 as const,
    groups: [{ id: 'amici', name: 'Vecchio nome', repository: 'owner/fantazone-data', pat: 'token-a' }],
  }

  const reconciled = reconcileStoredGroup(original, { ...original.groups[0], isDefault: true }, {
    name: ' Amici del Bar ',
    repository: 'owner/fantazone-data',
    pat: ' token-a ',
  })

  assert.equal(reconciled.changed, true)
  assert.deepEqual(reconciled.settings.groups, [
    { id: 'amici', name: 'Amici del Bar', repository: 'owner/fantazone-data', pat: 'token-a', isDefault: true },
  ])
  assert.equal(original.groups[0].name, 'Vecchio nome')
})

test('does not dirty the per-user catalog when the repository snapshot is unchanged', () => {
  const original = {
    version: 3 as const,
    groups: [{ id: 'amici', name: 'Amici del Bar', repository: 'owner/fantazone-data', pat: 'token-a', isDefault: true }],
  }

  const reconciled = reconcileStoredGroup(original, original.groups[0], {
    name: 'Amici del Bar',
    repository: 'owner/fantazone-data',
    pat: 'token-a',
  })

  assert.equal(reconciled.changed, false)
  assert.deepEqual(reconciled.settings, original)
})

test('removeStoredGroup promotes the sole remaining group to default', () => {
  const original = {
    version: 3 as const,
    groups: [
      { id: 'amici', name: 'Amici', repository: 'owner/Fantazone.Amici', pat: 'token-a', isDefault: true },
      { id: 'ufficio', name: 'Ufficio', repository: 'owner/Fantazone.Ufficio', pat: 'token-b' },
    ],
  }

  const updated = removeStoredGroup(original, ' amici ')

  assert.deepEqual(updated.groups, [
    { id: 'ufficio', name: 'Ufficio', repository: 'owner/Fantazone.Ufficio', pat: 'token-b', isDefault: true },
  ])
  assert.equal(original.groups.length, 2)
})

test('removeStoredGroup normalizes a legacy catalog even when group id is empty', () => {
  const settings = {
    version: 3 as const,
    groups: [{ id: 'amici', name: 'Amici', repository: 'owner/Fantazone.Amici', pat: 'token-a', isDefault: true }],
  }

  assert.deepEqual(removeStoredGroup(settings, '   '), settings)
})
