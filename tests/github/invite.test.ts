import assert from 'node:assert/strict'
import test from 'node:test'
import { createInviteFragment, parseInviteFragment } from '../../src/github/src/invite'

const payload = {
  v: 1 as const,
  group: 'Amici del Bar',
  repository: 'Fantazone.Amici-del-Bar',
  pat: 'github_pat_test-value',
  owner: 'KeyserDSoze',
  email: 'Invitato@Example.com',
}

test('round-trips a group invite and normalizes the expected login email', () => {
  const fragment = createInviteFragment(payload)
  assert.match(fragment, /^#join=/)
  assert.deepEqual(parseInviteFragment(fragment), { ...payload, email: 'invitato@example.com' })
})

test('does not expose the raw PAT as plain fragment text', () => {
  const fragment = createInviteFragment(payload)
  assert.equal(fragment.includes(payload.pat), false)
})

test('keeps old invite links without an email readable', () => {
  const { email: _email, ...legacy } = payload
  assert.deepEqual(parseInviteFragment(createInviteFragment(legacy)), legacy)
})

test('ignores unrelated fragments', () => {
  assert.equal(parseInviteFragment('#screen=home'), null)
})
