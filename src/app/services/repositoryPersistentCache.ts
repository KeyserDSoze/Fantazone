import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'
import type { RepositoryJsonCacheEntry, RepositoryJsonPersistentCache } from '@fantazone/github'

const CACHE_NAMESPACE = 'fantazone.repository-json.v1:'
const WEB_DB_NAME = 'fantazone-repository-cache'
const WEB_DB_VERSION = 1
const WEB_STORE_NAME = 'documents'

class NativeRepositoryJsonCache implements RepositoryJsonPersistentCache {
  async get(key: string): Promise<RepositoryJsonCacheEntry | null> {
    const raw = await AsyncStorage.getItem(storageKey(key))
    if (!raw) return null
    return decodeEntry(raw)
  }

  async set(key: string, entry: RepositoryJsonCacheEntry): Promise<void> {
    await AsyncStorage.setItem(storageKey(key), JSON.stringify(entry))
  }

  async delete(key: string): Promise<void> {
    await AsyncStorage.removeItem(storageKey(key))
  }

  async deleteByPrefix(prefix: string, preserveKeys: readonly string[] = []): Promise<void> {
    const preserve = new Set(preserveKeys.map(storageKey))
    const fullPrefix = storageKey(prefix)
    const keys = await AsyncStorage.getAllKeys()
    const removable = keys.filter(key => key.startsWith(fullPrefix) && !preserve.has(key))
    if (removable.length > 0) await AsyncStorage.multiRemove(removable)
  }

  async clear(): Promise<void> {
    const keys = await AsyncStorage.getAllKeys()
    const removable = keys.filter(key => key.startsWith(CACHE_NAMESPACE))
    if (removable.length > 0) await AsyncStorage.multiRemove(removable)
  }
}

class IndexedDbRepositoryJsonCache implements RepositoryJsonPersistentCache {
  private databasePromise: Promise<any> | null = null

  async get(key: string): Promise<RepositoryJsonCacheEntry | null> {
    const db = await this.database()
    const transaction = db.transaction(WEB_STORE_NAME, 'readonly')
    const value = await requestResult<unknown>(transaction.objectStore(WEB_STORE_NAME).get(key))
    return isCacheEntry(value) ? value : null
  }

  async set(key: string, entry: RepositoryJsonCacheEntry): Promise<void> {
    const db = await this.database()
    const transaction = db.transaction(WEB_STORE_NAME, 'readwrite')
    const completed = transactionCompleted(transaction)
    transaction.objectStore(WEB_STORE_NAME).put(entry, key)
    await completed
  }

  async delete(key: string): Promise<void> {
    const db = await this.database()
    const transaction = db.transaction(WEB_STORE_NAME, 'readwrite')
    const completed = transactionCompleted(transaction)
    transaction.objectStore(WEB_STORE_NAME).delete(key)
    await completed
  }

  async deleteByPrefix(prefix: string, preserveKeys: readonly string[] = []): Promise<void> {
    const db = await this.database()
    const transaction = db.transaction(WEB_STORE_NAME, 'readwrite')
    const completed = transactionCompleted(transaction)
    const store = transaction.objectStore(WEB_STORE_NAME)
    const keys = await requestResult<unknown[]>(store.getAllKeys())
    const preserve = new Set(preserveKeys)
    for (const candidate of keys) {
      const key = String(candidate)
      if (key.startsWith(prefix) && !preserve.has(key)) store.delete(candidate)
    }
    await completed
  }

  async clear(): Promise<void> {
    const db = await this.database()
    const transaction = db.transaction(WEB_STORE_NAME, 'readwrite')
    const completed = transactionCompleted(transaction)
    transaction.objectStore(WEB_STORE_NAME).clear()
    await completed
  }

  private database(): Promise<any> {
    if (!this.databasePromise) this.databasePromise = openDatabase()
    return this.databasePromise
  }
}

export const repositoryPersistentCache: RepositoryJsonPersistentCache =
  Platform.OS === 'web' ? new IndexedDbRepositoryJsonCache() : new NativeRepositoryJsonCache()

function storageKey(key: string): string {
  return `${CACHE_NAMESPACE}${key}`
}

function decodeEntry(raw: string): RepositoryJsonCacheEntry | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    return isCacheEntry(parsed) ? parsed : null
  } catch {
    return null
  }
}

function isCacheEntry(value: unknown): value is RepositoryJsonCacheEntry {
  if (!value || typeof value !== 'object') return false
  return typeof (value as { sha?: unknown }).sha === 'string' && 'value' in value
}

function openDatabase(): Promise<any> {
  const indexedDb = (globalThis as any).indexedDB
  if (!indexedDb) return Promise.reject(new Error('IndexedDB non è disponibile in questo browser.'))

  return new Promise((resolve, reject) => {
    const request = indexedDb.open(WEB_DB_NAME, WEB_DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(WEB_STORE_NAME)) db.createObjectStore(WEB_STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Impossibile aprire la cache IndexedDB.'))
  })
}

function requestResult<T>(request: any): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as T)
    request.onerror = () => reject(request.error ?? new Error('Operazione IndexedDB non riuscita.'))
  })
}

function transactionCompleted(transaction: any): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Transazione IndexedDB non riuscita.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Transazione IndexedDB annullata.'))
  })
}
