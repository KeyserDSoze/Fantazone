import type { GroupInvitePayload, GroupInviteMode } from '../../domain/src/contracts'

export function createInviteFragment(payload: GroupInvitePayload): string {
  const normalized = normalizeInvitePayload(payload)
  if (!normalized) throw new Error('Invito Fantazone non valido.')
  return `#invite=${toBase64Url(JSON.stringify(normalized))}`
}

/** Reads only the single current Fantazone invitation envelope. */
export function parseInviteFragment(fragment: string): GroupInvitePayload | null {
  try {
    const params = new URLSearchParams(fragment.replace(/^#/, ''))
    const encoded = params.get('invite')
    if (!encoded) return null
    return normalizeInvitePayload(JSON.parse(fromBase64Url(encoded)))
  } catch {
    return null
  }
}

function normalizeInvitePayload(value: unknown): GroupInvitePayload | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>

  const mode = normalizeMode(raw.mode)
  const group = text(raw.group)
  const repository = normalizeRepository(text(raw.repository))
  const email = normalizeEmail(text(raw.email))
  const salt = text(raw.salt)
  const iterations = typeof raw.iterations === 'number' && Number.isInteger(raw.iterations) ? raw.iterations : 0
  const sealed = text(raw.sealed)
  if (!mode || !group || !repository || !salt || iterations < 1 || iterations > 1_000_000 || !sealed) return null
  if (mode === 'email' && (!email || !email.includes('@'))) return null
  if (mode === 'shared' && email) return null

  return mode === 'email'
    ? { mode, group, repository, email, salt, iterations, sealed }
    : { mode, group, repository, salt, iterations, sealed }
}

function normalizeMode(value: unknown): GroupInviteMode | null {
  return value === 'email' || value === 'shared' ? value : null
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
