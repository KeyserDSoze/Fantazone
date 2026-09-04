import assert from 'node:assert/strict'
import test from 'node:test'
import { createInviteFragment, parseInviteFragment } from '../../src/github/src/invite'

const payload = {
  v: 1 as const,
  group: 'Amici del Bar',
  repository: 'Fantazone.Amici-del-Bar',
  pat: 'github_pat_test-value',
  owner: 'KeyserDSoze',
}

test('round-trips a group invite through a URL fragment payload', () => {
  const fragment = createInviteFragment(payload)
  assert.match(fragment, /^#join=/)
  assert.deepEqual(parseInviteFragment(fragment), payload)
})

test('does not expose the raw PAT as plain fragment text', () => {
  const fragment = createInviteFragment(payload)
  assert.equal(fragment.includes(payload.pat), false)
})

test('ignores unrelated fragments', () => {
  assert.equal(parseInviteFragment('#screen=home'), null)
})
