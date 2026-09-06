import type { ExternalIdentity, ExternalIdentityProvider } from '@fantazone/domain'
import * as Crypto from 'expo-crypto'
import {
  GOOGLE_CLIENT_ID,
  GOOGLE_LOGIN_ENABLED,
  MICROSOFT_AUTHORITY_TENANT,
  MICROSOFT_CLIENT_ID,
  MICROSOFT_NATIVE_REDIRECT_URI,
  MICROSOFT_REDIRECT_URI,
} from '../config/identity'
import {
  buildMicrosoftAuthorizationUrl,
  buildMicrosoftRefreshTokenRequestBody,
  buildMicrosoftTokenRequestBody,
  parseMicrosoftAuthorizationCallback,
} from './microsoftOAuth'
import {
  microsoftAccessTokenExpiresAt,
  microsoftAccessTokenNeedsRefresh,
} from './microsoftSessionPolicy'

type MicrosoftPendingLogin = {
  state: string
  verifier: string
  nonce: string
  expectedEmail?: string
}

type MicrosoftTokenResponse = {
  access_token?: string
  refresh_token?: string
  id_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

type MicrosoftUserInfo = {
  sub?: string
  name?: string
  email?: string
  preferred_username?: string
}

type GoogleTokenResponse = {
  access_token?: string
  error?: string
  error_description?: string
}

type GoogleUserInfo = {
  sub?: string
  name?: string
  email?: string
  email_verified?: boolean
}

type GoogleTokenClient = {
  requestAccessToken(config?: { prompt?: string; login_hint?: string }): void
}

type GoogleAccountsApi = {
  oauth2: {
    initTokenClient(config: {
      client_id: string
      scope: string
      prompt?: string
      login_hint?: string
      callback: (response: GoogleTokenResponse) => void
      error_callback?: (error: { type?: string }) => void
    }): GoogleTokenClient
  }
}

declare global {
  interface Window {
    google?: { accounts: GoogleAccountsApi }
  }
}

export type MicrosoftAppSession = {
  identity: ExternalIdentity
  graphAccessToken: string
  refreshToken?: string
  expiresAt: number
}

const MICROSOFT_PENDING_KEY = 'fantazone.oauth.microsoft.pending.v1'
const MICROSOFT_NATIVE_REFRESH_TOKEN_KEY = 'fantazone.oauth.microsoft.refresh.v1'
const GOOGLE_SCRIPT_ID = 'fantazone-google-identity-services'
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const BASE64_URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
let googleScriptPromise: Promise<void> | null = null

export class IdentityLoginError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IdentityLoginError'
  }
}

export async function beginExternalLogin(
  provider: ExternalIdentityProvider,
  expectedEmail?: string,
): Promise<ExternalIdentity | null> {
  if (provider === 'google') {
    assertWebBrowser()
    if (!GOOGLE_LOGIN_ENABLED) {
      throw new IdentityLoginError('Login Google temporaneamente disabilitato in Fantazone.')
    }
    return loginWithGoogle(expectedEmail)
  }
  const session = await beginMicrosoftAppLogin(expectedEmail)
  return session?.identity ?? null
}

/**
 * Starts the product-level Microsoft login on every supported runtime.
 * Web keeps the full-page PKCE redirect and never persists the provider session.
 * Native returns through `fantaplus://auth` and stores only the rotating refresh
 * token in the platform secure store.
 */
export async function beginMicrosoftAppLogin(expectedEmail?: string): Promise<MicrosoftAppSession | null> {
  if (isWebBrowser()) {
    await beginMicrosoftWebLogin(expectedEmail)
    return null
  }
  const session = await loginWithMicrosoftNative(expectedEmail)
  if (session) await persistNativeMicrosoftRefreshToken(session.refreshToken)
  return session
}

export async function completePendingExternalLogin(): Promise<ExternalIdentity | null> {
  const session = await completePendingMicrosoftAppLogin()
  return session?.identity ?? null
}

/** Complete the full-page Microsoft callback used only by the web build. */
export async function completePendingMicrosoftAppLogin(): Promise<MicrosoftAppSession | null> {
  if (!isWebBrowser()) return null
  const pending = readMicrosoftPending()
  if (!pending) return null

  const params = new URLSearchParams(window.location.search)
  if (!params.get('error') && !params.get('code')) return null

  try {
    const code = parseCallback(window.location.href, pending.state)
    const token = await exchangeMicrosoftCode(code, pending.verifier, MICROSOFT_REDIRECT_URI)
    return createMicrosoftSession(token, { nonce: pending.nonce })
  } finally {
    clearMicrosoftPending()
    stripMicrosoftCallbackFromUrl()
  }
}

/**
 * Native-only silent restore. The refresh token is never persisted on web, so a
 * browser reload still requires a fresh provider proof exactly as before.
 */
export async function restoreMicrosoftAppSession(): Promise<MicrosoftAppSession | null> {
  if (isWebBrowser()) return null
  const refreshToken = await readNativeMicrosoftRefreshToken()
  if (!refreshToken) return null
  return refreshMicrosoftAppSession(refreshToken)
}

/** Refresh an access token only when it is close to expiry. */
export async function ensureMicrosoftAppSession(session: MicrosoftAppSession): Promise<MicrosoftAppSession> {
  if (!microsoftAccessTokenNeedsRefresh(session.expiresAt)) return session
  if (!session.refreshToken) {
    throw new IdentityLoginError('La sessione Microsoft è scaduta. Accedi di nuovo per continuare.')
  }
  return refreshMicrosoftAppSession(session.refreshToken)
}

/** Local app logout. Native refresh material is deleted; web has none to delete. */
export async function logoutMicrosoftAppSession(): Promise<void> {
  if (isWebBrowser()) return
  const SecureStore = await import('expo-secure-store')
  await SecureStore.deleteItemAsync(MICROSOFT_NATIVE_REFRESH_TOKEN_KEY)
}

async function beginMicrosoftWebLogin(expectedEmail?: string): Promise<void> {
  const pending = await createMicrosoftTransaction(expectedEmail)
  window.sessionStorage.setItem(MICROSOFT_PENDING_KEY, JSON.stringify(pending))
  window.location.assign(await authorizationUrl(pending, MICROSOFT_REDIRECT_URI))
}

async function loginWithMicrosoftNative(expectedEmail?: string): Promise<MicrosoftAppSession | null> {
  const pending = await createMicrosoftTransaction(expectedEmail)
  const redirectUri = MICROSOFT_NATIVE_REDIRECT_URI
  const authUrl = await authorizationUrl(pending, redirectUri)
  const WebBrowser = await import('expo-web-browser')
  const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri)

  if (result.type === 'cancel' || result.type === 'dismiss') return null
  const callbackUrl = result.type === 'success' && 'url' in result && typeof result.url === 'string'
    ? result.url
    : ''
  if (!callbackUrl) {
    throw new IdentityLoginError('Microsoft non ha restituito il deep link di completamento del login.')
  }

  const code = parseCallback(callbackUrl, pending.state)
  const token = await exchangeMicrosoftCode(code, pending.verifier, redirectUri)
  return createMicrosoftSession(token, { nonce: pending.nonce })
}

async function refreshMicrosoftAppSession(refreshToken: string): Promise<MicrosoftAppSession> {
  const endpoint = microsoftTokenEndpoint()
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: buildMicrosoftRefreshTokenRequestBody({
      clientId: MICROSOFT_CLIENT_ID,
      refreshToken,
    }),
  })
  const token = await response.json() as MicrosoftTokenResponse
  if (!response.ok || !token.access_token) {
    throw new IdentityLoginError(
      token.error_description || token.error || 'Impossibile rinnovare la sessione Microsoft.',
    )
  }
  const session = await createMicrosoftSession(token, { fallbackRefreshToken: refreshToken })
  await persistNativeMicrosoftRefreshToken(session.refreshToken)
  return session
}

async function createMicrosoftTransaction(expectedEmail?: string): Promise<MicrosoftPendingLogin> {
  return {
    state: await randomBase64Url(32),
    verifier: await randomBase64Url(64),
    nonce: await randomBase64Url(32),
    expectedEmail: normalizeEmail(expectedEmail) || undefined,
  }
}

async function authorizationUrl(pending: MicrosoftPendingLogin, redirectUri: string): Promise<string> {
  return buildMicrosoftAuthorizationUrl({
    authorityTenant: MICROSOFT_AUTHORITY_TENANT,
    clientId: MICROSOFT_CLIENT_ID,
    redirectUri,
    state: pending.state,
    nonce: pending.nonce,
    codeChallenge: await sha256Base64Url(pending.verifier),
    loginHint: pending.expectedEmail,
  })
}

function parseCallback(callbackUrl: string, expectedState: string): string {
  try {
    return parseMicrosoftAuthorizationCallback(callbackUrl, expectedState)
  } catch (error) {
    throw new IdentityLoginError(error instanceof Error ? error.message : 'Risposta Microsoft non valida.')
  }
}

async function exchangeMicrosoftCode(
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<MicrosoftTokenResponse> {
  const response = await fetch(microsoftTokenEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: buildMicrosoftTokenRequestBody({
      clientId: MICROSOFT_CLIENT_ID,
      code,
      redirectUri,
      verifier,
    }),
  })
  const token = await response.json() as MicrosoftTokenResponse
  if (!response.ok || !token.access_token || !token.id_token) {
    throw new IdentityLoginError(token.error_description || token.error || 'Microsoft non ha restituito i token di login attesi.')
  }
  return token
}

async function createMicrosoftSession(
  token: MicrosoftTokenResponse,
  options: { nonce?: string; fallbackRefreshToken?: string },
): Promise<MicrosoftAppSession> {
  if (!token.access_token) throw new IdentityLoginError('Microsoft non ha restituito un access token.')

  if (options.nonce) {
    if (!token.id_token) throw new IdentityLoginError('Microsoft non ha restituito un ID token.')
    validateMicrosoftIdToken(token.id_token, options.nonce)
  } else if (token.id_token) {
    validateMicrosoftIdToken(token.id_token)
  }

  const user = await fetchMicrosoftUserInfo(token.access_token)
  const claims = token.id_token ? decodeJwtPayload(token.id_token) : {}
  const email = normalizeEmail(
    user.email || user.preferred_username || stringClaim(claims.email) || stringClaim(claims.preferred_username),
  )
  const subject = user.sub || stringClaim(claims.sub)
  if (!email || !subject) {
    throw new IdentityLoginError('Microsoft non ha restituito un indirizzo email utilizzabile per Fantazone.')
  }

  return {
    identity: {
      provider: 'microsoft',
      subject,
      email,
      displayName: user.name || stringClaim(claims.name) || undefined,
    },
    graphAccessToken: token.access_token,
    refreshToken: token.refresh_token || options.fallbackRefreshToken,
    expiresAt: microsoftAccessTokenExpiresAt(token.expires_in),
  }
}

async function fetchMicrosoftUserInfo(accessToken: string): Promise<MicrosoftUserInfo> {
  const response = await fetch('https://graph.microsoft.com/oidc/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) throw new IdentityLoginError('Impossibile leggere il profilo Microsoft autenticato.')
  return response.json() as Promise<MicrosoftUserInfo>
}

function validateMicrosoftIdToken(idToken: string, nonce?: string): void {
  const claims = decodeJwtPayload(idToken)
  const audience = claims.aud
  const correctAudience = audience === MICROSOFT_CLIENT_ID ||
    (Array.isArray(audience) && audience.includes(MICROSOFT_CLIENT_ID))
  if (!correctAudience) throw new IdentityLoginError('ID token Microsoft destinato a un client diverso.')
  if (nonce && claims.nonce !== nonce) throw new IdentityLoginError('Nonce Microsoft non valido.')
  const exp = typeof claims.exp === 'number' ? claims.exp : 0
  if (!exp || exp * 1000 <= Date.now()) throw new IdentityLoginError('ID token Microsoft scaduto.')
}

function microsoftTokenEndpoint(): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(MICROSOFT_AUTHORITY_TENANT)}/oauth2/v2.0/token`
}

async function persistNativeMicrosoftRefreshToken(refreshToken: string | undefined): Promise<void> {
  if (isWebBrowser() || !refreshToken) return
  const SecureStore = await import('expo-secure-store')
  await SecureStore.setItemAsync(MICROSOFT_NATIVE_REFRESH_TOKEN_KEY, refreshToken)
}

async function readNativeMicrosoftRefreshToken(): Promise<string | null> {
  const SecureStore = await import('expo-secure-store')
  return SecureStore.getItemAsync(MICROSOFT_NATIVE_REFRESH_TOKEN_KEY)
}

async function loginWithGoogle(expectedEmail?: string): Promise<ExternalIdentity> {
  if (!GOOGLE_CLIENT_ID) {
    throw new IdentityLoginError('Google login non configurato: manca EXPO_PUBLIC_GOOGLE_CLIENT_ID nel build di GitHub Pages.')
  }
  await loadGoogleIdentityServices()
  const google = window.google?.accounts
  if (!google) throw new IdentityLoginError('Google Identity Services non è disponibile nel browser.')

  return new Promise<ExternalIdentity>((resolve, reject) => {
    const loginHint = normalizeEmail(expectedEmail)
    const client = google.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: 'openid profile email',
      prompt: 'select_account',
      ...(loginHint ? { login_hint: loginHint } : {}),
      callback: response => {
        if (!response.access_token || response.error) {
          reject(new IdentityLoginError(response.error_description || response.error || 'Google login non riuscito.'))
          return
        }
        void fetchGoogleUserInfo(response.access_token).then(user => {
          const email = normalizeEmail(user.email)
          if (!user.sub || !email || user.email_verified === false) {
            reject(new IdentityLoginError('Google non ha restituito una email verificata utilizzabile per Fantazone.'))
            return
          }
          resolve({ provider: 'google', subject: user.sub, email, displayName: user.name })
        }).catch(error => reject(error))
      },
      error_callback: error => reject(new IdentityLoginError(`Google login interrotto (${error.type || 'popup'}).`)),
    })
    client.requestAccessToken({
      prompt: 'select_account',
      ...(loginHint ? { login_hint: loginHint } : {}),
    })
  })
}

async function fetchGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) throw new IdentityLoginError('Impossibile leggere il profilo Google autenticato.')
  return response.json() as Promise<GoogleUserInfo>
}

function loadGoogleIdentityServices(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  if (googleScriptPromise) return googleScriptPromise
  googleScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(GOOGLE_SCRIPT_ID) as HTMLScriptElement | null
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new IdentityLoginError('Impossibile caricare Google Identity Services.')), { once: true })
      return
    }
    const script = document.createElement('script')
    script.id = GOOGLE_SCRIPT_ID
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new IdentityLoginError('Impossibile caricare Google Identity Services.'))
    document.head.appendChild(script)
  })
  return googleScriptPromise
}

function readMicrosoftPending(): MicrosoftPendingLogin | null {
  if (!isWebBrowser()) return null
  const raw = window.sessionStorage.getItem(MICROSOFT_PENDING_KEY)
  if (!raw) return null
  try {
    const pending = JSON.parse(raw) as MicrosoftPendingLogin
    return pending.state && pending.verifier && pending.nonce ? pending : null
  } catch {
    return null
  }
}

function clearMicrosoftPending(): void {
  if (isWebBrowser()) window.sessionStorage.removeItem(MICROSOFT_PENDING_KEY)
}

function stripMicrosoftCallbackFromUrl(): void {
  if (!isWebBrowser()) return
  const url = new URL(window.location.href)
  for (const key of ['code', 'state', 'session_state', 'error', 'error_description', 'error_uri']) {
    url.searchParams.delete(key)
  }
  const search = url.searchParams.toString()
  window.history.replaceState({}, document.title, `${url.pathname}${search ? `?${search}` : ''}${url.hash}`)
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const part = token.split('.')[1]
  if (!part) throw new IdentityLoginError('ID token non valido.')
  try {
    return JSON.parse(decodeBase64UrlUtf8(part)) as Record<string, unknown>
  } catch {
    throw new IdentityLoginError('ID token Microsoft non decodificabile.')
  }
}

function decodeBase64UrlUtf8(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/g, '')
  const bytes: number[] = []
  let buffer = 0
  let bits = 0
  for (const char of normalized) {
    const index = BASE64.indexOf(char)
    if (index < 0) throw new Error('base64 non valido')
    buffer = (buffer << 6) | index
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
      buffer &= (1 << bits) - 1
    }
  }
  return decodeURIComponent(bytes.map(byte => `%${byte.toString(16).padStart(2, '0')}`).join(''))
}

function stringClaim(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

async function randomBase64Url(size: number): Promise<string> {
  return bytesToBase64Url(await Crypto.getRandomBytesAsync(size))
}

async function sha256Base64Url(value: string): Promise<string> {
  const bytes = Uint8Array.from(value, char => char.charCodeAt(0))
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes)
  return bytesToBase64Url(new Uint8Array(digest))
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let output = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index]
    const hasB = index + 1 < bytes.length
    const hasC = index + 2 < bytes.length
    const b = hasB ? bytes[index + 1] : 0
    const c = hasC ? bytes[index + 2] : 0
    output += BASE64_URL[a >> 2]
    output += BASE64_URL[((a & 0x03) << 4) | (b >> 4)]
    if (hasB) output += BASE64_URL[((b & 0x0f) << 2) | (c >> 6)]
    if (hasC) output += BASE64_URL[c & 0x3f]
  }
  return output
}

function normalizeEmail(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? ''
}

function isWebBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}

function assertWebBrowser(): void {
  if (!isWebBrowser()) {
    throw new IdentityLoginError('Questo provider è disponibile solo nella build web di fanta.plus.')
  }
}
