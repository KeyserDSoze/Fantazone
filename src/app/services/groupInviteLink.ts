import {
  AESEncryptionKey,
  AESSealedData,
  aesDecryptAsync,
  aesEncryptAsync,
} from 'expo-crypto'
import type { GroupInvitePayload } from '@fantazone/domain'
import { parseInviteFragment } from '@fantazone/github'

const BASE64_URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

type SharedCredentialInvite = Extract<GroupInvitePayload, { v: 3 }>

type EncryptedInviteEnvelope = {
  v: 4
  group: string
  repository: string
  email: string
  key: string
  sealed: string
}

/**
 * Creates a self-contained zero-backend invitation. The PAT is encrypted with
 * AES-256-GCM and the group/repository/email metadata is authenticated as AAD.
 *
 * The encryption key intentionally travels in the URL fragment because there is
 * no trusted Fantazone backend or recipient public-key infrastructure. This keeps
 * the PAT encrypted in the link representation and out of server requests/logs,
 * but the complete link is still a bearer credential and must be shared privately.
 */
export async function createEncryptedInviteFragment(payload: SharedCredentialInvite): Promise<string> {
  const normalized = normalizeSharedInvite(payload)
  const key = await AESEncryptionKey.generate()
  const sealed = await aesEncryptAsync(
    utf8(normalized.pat),
    key,
    { additionalData: utf8(inviteAad(normalized)) },
  )

  const envelope: EncryptedInviteEnvelope = {
    v: 4,
    group: normalized.group,
    repository: normalized.repository,
    email: normalized.email,
    key: await key.encoded('base64'),
    sealed: await sealed.combined('base64') as string,
  }
  return `#join4=${bytesToBase64Url(utf8(JSON.stringify(envelope)))}`
}

/** Reads AES-GCM v4 invitations and keeps v3/v2/v1 links backward compatible. */
export async function parseInviteLinkFragment(fragment: string): Promise<GroupInvitePayload | null> {
  try {
    const params = new URLSearchParams(fragment.replace(/^#/, ''))
    const encoded = params.get('join4')
    if (!encoded) return parseInviteFragment(fragment)

    const envelope = JSON.parse(text(base64UrlToBytes(encoded))) as Partial<EncryptedInviteEnvelope>
    const metadata = normalizeEncryptedEnvelope(envelope)
    if (!metadata) return null

    const key = await AESEncryptionKey.import(metadata.key, 'base64')
    const sealed = AESSealedData.fromCombined(metadata.sealed)
    const decrypted = await aesDecryptAsync(
      sealed,
      key,
      { additionalData: utf8(inviteAad(metadata)) },
    )
    const pat = text(typeof decrypted === 'string' ? base64ToBytes(decrypted) : decrypted).trim()
    if (!pat) return null

    return {
      v: 3,
      group: metadata.group,
      repository: metadata.repository,
      email: metadata.email,
      pat,
    }
  } catch {
    return null
  }
}

function normalizeSharedInvite(payload: SharedCredentialInvite): SharedCredentialInvite {
  const group = payload.group.trim()
  const repository = normalizeRepository(payload.repository)
  const email = payload.email.trim().toLowerCase()
  const pat = payload.pat.trim()
  if (!group || !repository || !email.includes('@') || !pat) throw new Error('Invito Fantazone non valido.')
  return { v: 3, group, repository, email, pat }
}

function normalizeEncryptedEnvelope(value: Partial<EncryptedInviteEnvelope>): EncryptedInviteEnvelope | null {
  if (value.v !== 4) return null
  const group = typeof value.group === 'string' ? value.group.trim() : ''
  const repository = normalizeRepository(typeof value.repository === 'string' ? value.repository : '')
  const email = typeof value.email === 'string' ? value.email.trim().toLowerCase() : ''
  const key = typeof value.key === 'string' ? value.key.trim() : ''
  const sealed = typeof value.sealed === 'string' ? value.sealed.trim() : ''
  if (!group || !repository || !email.includes('@') || !key || !sealed) return null
  return { v: 4, group, repository, email, key, sealed }
}

function inviteAad(value: Pick<EncryptedInviteEnvelope, 'group' | 'repository' | 'email'>): string {
  return JSON.stringify({
    v: 4,
    group: value.group,
    repository: value.repository,
    email: value.email,
  })
}

function normalizeRepository(value: string): string {
  const parts = value.trim().split('/').map(part => part.trim()).filter(Boolean)
  return parts.length === 2 ? `${parts[0]}/${parts[1]}` : ''
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function text(value: Uint8Array): string {
  return new TextDecoder().decode(value)
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let output = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index]
    const hasB = index + 1 < bytes.length
    const hasC = index + 2 < bytes.length
    const b = hasB ? bytes[index + 1] : 0
    const c = hasC ? bytes[index + 2] : 0
    output += BASE64_URL[a >> 2]
    output += BASE64_URL[((a & 0x03) << 4) | (b >> 4)]
    if (hasB) output += BASE64_URL[((b & 0x0f) << 2) | (c >> 6)]
    if (hasC) output += BASE64_URL[c & 0x3f]
  }
  return output
}

function base64UrlToBytes(value: string): Uint8Array {
  const bytes: number[] = []
  let buffer = 0
  let bits = 0
  for (const char of value.replace(/=+$/g, '')) {
    const index = BASE64_URL.indexOf(char)
    if (index < 0) throw new Error('Invito base64url non valido.')
    buffer = (buffer << 6) | index
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
      buffer &= (1 << bits) - 1
    }
  }
  return Uint8Array.from(bytes)
}

function base64ToBytes(value: string): Uint8Array {
  const normalized = value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  return base64UrlToBytes(normalized)
}
