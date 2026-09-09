import assert from 'node:assert/strict'
import test from 'node:test'
import { decodePendingInvite } from '../../src/app/services/pendingGroupInvite'

test('restores only the current encrypted pending invite envelope', () => {
  assert.deepEqual(decodePendingInvite(JSON.stringify({
    group: ' Amici del Bar ',
    repository: ' KeyserDSoze/Fantazone.Amici-del-Bar ',
    email: ' Invitato@Example.com ',
    sealed: ' aes-gcm-base64 ',
  })), {
    group: 'Amici del Bar',
    repository: 'KeyserDSoze/Fantazone.Amici-del-Bar',
    email: 'invitato@example.com',
    sealed: 'aes-gcm-base64',
  })
})

test('rejects obsolete versioned pending invitations', () => {
  assert.equal(decodePendingInvite(JSON.stringify({
    v: 3,
    group: 'Amici',
    repository: 'KeyserDSoze/Fantazone.Amici',
    email: 'invite@example.com',
    pat: 'github_pat_old',
  })), null)
})

test('rejects malformed or incomplete encrypted payloads', () => {
  assert.equal(decodePendingInvite(JSON.stringify({
    group: 'Amici',
    repository: 'KeyserDSoze/Fantazone.Amici',
    email: 'invite@example.com',
  })), null)
  assert.equal(decodePendingInvite('{"group":"Amici"}'), null)
  assert.equal(decodePendingInvite('not-json'), null)
})
