import assert from 'node:assert/strict'
import test from 'node:test'
import { createInviteFragment, parseInviteFragment } from '../../src/github/src/invite'

const payload = {
  group: 'Amici del Bar',
  repository: 'KeyserDSoze/Fantazone.Amici-del-Bar',
  email: 'Invitato@Example.com',
  sealed: 'base64-aes-gcm-envelope',
}

test('round-trips the current encrypted group invite and normalizes the login email', () => {
  const fragment = createInviteFragment(payload)
  assert.match(fragment, /^#invite=/)
  assert.deepEqual(parseInviteFragment(fragment), { ...payload, email: 'invitato@example.com' })
})

test('invite fragment never contains a plaintext PAT or a decryption key field', () => {
  const fragment = createInviteFragment(payload)
  const encoded = new URLSearchParams(fragment.replace(/^#/, '')).get('invite')!
  const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Record<string, unknown>

  assert.equal(decoded.sealed, payload.sealed)
  assert.equal('pat' in decoded, false)
  assert.equal('key' in decoded, false)
  assert.equal('v' in decoded, false)
})

test('rejects obsolete versioned invite shapes instead of maintaining compatibility branches', () => {
  const old = {
    v: 3,
    group: 'Amici del Bar',
    repository: 'KeyserDSoze/Fantazone.Amici-del-Bar',
    email: 'Invitato@Example.com',
    pat: 'github_pat_old',
  }
  const fragment = `#join=${Buffer.from(JSON.stringify(old)).toString('base64url')}`
  assert.equal(parseInviteFragment(fragment), null)
})

test('rejects malformed or incomplete encrypted invitations', () => {
  const incomplete = {
    group: 'Amici',
    repository: 'KeyserDSoze/Fantazone.Amici',
    email: 'invite@example.com',
  }
  const fragment = `#invite=${Buffer.from(JSON.stringify(incomplete)).toString('base64url')}`

  assert.equal(parseInviteFragment(fragment), null)
  assert.equal(parseInviteFragment('#screen=home'), null)
  assert.equal(parseInviteFragment('#invite=not-json'), null)
})
