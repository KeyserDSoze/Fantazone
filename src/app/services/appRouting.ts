import { isGroupProductRoute, type GroupProductRoute } from './groupNavigation'

export type GroupBrowserPage = {
  route: GroupProductRoute
  gameId: string | null
}

export type AppBrowserLocation =
  | { kind: 'groups' }
  | { kind: 'architecture' }
  | { kind: 'join' }
  | ({ kind: 'group'; groupId: string } & GroupBrowserPage)

export type BrowserNavigationMode = 'push' | 'replace'

const LOGIN_RETURN_PATH_KEY = 'fantazone.browser-route.oauth-return.v1'
const OAUTH_RETURN_PENDING_KEY = 'fantazone.browser-route.oauth-callback.v1'

export function readBrowserLocation(): AppBrowserLocation {
  if (!isWebBrowser()) return { kind: 'groups' }

  const callback = hasOAuthCallback()
  if (callback) {
    try { window.sessionStorage.setItem(OAUTH_RETURN_PENDING_KEY, '1') } catch { /* best effort */ }
    const remembered = readRememberedBrowserReturnPath()
    return remembered ? parseBrowserPath(pathnameFromReturnPath(remembered)) : parseBrowserPath(window.location.pathname)
  }

  const shouldRestore = readAndClearOAuthReturnPending()
  if (shouldRestore) {
    const remembered = readRememberedBrowserReturnPath()
    if (remembered) {
      restoreBrowserReturnPath(remembered)
      return parseBrowserPath(pathnameFromReturnPath(remembered))
    }
  }

  const location = parseBrowserPath(window.location.pathname)
  rememberBrowserLocation(location)
  return location
}

export function parseBrowserPath(pathname: string): AppBrowserLocation {
  const segments = pathname
    .split('/')
    .map(segment => segment.trim())
    .filter(Boolean)
    .map(decodePathPart)

  if (segments.length === 0 || (segments.length === 1 && segments[0] === 'groups')) {
    return { kind: 'groups' }
  }
  if (segments.length === 1 && segments[0] === 'architecture') return { kind: 'architecture' }
  if (segments.length === 1 && segments[0] === 'join') return { kind: 'join' }

  if (segments[0] !== 'groups' || !segments[1]) return { kind: 'groups' }

  const groupId = segments[1]
  const routeCandidate = segments[2] ?? 'home'
  const route = isGroupProductRoute(routeCandidate) ? routeCandidate : 'home'
  const gameId = segments[3] === 'game' && segments[4] ? segments[4] : null
  return { kind: 'group', groupId, route, gameId }
}

export function browserPath(location: AppBrowserLocation): string {
  if (location.kind === 'groups') return '/groups'
  if (location.kind === 'architecture') return '/architecture'
  if (location.kind === 'join') return '/join'

  const base = `/groups/${encodeURIComponent(location.groupId)}/${encodeURIComponent(location.route)}`
  return location.gameId ? `${base}/game/${encodeURIComponent(location.gameId)}` : base
}

export function navigateBrowser(location: AppBrowserLocation, mode: BrowserNavigationMode = 'push'): void {
  if (!isWebBrowser()) return
  const path = browserPath(location)
  rememberBrowserLocation(location)
  if (`${window.location.pathname}${window.location.search}${window.location.hash}` === path) return
  window.history[mode === 'replace' ? 'replaceState' : 'pushState']({}, document.title, path)
}

export function subscribeBrowserNavigation(listener: (location: AppBrowserLocation) => void): () => void {
  if (!isWebBrowser()) return () => undefined
  const handlePopState = () => listener(readBrowserLocation())
  window.addEventListener('popstate', handlePopState)
  return () => window.removeEventListener('popstate', handlePopState)
}

export function rememberBrowserReturnPath(): void {
  if (!isWebBrowser()) return
  try { window.sessionStorage.setItem(LOGIN_RETURN_PATH_KEY, currentBrowserReturnPath() ?? '/groups') } catch { /* best effort */ }
}

export function restoreRememberedBrowserReturnPath(): void {
  if (!isWebBrowser()) return
  const returnPath = readRememberedBrowserReturnPath()
  if (returnPath) restoreBrowserReturnPath(returnPath)
}

export function currentBrowserReturnPath(): string | undefined {
  if (!isWebBrowser()) return undefined
  const { pathname, search, hash } = window.location
  return `${pathname}${search}${hash}`
}

export function restoreBrowserReturnPath(returnPath: string | undefined): void {
  if (!isWebBrowser()) return
  if (!returnPath || !returnPath.startsWith('/') || returnPath.startsWith('//')) return
  window.history.replaceState({}, document.title, returnPath)
}

function rememberBrowserLocation(location: AppBrowserLocation): void {
  if (!isWebBrowser()) return
  try { window.sessionStorage.setItem(LOGIN_RETURN_PATH_KEY, browserPath(location)) } catch { /* best effort */ }
}

function readRememberedBrowserReturnPath(): string | undefined {
  if (!isWebBrowser()) return undefined
  try {
    const value = window.sessionStorage.getItem(LOGIN_RETURN_PATH_KEY) ?? undefined
    return value && value.startsWith('/') && !value.startsWith('//') ? value : undefined
  } catch {
    return undefined
  }
}

function readAndClearOAuthReturnPending(): boolean {
  if (!isWebBrowser()) return false
  try {
    const pending = window.sessionStorage.getItem(OAUTH_RETURN_PENDING_KEY) === '1'
    if (pending) window.sessionStorage.removeItem(OAUTH_RETURN_PENDING_KEY)
    return pending
  } catch {
    return false
  }
}

function hasOAuthCallback(): boolean {
  if (!isWebBrowser()) return false
  const params = new URLSearchParams(window.location.search)
  return Boolean(params.get('code') || params.get('error')) && Boolean(params.get('state'))
}

function pathnameFromReturnPath(returnPath: string): string {
  try { return new URL(returnPath, 'https://fanta.plus').pathname } catch { return '/' }
}

function decodePathPart(value: string): string {
  try { return decodeURIComponent(value) } catch { return value }
}

function isWebBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}
