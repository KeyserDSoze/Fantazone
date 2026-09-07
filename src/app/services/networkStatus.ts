export type ConnectivityState = 'online' | 'offline' | 'unknown'

export function browserConnectivity(): ConnectivityState {
  if (typeof navigator === 'undefined' || typeof navigator.onLine !== 'boolean') return 'unknown'
  return navigator.onLine ? 'online' : 'offline'
}

/**
 * Fetch rejects with a TypeError on web and with platform-specific network errors
 * on React Native. HTTP authorization/conflict failures must never be treated as
 * offline because falling back to stale state would hide a real permission issue.
 */
export function isNetworkFailure(error: unknown): boolean {
  if (browserConnectivity() === 'offline') return true
  if (error instanceof TypeError) return true
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return message.includes('network request failed') ||
    message.includes('failed to fetch') ||
    message.includes('network error') ||
    message.includes('internet connection') ||
    message.includes('offline')
}
