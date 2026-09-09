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

export function readBrowserLocation(): AppBrowserLocation {
  if (!isWebBrowser()) return { kind: 'groups' }
  return parseBrowserPath(window.location.pathname)
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
  if (`${window.location.pathname}${window.location.search}${window.location.hash}` === path) return
  window.history[mode === 'replace' ? 'replaceState' : 'pushState']({}, document.title, path)
}

export function subscribeBrowserNavigation(listener: (location: AppBrowserLocation) => void): () => void {
  if (!isWebBrowser()) return () => undefined
  const handlePopState = () => listener(readBrowserLocation())
  window.addEventListener('popstate', handlePopState)
  return () => window.removeEventListener('popstate', handlePopState)
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

function decodePathPart(value: string): string {
  try { return decodeURIComponent(value) } catch { return value }
}

function isWebBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}
