import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MICROSOFT_ACCESS_TOKEN_REFRESH_SKEW_MS,
  MICROSOFT_DEFAULT_ACCESS_TOKEN_LIFETIME_SECONDS,
  microsoftAccessTokenExpiresAt,
  microsoftAccessTokenNeedsRefresh,
} from '../../src/app/services/microsoftSessionPolicy'

test('Microsoft access token expiry uses the provider lifetime', () => {
  assert.equal(microsoftAccessTokenExpiresAt(3600, 1000), 1000 + 3600 * 1000)
})

test('Microsoft access token expiry falls back when lifetime is missing', () => {
  assert.equal(
    microsoftAccessTokenExpiresAt(undefined, 1000),
    1000 + MICROSOFT_DEFAULT_ACCESS_TOKEN_LIFETIME_SECONDS * 1000,
  )
})

test('Microsoft session refreshes before the access token actually expires', () => {
  const now = 1_000_000
  assert.equal(
    microsoftAccessTokenNeedsRefresh(now + MICROSOFT_ACCESS_TOKEN_REFRESH_SKEW_MS + 1, now),
    false,
  )
  assert.equal(
    microsoftAccessTokenNeedsRefresh(now + MICROSOFT_ACCESS_TOKEN_REFRESH_SKEW_MS, now),
    true,
  )
  assert.equal(microsoftAccessTokenNeedsRefresh(now - 1, now), true)
})
