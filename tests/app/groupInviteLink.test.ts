import assert from 'node:assert/strict'
import test from 'node:test'
import { createInviteFragment } from '../../src/github/src/invite'
import {
  isValidInviteUnlockCode,
  isValidSharedInvitePassword,
  normalizeInviteUnlockCode,
  normalizeSharedInvitePassword,
  parseInviteLinkFragment,
} from '../../src/app/services/groupInviteLink'

const validCode = '2345-6789-ABCD-EFGH-JKLM-NPQR-STUV-WXYZ'

test('accepts the full 160-bit grouped unlock code and normalizes separators', () => {
  assert.equal(isValidInviteUnlockCode(validCode), true)
  assert.equal(
    normalizeInviteUnlockCode(' 2345 6789 abcd efgh jklm npqr stuv wxyz '),
    '23456789ABCDEFGHJKLMNPQRSTUVWXYZ',
  )
})

test('rejects short numeric OTPs and ambiguous alphabet characters', () => {
  assert.equal(isValidInviteUnlockCode('123456'), false)
  assert.equal(isValidInviteUnlockCode('2345-6789-ABCD-EFGH-IJKL-NPQR-STUV-WXYZ'), false)
})

test('validates shared group passwords independently from email unlock codes', () => {
  assert.equal(isValidSharedInvitePassword('una-password-lunga'), true)
  assert.equal(isValidSharedInvitePassword('troppo-corta'), false)
  assert.equal(normalizeSharedInvitePassword('  Password con spazi  '), 'Password con spazi')
})

test('parses both current invitation modes without loading native crypto', () => {
  const emailInvite = {
    mode: 'email' as const,
    group: 'Amici',
    repository: 'owner/repository',
    email: 'Invite@Example.com',
    salt: 'salt-base64',
    iterations: 120000,
    sealed: 'ciphertext-base64',
  }
  const sharedInvite = {
    mode: 'shared' as const,
    group: 'Amici',
    repository: 'owner/repository',
    salt: 'salt-base64',
    iterations: 120000,
    sealed: 'ciphertext-base64',
  }

  assert.deepEqual(parseInviteLinkFragment(createInviteFragment(emailInvite)), {
    ...emailInvite,
    email: 'invite@example.com',
  })
  assert.deepEqual(parseInviteLinkFragment(createInviteFragment(sharedInvite)), sharedInvite)
})

test('rejects the previous invitation envelope instead of loading compatibility code', () => {
  const oldInvite = {
    group: 'Amici',
    repository: 'owner/repository',
    email: 'invite@example.com',
    sealed: 'ciphertext-base64',
  }
  const fragment = `#invite=${Buffer.from(JSON.stringify(oldInvite)).toString('base64url')}`
  assert.equal(parseInviteLinkFragment(fragment), null)
  assert.equal(parseInviteLinkFragment('#join=obsolete'), null)
})
