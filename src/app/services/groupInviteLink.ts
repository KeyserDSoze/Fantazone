import type { GroupInvitePayload } from '@fantazone/domain'
import { createInviteFragment, parseInviteFragment } from '@fantazone/github'

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const UNLOCK_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
const UNLOCK_CODE_BYTES = 20
const UNLOCK_CODE_LENGTH = 32
const KEY_DERIVATION_CONTEXT = 'fantazone-group-invite:'

type SharedCredentialInvite = Omit<GroupInvitePayload, 'sealed'> & { pat: string }
type CryptoModule = typeof import('expo-crypto')

export type EncryptedInviteCreation = {
  fragment: string
  unlockCode: string
}

/**
 * Encrypts the shared group PAT with AES-256-GCM and a random 160-bit unlock code.
 * The unlock code is deliberately NOT written into the URL or persisted with the
 * encrypted envelope: the inviter must send it to the recipient separately.
 */
export async function createEncryptedInviteFragment(payload: SharedCredentialInvite): Promise<EncryptedInviteCreation> {
  const normalized = normalizeSharedInvite(payload)
  const Crypto = await loadCrypto()
  const unlockCode = formatUnlockCode(bytesToBase32(await Crypto.getRandomBytesAsync(UNLOCK_CODE_BYTES)))
  const key = await deriveEncryptionKey(Crypto, unlockCode)
  const sealedData = await Crypto.aesEncryptAsync(
    utf8(normalized.pat),
    key,
    { additionalData: utf8(inviteAad(normalized)) },
  )
  const sealed = await sealedData.combined('base64')
  if (typeof sealed !== 'string') throw new Error('Fantazone non è riuscito a serializzare l’invito cifrato.')

  const invite: GroupInvitePayload = {
    group: normalized.group,
    repository: normalized.repository,
    email: normalized.email,
    sealed,
  }

  return {
    fragment: createInviteFragment(invite),
    unlockCode,
  }
}

/** Reads only the current encrypted link envelope; no legacy invite formats are accepted. */
export function parseInviteLinkFragment(fragment: string): GroupInvitePayload | null {
  return parseInviteFragment(fragment)
}

/** Unlocks the PAT only when the separately delivered random code is correct. */
export async function decryptInvitePat(invite: GroupInvitePayload, unlockCode: string): Promise<string> {
  const normalizedCode = normalizeInviteUnlockCode(unlockCode)
  if (!isValidUnlockCode(normalizedCode)) {
    throw new Error('Il codice di sblocco non è valido. Controlla tutti i gruppi di caratteri e riprova.')
  }

  const Crypto = await loadCrypto()
  const key = await deriveEncryptionKey(Crypto, normalizedCode)

  try {
    const sealedData = Crypto.AESSealedData.fromCombined(invite.sealed)
    const decrypted = await Crypto.aesDecryptAsync(
      sealedData,
      key,
      {
        additionalData: utf8(inviteAad(invite)),
        output: 'bytes',
      },
    )
    const pat = text(typeof decrypted === 'string' ? base64ToBytes(decrypted) : decrypted).trim()
    if (!pat) throw new Error('empty plaintext')
    return pat
  } catch {
    throw new Error('Codice di sblocco errato oppure invito alterato. Il PAT non è stato decifrato.')
  }
}

export function normalizeInviteUnlockCode(value: string): string {
  return value.trim().toUpperCase().replace(/[\s-]+/g, '')
}

export function isValidInviteUnlockCode(value: string): boolean {
  return isValidUnlockCode(normalizeInviteUnlockCode(value))
}

function normalizeSharedInvite(payload: SharedCredentialInvite): SharedCredentialInvite {
  const group = payload.group.trim()
  const repository = normalizeRepository(payload.repository)
  const email = payload.email.trim().toLowerCase()
  const pat = payload.pat.trim()
  if (!group || !repository || !email.includes('@') || !pat) throw new Error('Invito Fantazone non valido.')
  return { group, repository, email, pat }
}

function inviteAad(value: Pick<GroupInvitePayload, 'group' | 'repository' | 'email'>): string {
  return JSON.stringify({
    group: value.group.trim(),
    repository: normalizeRepository(value.repository),
    email: value.email.trim().toLowerCase(),
  })
}

async function deriveEncryptionKey(Crypto: CryptoModule, unlockCode: string) {
  const normalized = normalizeInviteUnlockCode(unlockCode)
  if (!isValidUnlockCode(normalized)) throw new Error('Codice di sblocco Fantazone non valido.')

  const digestBase64 = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${KEY_DERIVATION_CONTEXT}${normalized}`,
    { encoding: Crypto.CryptoEncoding.BASE64 },
  )
  return Crypto.AESEncryptionKey.import(digestBase64, 'base64')
}

function isValidUnlockCode(value: string): boolean {
  return value.length === UNLOCK_CODE_LENGTH && [...value].every(char => UNLOCK_CODE_ALPHABET.includes(char))
}

function formatUnlockCode(value: string): string {
  return value.match(/.{1,4}/g)?.join('-') ?? value
}

function bytesToBase32(bytes: Uint8Array): string {
  let output = ''
  let buffer = 0
  let bits = 0

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      output += UNLOCK_CODE_ALPHABET[(buffer >> bits) & 31]
      buffer &= (1 << bits) - 1
    }
  }

  if (bits > 0) output += UNLOCK_CODE_ALPHABET[(buffer << (5 - bits)) & 31]
  return output
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

function base64ToBytes(value: string): Uint8Array {
  const normalized = value.replace(/\s+/g, '')
  const bytes: number[] = []
  let buffer = 0
  let bits = 0

  for (const char of normalized.replace(/=+$/g, '')) {
    const index = BASE64.indexOf(char)
    if (index < 0) throw new Error('Base64 non valido.')
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

async function loadCrypto(): Promise<CryptoModule> {
  return import('expo-crypto')
}
