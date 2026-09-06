import { Platform } from 'react-native'
import { parseInviteFragment } from '@fantazone/github'
import type { GroupInvitePayload } from '@fantazone/domain'

const PENDING_GROUP_INVITE_KEY = 'fantazone.group-invite.pending.v2'

/**
 * Captures an invite fragment before Microsoft performs its full-page redirect.
 * Only the sanitized v2 payload is kept in sessionStorage, so legacy links never
 * persist their embedded PAT beyond the first page load.
 */
export function loadPendingGroupInvite(): GroupInvitePayload | null {
  if (!isWebBrowser()) return null

  const fromFragment = parseInviteFragment(window.location.hash)
  if (fromFragment) {
    try {
      window.sessionStorage.setItem(PENDING_GROUP_INVITE_KEY, JSON.stringify(fromFragment))
    } catch {
      // The in-memory caller can still continue even if browser storage is blocked.
    }
    stripInviteFragment()
    return fromFragment
  }

  try {
    const raw = window.sessionStorage.getItem(PENDING_GROUP_INVITE_KEY)
    if (!raw) return null
    return decodePendingInvite(raw)
  } catch {
    return null
  }
}

export function clearPendingGroupInvite(): void {
  if (!isWebBrowser()) return
  try { window.sessionStorage.removeItem(PENDING_GROUP_INVITE_KEY) } catch { /* best effort */ }
}

export function decodePendingInvite(raw: string): GroupInvitePayload | null {
  try {
    const value = JSON.parse(raw) as Partial<GroupInvitePayload>
    const email = typeof value.email === 'string' ? value.email.trim().toLowerCase() : ''
    const group = typeof value.group === 'string' ? value.group.trim() : ''
    const repository = typeof value.repository === 'string' ? value.repository.trim() : ''
    if (value.v !== 2 || !group || !repository.includes('/') || !email || !email.includes('@')) return null
    return { v: 2, group, repository, email }
  } catch {
    return null
  }
}

function stripInviteFragment(): void {
  const url = new URL(window.location.href)
  url.hash = ''
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}`)
}

function isWebBrowser(): boolean {
  return Platform.OS === 'web' && typeof window !== 'undefined'
}
