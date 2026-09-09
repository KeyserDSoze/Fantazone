import type { GroupInvitePayload } from '@fantazone/domain'
import { parseInviteLinkFragment } from './groupInviteLink'

const PENDING_GROUP_INVITE_KEY = 'fantazone.group-invite.pending'

/**
 * Captures the current encrypted invite before Microsoft performs its full-page
 * OAuth redirect. The URL fragment is stripped immediately and sessionStorage
 * keeps only ciphertext plus non-secret metadata. Neither the email unlock code
 * nor the shared group password is ever stored here.
 */
export async function loadPendingGroupInvite(): Promise<GroupInvitePayload | null> {
  if (!isWebBrowser()) return null

  const fromFragment = parseInviteLinkFragment(window.location.hash)
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
    const mode = value.mode === 'email' || value.mode === 'shared' ? value.mode : null
    const email = typeof value.email === 'string' ? value.email.trim().toLowerCase() : ''
    const group = typeof value.group === 'string' ? value.group.trim() : ''
    const repository = normalizeRepository(typeof value.repository === 'string' ? value.repository : '')
    const salt = typeof value.salt === 'string' ? value.salt.trim() : ''
    const iterations = typeof value.iterations === 'number' && Number.isInteger(value.iterations) ? value.iterations : 0
    const sealed = typeof value.sealed === 'string' ? value.sealed.trim() : ''
    if (!mode || !group || !repository || !salt || iterations < 1 || iterations > 1_000_000 || !sealed) return null
    if (mode === 'email') {
      if (!email.includes('@')) return null
      return { mode, group, repository, email, salt, iterations, sealed }
    }
    if (email) return null
    return { mode, group, repository, salt, iterations, sealed }
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
