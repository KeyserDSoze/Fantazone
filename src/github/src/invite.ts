import type { GroupInvitePayload } from '../../domain/src/contracts'

type LegacyGroupInvitePayload = {
  v?: unknown
  group?: unknown
  repository?: unknown
  owner?: unknown
  pat?: unknown
  email?: unknown
}

export function createInviteFragment(payload: GroupInvitePayload): string {
  const normalized = normalizeInvitePayload(payload)
  if (!normalized) throw new Error('Invito Fantazone non valido.')
  return `#join=${toBase64Url(JSON.stringify(normalized))}`
}

/**
 * Reads both the current secret-free v2 contract and legacy v1 links.
 *
 * Legacy PAT material is intentionally discarded. The returned value is always a
 * v2 payload and can therefore be persisted temporarily without carrying a GitHub
 * credential forward from the URL.
 */
export function parseInviteFragment(fragment: string): GroupInvitePayload | null {
  try {
    const params = new URLSearchParams(fragment.replace(/^#/, ''))
    const encoded = params.get('join')
    if (!encoded) return null
    const payload = JSON.parse(fromBase64Url(encoded)) as LegacyGroupInvitePayload

    if (payload.v === 2) {
      return normalizeInvitePayload(payload)
    }

    if (payload.v === 1) {
      const owner = text(payload.owner)
      const repository = text(payload.repository)
      return normalizeInvitePayload({
        v: 2,
        group: text(payload.group),
        repository: repository.includes('/') ? repository : owner ? `${owner}/${repository}` : '',
        email: text(payload.email),
      })
    }

    return null
  } catch {
    return null
  }
}

function normalizeInvitePayload(value: unknown): GroupInvitePayload | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (raw.v !== 2) return null

  const group = text(raw.group)
  const repository = normalizeRepository(text(raw.repository))
  const email = normalizeEmail(text(raw.email))
  if (!group || !repository || !email || !email.includes('@')) return null

  return { v: 2, group, repository, email }
}

function normalizeRepository(value: string): string {
  const parts = value.trim().split('/').map(part => part.trim()).filter(Boolean)
  return parts.length === 2 ? `${parts[0]}/${parts[1]}` : ''
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  bytes.forEach(x => { binary += String.fromCharCode(x) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}
