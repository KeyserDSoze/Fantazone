import { Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import type { GroupConnection } from './groupSessionRuntime'

const STORAGE_KEY = 'fantazone.github.group.v1'

export type StoredGroupConnection = GroupConnection

export async function loadGroupConnection(): Promise<StoredGroupConnection | null> {
  const raw = Platform.OS === 'web'
    ? getWebStorage()?.getItem(STORAGE_KEY) ?? null
    : await SecureStore.getItemAsync(STORAGE_KEY)

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
  const raw = JSON.stringify(connection)
  if (Platform.OS === 'web') {
    getWebStorage()?.setItem(STORAGE_KEY, raw)
    return
  }
  await SecureStore.setItemAsync(STORAGE_KEY, raw)
}

export async function clearGroupConnection(): Promise<void> {
  if (Platform.OS === 'web') {
    getWebStorage()?.removeItem(STORAGE_KEY)
    return
  }
  await SecureStore.deleteItemAsync(STORAGE_KEY)
}

function getWebStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}
