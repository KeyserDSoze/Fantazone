import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeGroupName } from '../../src/github/src/githubClient'

test('normalizes a human group name to the Fantazone repository suffix', () => {
  assert.equal(normalizeGroupName('  Amici del Bar!  '), 'Amici-del-Bar')
  assert.equal(normalizeGroupName('Fanta è forte'), 'Fanta-e-forte')
  assert.equal(normalizeGroupName('.. Gruppo -- Uno ..'), 'Gruppo-Uno')
})

test('returns an empty suffix when a name has no supported repository characters', () => {
  assert.equal(normalizeGroupName('!!!'), '')
})
