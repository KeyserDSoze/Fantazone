import { GitHubApiError, type GitHubContentWriteResult } from './githubClient'

export type RepositoryJsonLocation = {
  owner: string
  repo: string
  path: string
  ref?: string
}

export type RepositoryJsonSnapshot<T> = {
  value: T
  sha: string
  fromCache: boolean
}

export type RepositoryJsonReadOptions = {
  refresh?: boolean
}

export type RepositoryJsonWriteOptions = {
  /** Explicit optimistic-concurrency version. Falls back to a cached/fresh SHA. */
  expectedSha?: string
  /** Branch to update. Defaults to location.ref / repository default branch. */
  branch?: string
  /** Fail if the file already exists instead of updating it. */
  createOnly?: boolean
}

export type RepositoryJsonCacheEntry = {
  value: unknown
  sha: string
}

/**
 * Optional durable cache used by applications to persist JSON snapshots across
 * process restarts. The GitHub layer only deals in opaque cache keys so the app
 * can choose IndexedDB, AsyncStorage, SQLite, etc. without coupling this package
 * to one runtime.
 */
export interface RepositoryJsonPersistentCache {
  get(key: string): Promise<RepositoryJsonCacheEntry | null>
  set(key: string, entry: RepositoryJsonCacheEntry): Promise<void>
  delete(key: string): Promise<void>
  deleteByPrefix(prefix: string, preserveKeys?: readonly string[]): Promise<void>
  clear(): Promise<void>
}

export interface RepositoryContentClient {
  tryGetContent(owner: string, repo: string, path: string, ref?: string): Promise<{ sha: string; content: string } | null>
  putContent(
    owner: string,
    repo: string,
    path: string,
    text: string,
    message: string,
    sha?: string,
    branch?: string,
  ): Promise<GitHubContentWriteResult>
}

export class RepositoryJsonNotFoundError extends Error {
  constructor(public readonly location: RepositoryJsonLocation) {
    super(`Repository JSON not found: ${formatLocation(location)}`)
    this.name = 'RepositoryJsonNotFoundError'
  }
}

export class RepositoryJsonParseError extends Error {
  constructor(public readonly location: RepositoryJsonLocation, public readonly cause: unknown) {
    super(`Invalid JSON in ${formatLocation(location)}`)
    this.name = 'RepositoryJsonParseError'
  }
}

export class RepositoryWriteConflictError extends Error {
  constructor(
    public readonly location: RepositoryJsonLocation,
    public readonly status: number,
    public readonly cause?: unknown,
  ) {
    super(`Repository write conflict (${status}) for ${formatLocation(location)}`)
    this.name = 'RepositoryWriteConflictError'
  }
}

type CacheEntry = {
  value: unknown
  sha: string
}

/**
 * Small JSON persistence boundary used by screens, domain services and Actions.
 * Git blob SHA is the optimistic-concurrency token for every mutable document.
 */
export class GitHubJsonStore {
  private readonly cache = new Map<string, CacheEntry>()

  constructor(
    private readonly client: RepositoryContentClient,
    private readonly persistentCache?: RepositoryJsonPersistentCache,
  ) {}

  async readJson<T>(location: RepositoryJsonLocation, options: RepositoryJsonReadOptions = {}): Promise<RepositoryJsonSnapshot<T>> {
    const snapshot = await this.tryReadJson<T>(location, options)
    if (!snapshot) throw new RepositoryJsonNotFoundError(location)
    return snapshot
  }

  /** Returns only an in-memory/durable cache snapshot and never performs a GitHub request. */
  async readCachedJson<T>(location: RepositoryJsonLocation): Promise<RepositoryJsonSnapshot<T> | null> {
    const key = cacheKey(location)
    const memory = this.cache.get(key)
    if (memory) return snapshotFromCache<T>(memory)

    const persisted = await this.safePersistentGet(key)
    if (!persisted) return null
    const entry: CacheEntry = { value: cloneJson(persisted.value), sha: persisted.sha }
    this.cache.set(key, entry)
    return snapshotFromCache<T>(entry)
  }

  async tryReadJson<T>(location: RepositoryJsonLocation, options: RepositoryJsonReadOptions = {}): Promise<RepositoryJsonSnapshot<T> | null> {
    const key = cacheKey(location)
    if (!options.refresh) {
      const cached = await this.readCachedJson<T>(location)
      if (cached) return cached
    }

    const content = await this.client.tryGetContent(location.owner, location.repo, location.path, location.ref)
    if (!content) {
      await this.forget(key)
      return null
    }

    let value: T
    try {
      value = JSON.parse(content.content) as T
    } catch (error) {
      throw new RepositoryJsonParseError(location, error)
    }

    const entry: CacheEntry = { value: cloneJson(value), sha: content.sha }
    await this.remember(key, entry)
    return { value: cloneJson(value), sha: content.sha, fromCache: false }
  }

  async writeJson<T>(location: RepositoryJsonLocation, value: T, message: string, options: RepositoryJsonWriteOptions = {}): Promise<RepositoryJsonSnapshot<T>> {
    const writeRef = options.branch ?? location.ref
    const writeLocation = writeRef ? { ...location, ref: writeRef } : location
    const key = cacheKey(writeLocation)
    const cached = this.cache.get(key)
    let expectedSha = options.expectedSha ?? cached?.sha

    if (options.createOnly) {
      if (expectedSha) throw new RepositoryWriteConflictError(writeLocation, 409)
      const current = await this.client.tryGetContent(writeLocation.owner, writeLocation.repo, writeLocation.path, writeLocation.ref)
      if (current) throw new RepositoryWriteConflictError(writeLocation, 409)
    } else if (!expectedSha) {
      const current = await this.client.tryGetContent(writeLocation.owner, writeLocation.repo, writeLocation.path, writeLocation.ref)
      expectedSha = current?.sha
    }

    try {
      const result = await this.client.putContent(
        writeLocation.owner,
        writeLocation.repo,
        writeLocation.path,
        `${JSON.stringify(value, null, 2)}\n`,
        message,
        expectedSha,
        writeLocation.ref,
      )
      const entry: CacheEntry = { value: cloneJson(value), sha: result.sha }
      await this.remember(key, entry)
      return { value: cloneJson(value), sha: result.sha, fromCache: false }
    } catch (error) {
      const conflict = error instanceof GitHubApiError && (
        error.status === 409 ||
        (error.status === 422 && (Boolean(expectedSha) || options.createOnly === true))
      )
      if (conflict) {
        await this.forget(key)
        throw new RepositoryWriteConflictError(writeLocation, error.status, error)
      }
      throw error
    }
  }

  async invalidate(location?: RepositoryJsonLocation): Promise<void> {
    if (!location) {
      this.cache.clear()
      await this.safePersistentClear()
      return
    }
    await this.forget(cacheKey(location))
  }

  async invalidateRepository(
    owner: string,
    repo: string,
    preserveLocations: readonly RepositoryJsonLocation[] = [],
  ): Promise<void> {
    const prefix = repositoryCachePrefix(owner, repo)
    const preserveKeys = new Set(preserveLocations.map(cacheKey))
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix) && !preserveKeys.has(key)) this.cache.delete(key)
    }
    await this.safePersistentDeleteByPrefix(prefix, [...preserveKeys])
  }

  private async remember(key: string, entry: CacheEntry): Promise<void> {
    const cloned: CacheEntry = { value: cloneJson(entry.value), sha: entry.sha }
    this.cache.set(key, cloned)
    if (!this.persistentCache) return
    try {
      await this.persistentCache.set(key, { value: cloneJson(cloned.value), sha: cloned.sha })
    } catch {
      // Durable caching is an optimization. GitHub remains the source of truth.
    }
  }

  private async forget(key: string): Promise<void> {
    this.cache.delete(key)
    if (!this.persistentCache) return
    try {
      await this.persistentCache.delete(key)
    } catch {
      // Ignore storage failures; a future refresh can repopulate the cache.
    }
  }

  private async safePersistentGet(key: string): Promise<RepositoryJsonCacheEntry | null> {
    if (!this.persistentCache) return null
    try {
      const entry = await this.persistentCache.get(key)
      if (!entry || typeof entry.sha !== 'string') return null
      return { value: cloneJson(entry.value), sha: entry.sha }
    } catch {
      return null
    }
  }

  private async safePersistentDeleteByPrefix(prefix: string, preserveKeys: readonly string[]): Promise<void> {
    if (!this.persistentCache) return
    try {
      await this.persistentCache.deleteByPrefix(prefix, preserveKeys)
    } catch {
      // Ignore storage failures; in-memory invalidation still takes effect.
    }
  }

  private async safePersistentClear(): Promise<void> {
    if (!this.persistentCache) return
    try {
      await this.persistentCache.clear()
    } catch {
      // Ignore storage failures; in-memory invalidation still takes effect.
    }
  }
}

function snapshotFromCache<T>(entry: CacheEntry): RepositoryJsonSnapshot<T> {
  return { value: cloneJson(entry.value as T), sha: entry.sha, fromCache: true }
}

function cacheKey(location: RepositoryJsonLocation): string {
  return `${repositoryCachePrefix(location.owner, location.repo)}${location.path}@${location.ref ?? ''}`
}

function repositoryCachePrefix(owner: string, repo: string): string {
  return `${owner.toLowerCase()}/${repo.toLowerCase()}/`
}

function formatLocation(location: RepositoryJsonLocation): string {
  return `${location.owner}/${location.repo}/${location.path}${location.ref ? `@${location.ref}` : ''}`
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
