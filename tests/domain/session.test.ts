import assert from 'node:assert/strict'
import test from 'node:test'
import {
  IdentityRole,
  createAuthenticatedGroupSession,
  resolveGroupLogin,
  type ExternalIdentity,
  type Group,
} from '../../src/domain/src/index'

const group: Group = {
  id: 'amici',
  name: 'Amici',
  leagues: [],
  baskets: [],
  users: [
    { username: 'Ale', email: 'Ale@example.com', role: IdentityRole.Participant | IdentityRole.Admin },
    { username: 'Old', email: 'old@example.com', role: IdentityRole.None },
  ],
}

const identity: ExternalIdentity = {
  provider: 'microsoft',
  subject: 'oidc-subject-123',
  email: 'ale@EXAMPLE.com',
  displayName: 'Alessandro',
}

test('authorizes an external identity only through membership of the selected group', () => {
  const result = resolveGroupLogin(group, identity)
  assert.equal(result.status, 'authorized')
  if (result.status === 'authorized') {
    assert.equal(result.member.username, 'Ale')
    assert.equal(result.identity.subject, 'oidc-subject-123')
  }
})

test('rejects a valid external identity that is not present in this group', () => {
  const result = resolveGroupLogin(group, { ...identity, email: 'other@example.com' })
  assert.equal(result.status, 'not-member')
  assert.equal(createAuthenticatedGroupSession(group, { ...identity, email: 'other@example.com' }), null)
})

test('rejects members explicitly disabled in the selected group JSON', () => {
  const result = resolveGroupLogin(group, { ...identity, email: 'OLD@example.com' })
  assert.equal(result.status, 'disabled')
})

test('an invite email is an additional constraint before group membership', () => {
  const result = resolveGroupLogin(group, identity, 'other@example.com')
  assert.equal(result.status, 'invite-email-mismatch')
  if (result.status === 'invite-email-mismatch') assert.equal(result.expectedEmail, 'other@example.com')
  assert.equal(createAuthenticatedGroupSession(group, identity, 'other@example.com'), null)
})

test('invite email comparison is normalized', () => {
  assert.equal(resolveGroupLogin(group, identity, ' ALE@example.COM ').status, 'authorized')
})
