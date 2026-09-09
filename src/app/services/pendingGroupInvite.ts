import type { GroupInvitePayload } from '@fantazone/domain'
import { parseInviteLinkFragment } from './groupInviteLink'

const PENDING_GROUP_INVITE_KEY = 'fantazone.group-invite.pending.v4'

/**
 * Captures an invite fragment before Microsoft performs its full-page redirect.
 *
 * Current v4 links encrypt the group's shared GitHub PAT with AES-256-GCM. The URL
 * fragment is stripped immediately; sessionStorage carries only the already
 * decrypted pending invite through the OAuth redirect and is cleared after
 * join/cancel. Older v3/v2/v1 links remain readable.
 */
export async function loadPendingGroupInvite(): Promise<GroupInvitePayload | null> {
  if (!isWebBrowser()) return null

  const fromFragment = await parseInviteLinkFragment(window.location.hash)
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
