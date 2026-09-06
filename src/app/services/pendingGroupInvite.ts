import { parseInviteFragment } from '@fantazone/github'
import type { GroupInvitePayload } from '@fantazone/domain'

const PENDING_GROUP_INVITE_KEY = 'fantazone.group-invite.pending.v3'

/**
 * Captures an invite fragment before Microsoft performs its full-page redirect.
 *
 * New v3 invites intentionally contain the group's shared GitHub PAT because the
 * product has no trusted backend and participants do not need a GitHub account.
 * The URL fragment is stripped immediately; sessionStorage is used only to carry
 * the pending invite through the OAuth redirect and is cleared after join/cancel.
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
    const value = JSON.parse(raw) as Record<string, unknown>
    const email = typeof value.email === 'string' ? value.email.trim().toLowerCase() : ''
    const group = typeof value.group === 'string' ? value.group.trim() : ''
    const repository = normalizeRepository(typeof value.repository === 'string' ? value.repository : '')
    if (!group || !repository || !email || !email.includes('@')) return null

    if (value.v === 2) return { v: 2, group, repository, email }
    if (value.v !== 3) return null

    const pat = typeof value.pat === 'string' ? value.pat.trim() : ''
    if (!pat) return null
    return { v: 3, group, repository, email, pat }
  } catch {
    return null
  }
}

function normalizeRepository(value: string): string {
  const parts = value.trim().split('/').map(part => part.trim()).filter(Boolean)
  return parts.length === 2 ? `${parts[0]}/${parts[1]}` : ''
}

function stripInviteFragment(): void {
  const url = new URL(window.location.href)
  url.hash = ''
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}`)
}

function isWebBrowser(): boolean {
  return typeof window !== 'undefined'
}
