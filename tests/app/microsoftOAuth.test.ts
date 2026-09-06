import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildMicrosoftAuthorizationUrl,
  buildMicrosoftRefreshTokenRequestBody,
  buildMicrosoftTokenRequestBody,
  MICROSOFT_SCOPE,
  parseMicrosoftAuthorizationCallback,
} from '../../src/app/services/microsoftOAuth'

test('Microsoft authorize URL carries PKCE, offline App Folder scope and native redirect', () => {
  const url = new URL(buildMicrosoftAuthorizationUrl({
    authorityTenant: 'common',
    clientId: 'client-id',
    redirectUri: 'fantaplus://auth',
    state: 'state-1',
    nonce: 'nonce-1',
    codeChallenge: 'challenge-1',
    loginHint: ' Admin@Example.it ',
  }))

  assert.equal(url.origin, 'https://login.microsoftonline.com')
  assert.equal(url.pathname, '/common/oauth2/v2.0/authorize')
  assert.equal(url.searchParams.get('client_id'), 'client-id')
  assert.equal(url.searchParams.get('redirect_uri'), 'fantaplus://auth')
  assert.equal(url.searchParams.get('scope'), MICROSOFT_SCOPE)
  assert.match(MICROSOFT_SCOPE, /offline_access/)
  assert.match(MICROSOFT_SCOPE, /Files\.ReadWrite\.AppFolder/)
  assert.equal(url.searchParams.get('response_type'), 'code')
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(url.searchParams.get('code_challenge'), 'challenge-1')
  assert.equal(url.searchParams.get('state'), 'state-1')
  assert.equal(url.searchParams.get('nonce'), 'nonce-1')
  assert.equal(url.searchParams.get('prompt'), 'select_account')
  assert.equal(url.searchParams.get('login_hint'), 'admin@example.it')
})

test('Microsoft callback accepts only the matching state', () => {
  assert.equal(
    parseMicrosoftAuthorizationCallback('fantaplus://auth?code=abc&state=state-1', 'state-1'),
    'abc',
  )
  assert.throws(
    () => parseMicrosoftAuthorizationCallback('fantaplus://auth?code=abc&state=other', 'state-1'),
    /non corrisponde/,
  )
})

test('Microsoft token exchange reuses the exact redirect and verifier', () => {
  const body = new URLSearchParams(buildMicrosoftTokenRequestBody({
    clientId: 'client-id',
    code: 'code-1',
    redirectUri: 'fantaplus://auth',
    verifier: 'verifier-1',
  }))

  assert.equal(body.get('client_id'), 'client-id')
  assert.equal(body.get('code'), 'code-1')
  assert.equal(body.get('redirect_uri'), 'fantaplus://auth')
  assert.equal(body.get('code_verifier'), 'verifier-1')
  assert.equal(body.get('grant_type'), 'authorization_code')
  assert.equal(body.get('scope'), MICROSOFT_SCOPE)
})

test('Microsoft refresh grant rotates without resending a browser redirect', () => {
  const body = new URLSearchParams(buildMicrosoftRefreshTokenRequestBody({
    clientId: 'client-id',
    refreshToken: 'refresh-1',
  }))

  assert.equal(body.get('client_id'), 'client-id')
  assert.equal(body.get('refresh_token'), 'refresh-1')
  assert.equal(body.get('grant_type'), 'refresh_token')
  assert.equal(body.get('scope'), MICROSOFT_SCOPE)
  assert.equal(body.has('redirect_uri'), false)
})
