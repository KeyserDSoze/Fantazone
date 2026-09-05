import { Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import type { GroupConnection } from './groupSessionRuntime'

const STORAGE_KEY = 'fantazone.github.group.v1'
const TOKEN_MAP_KEY = 'fantazone.github.tokens.v1'

export type StoredGroupConnection = GroupConnection

export async function loadGroupConnection(): Promise<StoredGroupConnection | null> {
  const raw = await readRaw(STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as StoredGroupConnection
    if (!parsed.token || !parsed.groupName || !parsed.repository?.full_name) return null
    return parsed
  } catch {
    return null
  }
}

export async function saveGroupConnection(connection: StoredGroupConnection): Promise<void> {
  await writeRaw(STORAGE_KEY, JSON.stringify(connection))
  await saveRepositoryToken(connection.repository.full_name, connection.token)
}

export async function clearGroupConnection(): Promise<void> {
  await removeRaw(STORAGE_KEY)
}

export async function loadRepositoryToken(repositoryFullName: string): Promise<string | null> {
  const map = await loadTokenMap()
  return map[normalizeRepository(repositoryFullName)] ?? null
}

export async function saveRepositoryToken(repositoryFullName: string, token: string): Promise<void> {
  const normalizedToken = token.trim()
  if (!normalizedToken) return
  const map = await loadTokenMap()
  map[normalizeRepository(repositoryFullName)] = normalizedToken
  await writeRaw(TOKEN_MAP_KEY, JSON.stringify(map))
}

export async function removeRepositoryToken(repositoryFullName: string): Promise<void> {
  const map = await loadTokenMap()
  delete map[normalizeRepository(repositoryFullName)]
  await writeRaw(TOKEN_MAP_KEY, JSON.stringify(map))
}

async function loadTokenMap(): Promise<Record<string, string>> {
  const raw = await readRaw(TOKEN_MAP_KEY)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && Boolean(entry[1])))
  } catch {
    return {}
  }
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
