import assert from 'node:assert/strict'
import test from 'node:test'
import { decodePendingInvite } from '../../src/app/services/pendingGroupInvite'

test('restores an email-bound encrypted pending invitation', () => {
  assert.deepEqual(decodePendingInvite(JSON.stringify({
    mode: 'email',
    group: ' Amici del Bar ',
    repository: ' KeyserDSoze/Fantazone.Amici-del-Bar ',
    email: ' Invitato@Example.com ',
    salt: ' c2FsdC1mb3ItaW52aXRl ',
    iterations: 120000,
    sealed: ' aes-gcm-base64 ',
  })), {
    mode: 'email',
    group: 'Amici del Bar',
    repository: 'KeyserDSoze/Fantazone.Amici-del-Bar',
    email: 'invitato@example.com',
    salt: 'c2FsdC1mb3ItaW52aXRl',
    iterations: 120000,
    sealed: 'aes-gcm-base64',
  })
})

test('restores a generic shared-password invitation without an email', () => {
  assert.deepEqual(decodePendingInvite(JSON.stringify({
    mode: 'shared',
    group: 'Amici',
    repository: 'KeyserDSoze/Fantazone.Amici',
    salt: 'salt-base64',
    iterations: 120000,
    sealed: 'ciphertext',
  })), {
    mode: 'shared',
    group: 'Amici',
    repository: 'KeyserDSoze/Fantazone.Amici',
    salt: 'salt-base64',
    iterations: 120000,
    sealed: 'ciphertext',
  })
})

test('rejects the previous email-only pending invitation envelope', () => {
  assert.equal(decodePendingInvite(JSON.stringify({
    group: 'Amici',
    repository: 'KeyserDSoze/Fantazone.Amici',
    email: 'invite@example.com',
    sealed: 'ciphertext',
  })), null)
})

test('rejects malformed or inconsistent current payloads', () => {
  assert.equal(decodePendingInvite(JSON.stringify({
    mode: 'email',
    group: 'Amici',
    repository: 'KeyserDSoze/Fantazone.Amici',
    salt: 'salt',
    iterations: 120000,
    sealed: 'ciphertext',
  })), null)
  assert.equal(decodePendingInvite(JSON.stringify({
    mode: 'shared',
    group: 'Amici',
    repository: 'KeyserDSoze/Fantazone.Amici',
    email: 'unexpected@example.com',
    salt: 'salt',
    iterations: 120000,
    sealed: 'ciphertext',
  })), null)
  assert.equal(decodePendingInvite('{"group":"Amici"}'), null)
  assert.equal(decodePendingInvite('not-json'), null)
})
