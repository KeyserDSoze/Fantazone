import assert from 'node:assert/strict'
import test from 'node:test'
import { createInviteFragment, parseInviteFragment } from '../../src/github/src/invite'

const payload = {
  v: 2 as const,
  group: 'Amici del Bar',
  repository: 'KeyserDSoze/Fantazone.Amici-del-Bar',
  email: 'Invitato@Example.com',
}

test('round-trips a secret-free group invite and normalizes the expected login email', () => {
  const fragment = createInviteFragment(payload)
  assert.match(fragment, /^#join=/)
  assert.deepEqual(parseInviteFragment(fragment), { ...payload, email: 'invitato@example.com' })
})

test('new invite payload contains no GitHub credential field', () => {
  const fragment = createInviteFragment(payload)
  const encoded = new URLSearchParams(fragment.replace(/^#/, '')).get('join')!
  const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Record<string, unknown>

  assert.equal('pat' in decoded, false)
  assert.equal('token' in decoded, false)
  assert.deepEqual(decoded, { ...payload, email: 'invitato@example.com' })
})

test('sanitizes a legacy v1 invite by discarding its embedded PAT', () => {
  const legacy = {
    v: 1,
    group: 'Amici del Bar',
    repository: 'Fantazone.Amici-del-Bar',
    owner: 'KeyserDSoze',
    pat: 'github_pat_legacy-secret',
    email: 'Invitato@Example.com',
  }
  const fragment = `#join=${Buffer.from(JSON.stringify(legacy)).toString('base64url')}`

  const parsed = parseInviteFragment(fragment)
  assert.deepEqual(parsed, {
    v: 2,
    group: 'Amici del Bar',
    repository: 'KeyserDSoze/Fantazone.Amici-del-Bar',
    email: 'invitato@example.com',
  })
  assert.equal('pat' in (parsed as unknown as Record<string, unknown>), false)
})

test('rejects legacy invites that cannot bind a verified email', () => {
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

test('ignores unrelated or malformed fragments', () => {
  assert.equal(parseInviteFragment('#screen=home'), null)
  assert.equal(parseInviteFragment('#join=not-json'), null)
})
