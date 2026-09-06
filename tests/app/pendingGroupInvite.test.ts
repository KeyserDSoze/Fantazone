import assert from 'node:assert/strict'
import test from 'node:test'
import { decodePendingInvite } from '../../src/app/services/pendingGroupInvite'

test('restores only a sanitized v2 pending invite', () => {
  assert.deepEqual(decodePendingInvite(JSON.stringify({
    v: 2,
    group: ' Amici del Bar ',
    repository: 'KeyserDSoze/Fantazone.Amici-del-Bar',
    email: ' Invitato@Example.com ',
  })), {
    v: 2,
    group: 'Amici del Bar',
    repository: 'KeyserDSoze/Fantazone.Amici-del-Bar',
    email: 'invitato@example.com',
  })
})

test('rejects legacy or credential-bearing pending payloads instead of reviving them', () => {
  assert.equal(decodePendingInvite(JSON.stringify({
    v: 1,
    group: 'Amici',
    repository: 'KeyserDSoze/Fantazone.Amici',
    email: 'invite@example.com',
    pat: 'github_pat_secret',
  })), null)
})

test('rejects incomplete pending invites', () => {
  assert.equal(decodePendingInvite('{"v":2,"group":"Amici"}'), null)
  assert.equal(decodePendingInvite('not-json'), null)
})
