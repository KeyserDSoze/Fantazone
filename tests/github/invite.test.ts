import assert from 'node:assert/strict'
import test from 'node:test'
import { createInviteFragment, parseInviteFragment } from '../../src/github/src/invite'

const emailPayload = {
  mode: 'email' as const,
  group: 'Amici del Bar',
  repository: 'KeyserDSoze/Fantazone.Amici-del-Bar',
  email: 'Invitato@Example.com',
  salt: 'c2FsdC1mb3ItaW52aXRl',
  iterations: 120_000,
  sealed: 'base64-aes-gcm-envelope',
}

const sharedPayload = {
  mode: 'shared' as const,
  group: 'Amici del Bar',
  repository: 'KeyserDSoze/Fantazone.Amici-del-Bar',
  salt: 'c2FsdC1mb3ItaW52aXRl',
  iterations: 120_000,
  sealed: 'base64-aes-gcm-envelope',
}

test('round-trips an email-bound invite and normalizes the login email', () => {
  const fragment = createInviteFragment(emailPayload)
  assert.match(fragment, /^#invite=/)
  assert.deepEqual(parseInviteFragment(fragment), { ...emailPayload, email: 'invitato@example.com' })
})

test('round-trips one generic shared-password invitation without an email binding', () => {
  const fragment = createInviteFragment(sharedPayload)
  assert.deepEqual(parseInviteFragment(fragment), sharedPayload)
})

test('invite fragment never contains a plaintext PAT or a decryption key field', () => {
  const fragment = createInviteFragment(sharedPayload)
  const encoded = new URLSearchParams(fragment.replace(/^#/, '')).get('invite')!
  const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Record<string, unknown>

  assert.equal(decoded.sealed, sharedPayload.sealed)
  assert.equal('pat' in decoded, false)
  assert.equal('key' in decoded, false)
  assert.equal('v' in decoded, false)
})

test('rejects the previous email-only envelope instead of maintaining compatibility branches', () => {
  const obsolete = {
    group: 'Amici',
    repository: 'KeyserDSoze/Fantazone.Amici',
    email: 'invite@example.com',
    sealed: 'ciphertext',
  }
  const fragment = `#invite=${Buffer.from(JSON.stringify(obsolete)).toString('base64url')}`
  assert.equal(parseInviteFragment(fragment), null)
})

test('rejects invalid mode-specific metadata', () => {
  const sharedWithEmail = { ...sharedPayload, email: 'unexpected@example.com' }
  const emailWithoutEmail = { ...emailPayload, email: undefined }
  const encode = (value: unknown) => `#invite=${Buffer.from(JSON.stringify(value)).toString('base64url')}`

  assert.equal(parseInviteFragment(encode(sharedWithEmail)), null)
  assert.equal(parseInviteFragment(encode(emailWithoutEmail)), null)
  assert.equal(parseInviteFragment(encode({ ...sharedPayload, iterations: 0 })), null)
  assert.equal(parseInviteFragment('#screen=home'), null)
  assert.equal(parseInviteFragment('#invite=not-json'), null)
})
