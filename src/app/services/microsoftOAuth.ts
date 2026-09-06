export const MICROSOFT_SCOPE = 'openid profile email offline_access Files.ReadWrite.AppFolder'

export type MicrosoftAuthorizationInput = {
  authorityTenant: string
  clientId: string
  redirectUri: string
  state: string
  nonce: string
  codeChallenge: string
  loginHint?: string
}

export type MicrosoftTokenRequestInput = {
  clientId: string
  code: string
  redirectUri: string
  verifier: string
}

export type MicrosoftRefreshTokenRequestInput = {
  clientId: string
  refreshToken: string
}

export function buildMicrosoftAuthorizationUrl(input: MicrosoftAuthorizationInput): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    response_type: 'code',
    redirect_uri: input.redirectUri,
    response_mode: 'query',
    scope: MICROSOFT_SCOPE,
    state: input.state,
    nonce: input.nonce,
    code_challenge: input.codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  })
  const loginHint = input.loginHint?.trim().toLowerCase()
  if (loginHint) params.set('login_hint', loginHint)
  return `https://login.microsoftonline.com/${encodeURIComponent(input.authorityTenant)}/oauth2/v2.0/authorize?${params.toString()}`
}

export function parseMicrosoftAuthorizationCallback(callbackUrl: string, expectedState: string): string {
  const url = new URL(callbackUrl)
  const error = url.searchParams.get('error')
  if (error) {
    throw new Error(url.searchParams.get('error_description') || `Microsoft login: ${error}`)
  }
  const state = url.searchParams.get('state')
  if (state !== expectedState) {
    throw new Error('La risposta Microsoft non corrisponde alla sessione di login avviata.')
  }
  const code = url.searchParams.get('code')
  if (!code) throw new Error('Microsoft non ha restituito il codice di autorizzazione.')
  return code
}

export function buildMicrosoftTokenRequestBody(input: MicrosoftTokenRequestInput): string {
  return new URLSearchParams({
    client_id: input.clientId,
    scope: MICROSOFT_SCOPE,
    code: input.code,
    redirect_uri: input.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: input.verifier,
  }).toString()
}

export function buildMicrosoftRefreshTokenRequestBody(input: MicrosoftRefreshTokenRequestInput): string {
  return new URLSearchParams({
    client_id: input.clientId,
    scope: MICROSOFT_SCOPE,
    refresh_token: input.refreshToken,
    grant_type: 'refresh_token',
  }).toString()
}
