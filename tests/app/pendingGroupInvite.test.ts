import assert from 'node:assert/strict'
import test from 'node:test'
import { decodePendingInvite } from '../../src/app/services/pendingGroupInvite'

test('restores a v3 pending invite with the shared group PAT', () => {
  assert.deepEqual(decodePendingInvite(JSON.stringify({
    v: 3,
    group: ' Amici del Bar ',
    repository: ' KeyserDSoze/Fantazone.Amici-del-Bar ',
    email: ' Invitato@Example.com ',
    pat: ' github_pat_shared ',
  })), {
    v: 3,
    group: 'Amici del Bar',
    repository: 'KeyserDSoze/Fantazone.Amici-del-Bar',
    email: 'invitato@example.com',
    pat: 'github_pat_shared',
  })
})

test('keeps legacy secret-free v2 pending invites readable', () => {
  assert.deepEqual(decodePendingInvite(JSON.stringify({
    v: 2,
    group: 'Amici',
    repository: 'KeyserDSoze/Fantazone.Amici',
    email: 'Invite@Example.com',
  })), {
    v: 2,
    group: 'Amici',
    repository: 'KeyserDSoze/Fantazone.Amici',
    email: 'invite@example.com',
  })
})

test('rejects malformed or incomplete shared-credential payloads', () => {
  assert.equal(decodePendingInvite(JSON.stringify({
    v: 3,
    group: 'Amici',
    repository: 'KeyserDSoze/Fantazone.Amici',
    email: 'invite@example.com',
  })), null)
  assert.equal(decodePendingInvite('{"v":2,"group":"Amici"}'), null)
  assert.equal(decodePendingInvite('not-json'), null)
})
