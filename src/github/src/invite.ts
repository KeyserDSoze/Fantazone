import type { GroupInvitePayload } from '../../domain/src/contracts'

export function createInviteFragment(payload: GroupInvitePayload): string {
  return `#join=${toBase64Url(JSON.stringify(payload))}`
}

export function parseInviteFragment(fragment: string): GroupInvitePayload | null {
  const params = new URLSearchParams(fragment.replace(/^#/, ''))
  const encoded = params.get('join')
  if (!encoded) return null
  const payload = JSON.parse(fromBase64Url(encoded)) as GroupInvitePayload
  if (payload.v !== 1 || !payload.group || !payload.repository || !payload.pat) return null
  return payload
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
