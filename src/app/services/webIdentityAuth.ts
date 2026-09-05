import type { ExternalIdentity, ExternalIdentityProvider } from '@fantazone/domain'
import {
  GOOGLE_CLIENT_ID,
  MICROSOFT_AUTHORITY_TENANT,
  MICROSOFT_CLIENT_ID,
  MICROSOFT_REDIRECT_URI,
} from '../config/identity'

type MicrosoftPendingLogin = {
  state: string
  verifier: string
  nonce: string
  expectedEmail?: string
}

type MicrosoftTokenResponse = {
  access_token?: string
  id_token?: string
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

/**
 * sessionStorage contains only the short-lived PKCE transaction state required
 * to survive Microsoft's full-page redirect. It never contains an authenticated
 * Fantazone identity or a trusted email/subject session.
 */
const MICROSOFT_PENDING_KEY = 'fantazone.oauth.microsoft.pending.v1'
const GOOGLE_SCRIPT_ID = 'fantazone-google-identity-services'
let googleScriptPromise: Promise<void> | null = null

export class IdentityLoginError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IdentityLoginError'
  }
}

/**
 * Starts a provider login. Google resolves in the same page; Microsoft redirects
 * and therefore returns null after navigation has been scheduled.
 */
export async function beginExternalLogin(
  provider: ExternalIdentityProvider,
  expectedEmail?: string,
): Promise<ExternalIdentity | null> {
  assertWebBrowser()
  if (provider === 'google') return loginWithGoogle(expectedEmail)
  await beginMicrosoftLogin(expectedEmail)
  return null
}

/** Complete a Microsoft authorization-code callback after the selected group has been restored. */
export async function completePendingExternalLogin(): Promise<ExternalIdentity | null> {
  assertWebBrowser()
  const pending = readMicrosoftPending()
  if (!pending) return null

  const params = new URLSearchParams(window.location.search)
  const error = params.get('error')
  const code = params.get('code')
  if (!error && !code) return null

  try {
    if (error) {
      throw new IdentityLoginError(params.get('error_description') || `Microsoft login: ${error}`)
    }
    if (params.get('state') !== pending.state) {
      throw new IdentityLoginError('La risposta Microsoft non corrisponde alla sessione di login avviata.')
    }

    const token = await exchangeMicrosoftCode(code!, pending.verifier)
    validateMicrosoftIdToken(token.id_token, pending.nonce)
    const user = await fetchMicrosoftUserInfo(token.access_token!)
    const claims = token.id_token ? decodeJwtPayload(token.id_token) : {}
    const email = normalizeEmail(
      user.email || user.preferred_username || stringClaim(claims.email) || stringClaim(claims.preferred_username),
    )
    const subject = user.sub || stringClaim(claims.sub)
    if (!email || !subject) {
      throw new IdentityLoginError('Microsoft non ha restituito un indirizzo email utilizzabile per Fantazone.')
    }

    return {
      provider: 'microsoft',
      subject,
      email,
      displayName: user.name || stringClaim(claims.name) || undefined,
    }
  } finally {
    clearMicrosoftPending()
    stripMicrosoftCallbackFromUrl()
  }
}

async function beginMicrosoftLogin(expectedEmail?: string): Promise<void> {
  const state = randomBase64Url(32)
  const verifier = randomBase64Url(64)
  const nonce = randomBase64Url(32)
  const challenge = await sha256Base64Url(verifier)
  const pending: MicrosoftPendingLogin = {
    state,
    verifier,
    nonce,
    expectedEmail: normalizeEmail(expectedEmail),
  }
  window.sessionStorage.setItem(MICROSOFT_PENDING_KEY, JSON.stringify(pending))

  const params = new URLSearchParams({
    client_id: MICROSOFT_CLIENT_ID,
    response_type: 'code',
    redirect_uri: MICROSOFT_REDIRECT_URI,
    response_mode: 'query',
    scope: 'openid profile email',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })
  if (pending.expectedEmail) params.set('login_hint', pending.expectedEmail)

  window.location.assign(
    `https://login.microsoftonline.com/${encodeURIComponent(MICROSOFT_AUTHORITY_TENANT)}/oauth2/v2.0/authorize?${params.toString()}`,
  )
}

async function exchangeMicrosoftCode(code: string, verifier: string): Promise<MicrosoftTokenResponse> {
  const endpoint = `https://login.microsoftonline.com/${encodeURIComponent(MICROSOFT_AUTHORITY_TENANT)}/oauth2/v2.0/token`
  const body = new URLSearchParams({
    client_id: MICROSOFT_CLIENT_ID,
    scope: 'openid profile email',
    code,
    redirect_uri: MICROSOFT_REDIRECT_URI,
    grant_type: 'authorization_code',
    code_verifier: verifier,
  })
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  const token = await response.json() as MicrosoftTokenResponse
  if (!response.ok || !token.access_token || !token.id_token) {
    throw new IdentityLoginError(token.error_description || token.error || 'Microsoft non ha restituito i token di login attesi.')
  }
  return token
}

async function fetchMicrosoftUserInfo(accessToken: string): Promise<MicrosoftUserInfo> {
  const response = await fetch('https://graph.microsoft.com/oidc/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) throw new IdentityLoginError('Impossibile leggere il profilo Microsoft autenticato.')
  return response.json() as Promise<MicrosoftUserInfo>
}

function validateMicrosoftIdToken(idToken: string | undefined, nonce: string): void {
  if (!idToken) throw new IdentityLoginError('Microsoft non ha restituito un ID token.')
  const claims = decodeJwtPayload(idToken)
  const audience = claims.aud
  const correctAudience = audience === MICROSOFT_CLIENT_ID ||
    (Array.isArray(audience) && audience.includes(MICROSOFT_CLIENT_ID))
  if (!correctAudience) throw new IdentityLoginError('ID token Microsoft destinato a un client diverso.')
  if (claims.nonce !== nonce) throw new IdentityLoginError('Nonce Microsoft non valido.')
  const exp = typeof claims.exp === 'number' ? claims.exp : 0
  if (!exp || exp * 1000 <= Date.now()) throw new IdentityLoginError('ID token Microsoft scaduto.')
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
  const normalized = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=')
  return JSON.parse(decodeURIComponent(Array.from(atob(normalized), char =>
    `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''))) as Record<string, unknown>
}

function stringClaim(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function randomBase64Url(size: number): string {
  const bytes = new Uint8Array(size)
  window.crypto.getRandomValues(bytes)
  let binary = ''
  bytes.forEach(value => { binary += String.fromCharCode(value) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  let binary = ''
  new Uint8Array(digest).forEach(byte => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function normalizeEmail(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? ''
}

function isWebBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}

function assertWebBrowser(): void {
  if (!isWebBrowser()) {
    throw new IdentityLoginError('Questo adapter OAuth è configurato per fanta.plus. Le build native richiedono un redirect/deep-link dedicato.')
  }
}
