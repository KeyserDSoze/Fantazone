import type { GroupInvitePayload } from '@fantazone/domain'
import { createInviteFragment, parseInviteFragment } from '@fantazone/github'
import {
  deriveInviteSecretKey,
  INVITE_PASSWORD_KDF_ITERATIONS,
  INVITE_PASSWORD_MAX_LENGTH,
  INVITE_PASSWORD_MIN_LENGTH,
} from './invitePasswordKdf'

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const SECRET_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
const RANDOM_SECRET_BYTES = 20
const RANDOM_SECRET_LENGTH = 32
const INVITE_SALT_BYTES = 16

type CryptoModule = typeof import('expo-crypto')

type BaseInviteInput = {
  group: string
  repository: string
  pat: string
}

type EmailInviteInput = BaseInviteInput & { email: string }

export type EncryptedInviteCreation = {
  fragment: string
  unlockCode: string
}

/** Creates an invitation bound to one Microsoft email plus a random 160-bit code. */
export async function createEncryptedInviteFragment(payload: EmailInviteInput): Promise<EncryptedInviteCreation> {
  const normalized = normalizeBaseInvite(payload)
  const email = payload.email.trim().toLowerCase()
  if (!email.includes('@')) throw new Error('Inserisci una email Microsoft valida per l’invito.')

  const Crypto = await loadCrypto()
  const unlockCode = formatRandomSecret(bytesToBase32(await Crypto.getRandomBytesAsync(RANDOM_SECRET_BYTES)))
  const fragment = await createProtectedFragment(Crypto, {
    mode: 'email',
    group: normalized.group,
    repository: normalized.repository,
    email,
    pat: normalized.pat,
  }, normalizeInviteUnlockCode(unlockCode))

  return { fragment, unlockCode }
}

/**
 * Creates one reusable group invitation protected by a password chosen by the admin.
 * The password never travels in the URL; every Microsoft identity that knows both
 * link and password can request Participant enrollment on first access.
 */
export async function createSharedPasswordInviteFragment(
  payload: BaseInviteInput,
  password: string,
): Promise<{ fragment: string }> {
  const normalized = normalizeBaseInvite(payload)
  const secret = normalizeSharedInvitePassword(password)
  if (!isValidSharedInvitePassword(secret)) {
    throw new Error(`La password del gruppo deve contenere almeno ${INVITE_PASSWORD_MIN_LENGTH} caratteri.`)
  }

  const Crypto = await loadCrypto()
  const fragment = await createProtectedFragment(Crypto, {
    mode: 'shared',
    group: normalized.group,
    repository: normalized.repository,
    pat: normalized.pat,
  }, secret)
  return { fragment }
}

/** Generates a high-entropy password that can be used instead of choosing one manually. */
export async function generateSharedInvitePassword(): Promise<string> {
  const Crypto = await loadCrypto()
  return formatRandomSecret(bytesToBase32(await Crypto.getRandomBytesAsync(RANDOM_SECRET_BYTES)))
}

/** Reads only the single current encrypted invitation envelope. */
export function parseInviteLinkFragment(fragment: string): GroupInvitePayload | null {
  return parseInviteFragment(fragment)
}

/** Unlocks the PAT using either the email invitation code or the shared group password. */
export async function decryptInvitePat(invite: GroupInvitePayload, secretInput: string): Promise<string> {
  const secret = invite.mode === 'email'
    ? normalizeInviteUnlockCode(secretInput)
    : normalizeSharedInvitePassword(secretInput)

  if (invite.mode === 'email' && !isValidUnlockCode(secret)) {
    throw new Error('Il codice di sblocco non è valido. Controlla tutti i gruppi di caratteri e riprova.')
  }
  if (invite.mode === 'shared' && !isValidSharedInvitePassword(secret)) {
    throw new Error(`La password del gruppo deve contenere almeno ${INVITE_PASSWORD_MIN_LENGTH} caratteri.`)
  }
  if (invite.iterations !== INVITE_PASSWORD_KDF_ITERATIONS) {
    throw new Error('Questo link non usa il formato di invito corrente di Fantazone.')
  }

  const salt = base64ToBytes(invite.salt)
  if (salt.length !== INVITE_SALT_BYTES) throw new Error('Il salt dell’invito non è valido.')

  const Crypto = await loadCrypto()
  const keyBytes = await deriveInviteSecretKey(secret, salt, invite.iterations)
  const key = await Crypto.AESEncryptionKey.import(bytesToBase64(keyBytes), 'base64')

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
    throw new Error(invite.mode === 'email'
      ? 'Codice di sblocco errato oppure invito alterato. Il PAT non è stato decifrato.'
      : 'Password del gruppo errata oppure invito alterato. Il PAT non è stato decifrato.')
  }
}

export function normalizeInviteUnlockCode(value: string): string {
  return value.trim().toUpperCase().replace(/[\s-]+/g, '')
}

export function isValidInviteUnlockCode(value: string): boolean {
  return isValidUnlockCode(normalizeInviteUnlockCode(value))
}

export function normalizeSharedInvitePassword(value: string): string {
  return value.trim()
}

export function isValidSharedInvitePassword(value: string): boolean {
  const normalized = normalizeSharedInvitePassword(value)
  return normalized.length >= INVITE_PASSWORD_MIN_LENGTH && normalized.length <= INVITE_PASSWORD_MAX_LENGTH
}

async function createProtectedFragment(
  Crypto: CryptoModule,
  payload: BaseInviteInput & { mode: 'email'; email: string } | BaseInviteInput & { mode: 'shared' },
  secret: string,
): Promise<string> {
  const saltBytes = await Crypto.getRandomBytesAsync(INVITE_SALT_BYTES)
  const salt = bytesToBase64(saltBytes)
  const metadata: GroupInvitePayload = payload.mode === 'email'
    ? {
        mode: 'email',
        group: payload.group,
        repository: payload.repository,
        email: payload.email,
        salt,
        iterations: INVITE_PASSWORD_KDF_ITERATIONS,
        sealed: '',
      }
    : {
        mode: 'shared',
        group: payload.group,
        repository: payload.repository,
        salt,
        iterations: INVITE_PASSWORD_KDF_ITERATIONS,
        sealed: '',
      }

  const keyBytes = await deriveInviteSecretKey(secret, saltBytes, metadata.iterations)
  const key = await Crypto.AESEncryptionKey.import(bytesToBase64(keyBytes), 'base64')
  const sealedData = await Crypto.aesEncryptAsync(
    utf8(payload.pat),
    key,
    { additionalData: utf8(inviteAad(metadata)) },
  )
  const sealed = await sealedData.combined('base64')
  if (typeof sealed !== 'string') throw new Error('Fantazone non è riuscito a serializzare l’invito cifrato.')

  return createInviteFragment({ ...metadata, sealed })
}

function normalizeBaseInvite(payload: BaseInviteInput): BaseInviteInput {
  const group = payload.group.trim()
  const repository = normalizeRepository(payload.repository)
  const pat = payload.pat.trim()
  if (!group || !repository || !pat) throw new Error('Invito Fantazone non valido.')
  return { group, repository, pat }
}

function inviteAad(value: GroupInvitePayload): string {
  return JSON.stringify({
    mode: value.mode,
    group: value.group.trim(),
    repository: normalizeRepository(value.repository),
    email: value.mode === 'email' ? value.email?.trim().toLowerCase() : null,
    salt: value.salt,
    iterations: value.iterations,
  })
}

function isValidUnlockCode(value: string): boolean {
  return value.length === RANDOM_SECRET_LENGTH && [...value].every(char => SECRET_ALPHABET.includes(char))
}

function formatRandomSecret(value: string): string {
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
      output += SECRET_ALPHABET[(buffer >> bits) & 31]
      buffer &= (1 << bits) - 1
    }
  }

  if (bits > 0) output += SECRET_ALPHABET[(buffer << (5 - bits)) & 31]
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

function bytesToBase64(bytes: Uint8Array): string {
  let output = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index]
    const hasB = index + 1 < bytes.length
    const hasC = index + 2 < bytes.length
    const b = hasB ? bytes[index + 1] : 0
    const c = hasC ? bytes[index + 2] : 0
    output += BASE64[a >> 2]
    output += BASE64[((a & 0x03) << 4) | (b >> 4)]
    output += hasB ? BASE64[((b & 0x0f) << 2) | (c >> 6)] : '='
    output += hasC ? BASE64[c & 0x3f] : '='
  }
  return output
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
