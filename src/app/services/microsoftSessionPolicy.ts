export const MICROSOFT_ACCESS_TOKEN_REFRESH_SKEW_MS = 2 * 60 * 1000
export const MICROSOFT_DEFAULT_ACCESS_TOKEN_LIFETIME_SECONDS = 60 * 60

export function microsoftAccessTokenExpiresAt(expiresInSeconds: number | undefined, now = Date.now()): number {
  const lifetimeSeconds = Number.isFinite(expiresInSeconds) && (expiresInSeconds ?? 0) > 0
    ? Math.max(60, Math.floor(expiresInSeconds!))
    : MICROSOFT_DEFAULT_ACCESS_TOKEN_LIFETIME_SECONDS
  return now + lifetimeSeconds * 1000
}

export function microsoftAccessTokenNeedsRefresh(expiresAt: number, now = Date.now()): boolean {
  return !Number.isFinite(expiresAt) || expiresAt <= now + MICROSOFT_ACCESS_TOKEN_REFRESH_SKEW_MS
}
