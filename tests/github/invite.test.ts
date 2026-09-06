import assert from 'node:assert/strict'
import test from 'node:test'
import { createInviteFragment, parseInviteFragment } from '../../src/github/src/invite'

const payload = {
  v: 3 as const,
  group: 'Amici del Bar',
  repository: 'KeyserDSoze/Fantazone.Amici-del-Bar',
  email: 'Invitato@Example.com',
  pat: 'github_pat_shared-secret',
}

test('round-trips a shared-credential group invite and normalizes the expected login email', () => {
  const fragment = createInviteFragment(payload)
  assert.match(fragment, /^#join=/)
  assert.deepEqual(parseInviteFragment(fragment), { ...payload, email: 'invitato@example.com' })
})

test('new invite payload carries the shared group PAT intentionally', () => {
  const fragment = createInviteFragment(payload)
  const encoded = new URLSearchParams(fragment.replace(/^#/, '')).get('join')!
  const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Record<string, unknown>

  assert.equal(decoded.pat, 'github_pat_shared-secret')
  assert.equal(decoded.v, 3)
  assert.equal('token' in decoded, false)
})

test('keeps old secret-free v2 invites readable for manual credential migration', () => {
  const old = {
    v: 2,
    group: 'Amici del Bar',
    repository: 'KeyserDSoze/Fantazone.Amici-del-Bar',
    email: 'Invitato@Example.com',
  }
  const fragment = `#join=${Buffer.from(JSON.stringify(old)).toString('base64url')}`
  assert.deepEqual(parseInviteFragment(fragment), {
    ...old,
    v: 2,
    email: 'invitato@example.com',
  })
})

test('normalizes a legacy v1 invite and preserves its shared PAT', () => {
  const legacy = {
    v: 1,
    group: 'Amici del Bar',
    repository: 'Fantazone.Amici-del-Bar',
    owner: 'KeyserDSoze',
    pat: 'github_pat_legacy-secret',
    email: 'Invitato@Example.com',
  }
  const fragment = `#join=${Buffer.from(JSON.stringify(legacy)).toString('base64url')}`

  assert.deepEqual(parseInviteFragment(fragment), {
    v: 3,
    group: 'Amici del Bar',
    repository: 'KeyserDSoze/Fantazone.Amici-del-Bar',
    email: 'invitato@example.com',
    pat: 'github_pat_legacy-secret',
  })
})

test('rejects credential invites that cannot bind a verified email', () => {
  const legacy = {
    v: 1,
    group: 'Amici del Bar',
    repository: 'Fantazone.Amici-del-Bar',
    owner: 'KeyserDSoze',
    pat: 'github_pat_legacy-secret',
  }
  const fragment = `#join=${Buffer.from(JSON.stringify(legacy)).toString('base64url')}`
  assert.equal(parseInviteFragment(fragment), null)
})

test('rejects v3 invites without the shared PAT', () => {
  const invalid = {
    v: 3,
    group: 'Amici',
    repository: 'KeyserDSoze/Fantazone.Amici',
    email: 'invite@example.com',
  }
  const fragment = `#join=${Buffer.from(JSON.stringify(invalid)).toString('base64url')}`
  assert.equal(parseInviteFragment(fragment), null)
})

test('ignores unrelated or malformed fragments', () => {
  assert.equal(parseInviteFragment('#screen=home'), null)
  assert.equal(parseInviteFragment('#join=not-json'), null)
})
