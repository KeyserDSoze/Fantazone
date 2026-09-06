import { Platform } from 'react-native'
import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'
import type { ExternalIdentity } from '@fantazone/domain'
import type { GroupConnection } from './groupSessionRuntime'

const LEGACY_STORAGE_KEY = 'fantazone.github.group.v1'
const LEGACY_TOKEN_MAP_KEY = 'fantazone.github.tokens.v1'
const TOKEN_MAP_KEY_PREFIX = 'fantazone.github.tokens.v2.'

export type StoredGroupConnection = GroupConnection

/**
 * Legacy reader kept only so older installations remain decodable during the
 * transition. The Microsoft-first app no longer restores a repository session
 * before the human identity has been established.
 */
export async function loadGroupConnection(): Promise<StoredGroupConnection | null> {
  const raw = await readRaw(LEGACY_STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as StoredGroupConnection
    if (!parsed.token || !parsed.groupName || !parsed.repository?.full_name) return null
    return parsed
  } catch {
    return null
  }
}

export function credentialOwnerKey(identity: Pick<ExternalIdentity, 'provider' | 'subject'>): string {
  return `${identity.provider}:${identity.subject.trim()}`
}

export async function saveGroupConnection(connection: StoredGroupConnection, ownerKey: string): Promise<void> {
  await saveRepositoryToken(connection.repository.full_name, connection.token, ownerKey)
  // The old connection record duplicated the PAT without an identity namespace.
  // Purge it as soon as the user saves a credential under the v2 model.
  await removeRaw(LEGACY_STORAGE_KEY)
  await removeRaw(LEGACY_TOKEN_MAP_KEY)
}

export async function clearGroupConnection(): Promise<void> {
  await removeRaw(LEGACY_STORAGE_KEY)
}

export async function loadRepositoryToken(repositoryFullName: string, ownerKey: string): Promise<string | null> {
  const map = await loadTokenMap(ownerKey)
  return map[normalizeRepository(repositoryFullName)] ?? null
}

export async function saveRepositoryToken(repositoryFullName: string, token: string, ownerKey: string): Promise<void> {
  const normalizedToken = token.trim()
  if (!normalizedToken) return
  const map = await loadTokenMap(ownerKey)
  map[normalizeRepository(repositoryFullName)] = normalizedToken
  await writeRaw(await tokenMapStorageKey(ownerKey), JSON.stringify(map))
}

export async function removeRepositoryToken(repositoryFullName: string, ownerKey: string): Promise<void> {
  const map = await loadTokenMap(ownerKey)
  delete map[normalizeRepository(repositoryFullName)]
  await writeRaw(await tokenMapStorageKey(ownerKey), JSON.stringify(map))
}

async function loadTokenMap(ownerKey: string): Promise<Record<string, string>> {
  const raw = await readRaw(await tokenMapStorageKey(ownerKey))
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] =>
      typeof entry[1] === 'string' && Boolean(entry[1])))
  } catch {
    return {}
  }
}

async function tokenMapStorageKey(ownerKey: string): Promise<string> {
  const normalizedOwner = ownerKey.trim().toLowerCase()
  if (!normalizedOwner) throw new Error('Identità proprietaria delle credenziali GitHub non valida.')
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    normalizedOwner,
  )
  return `${TOKEN_MAP_KEY_PREFIX}${digest}`
}

async function readRaw(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return getWebStorage()?.getItem(key) ?? null
  return SecureStore.getItemAsync(key)
}

async function writeRaw(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    getWebStorage()?.setItem(key, value)
    return
  }
  await SecureStore.setItemAsync(key, value)
}

async function removeRaw(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    getWebStorage()?.removeItem(key)
    return
  }
  await SecureStore.deleteItemAsync(key)
}

function normalizeRepository(value: string): string {
  return value.trim().toLowerCase()
}

function getWebStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try { return window.localStorage } catch { return null }
}
