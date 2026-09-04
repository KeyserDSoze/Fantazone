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
 *
 * It intentionally hides the GitHub Contents API details from product code:
 * - parsed JSON values are cached by owner/repo/path/ref;
 * - the Git blob SHA acts as an optimistic concurrency token;
 * - writes update the cache with GitHub's newly returned SHA;
 * - 409/stale-SHA style responses become a domain-specific conflict error.
 */
export class GitHubJsonStore {
  private readonly cache = new Map<string, CacheEntry>()

  constructor(private readonly client: RepositoryContentClient) {}

  async readJson<T>(
    location: RepositoryJsonLocation,
    options: RepositoryJsonReadOptions = {},
  ): Promise<RepositoryJsonSnapshot<T>> {
    const snapshot = await this.tryReadJson<T>(location, options)
    if (!snapshot) throw new RepositoryJsonNotFoundError(location)
    return snapshot
  }

  async tryReadJson<T>(
    location: RepositoryJsonLocation,
    options: RepositoryJsonReadOptions = {},
  ): Promise<RepositoryJsonSnapshot<T> | null> {
    const key = cacheKey(location)
    const cached = this.cache.get(key)
    if (cached && !options.refresh) {
      return {
        value: cloneJson(cached.value as T),
        sha: cached.sha,
        fromCache: true,
      }
    }

    const content = await this.client.tryGetContent(location.owner, location.repo, location.path, location.ref)
    if (!content) {
      this.cache.delete(key)
      return null
    }

    let value: T
    try {
      value = JSON.parse(content.content) as T
    } catch (error) {
      throw new RepositoryJsonParseError(location, error)
    }

    this.cache.set(key, { value: cloneJson(value), sha: content.sha })
    return { value: cloneJson(value), sha: content.sha, fromCache: false }
  }

  async writeJson<T>(
    location: RepositoryJsonLocation,
    value: T,
    message: string,
    options: RepositoryJsonWriteOptions = {},
  ): Promise<RepositoryJsonSnapshot<T>> {
    const writeRef = options.branch ?? location.ref
    const writeLocation = writeRef ? { ...location, ref: writeRef } : location
    const key = cacheKey(writeLocation)
    const cached = this.cache.get(key)
    let expectedSha = options.expectedSha ?? cached?.sha

    if (options.createOnly) {
      if (expectedSha) throw new RepositoryWriteConflictError(writeLocation, 409)
      const current = await this.client.tryGetContent(
        writeLocation.owner,
        writeLocation.repo,
        writeLocation.path,
        writeLocation.ref,
      )
      if (current) throw new RepositoryWriteConflictError(writeLocation, 409)
    } else if (!expectedSha) {
      // Fetch a fresh version before an update so the write is never a blind overwrite.
      const current = await this.client.tryGetContent(
        writeLocation.owner,
        writeLocation.repo,
        writeLocation.path,
        writeLocation.ref,
      )
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
      this.cache.set(key, { value: cloneJson(value), sha: result.sha })
      return { value: cloneJson(value), sha: result.sha, fromCache: false }
    } catch (error) {
      if (error instanceof GitHubApiError && (error.status === 409 || (error.status === 422 && Boolean(expectedSha)))) {
        this.cache.delete(key)
        throw new RepositoryWriteConflictError(writeLocation, error.status, error)
      }
      throw error
    }
  }

  invalidate(location?: RepositoryJsonLocation): void {
    if (!location) {
      this.cache.clear()
      return
    }
    this.cache.delete(cacheKey(location))
  }

  invalidateRepository(owner: string, repo: string): void {
    const prefix = `${owner.toLowerCase()}/${repo.toLowerCase()}/`
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) this.cache.delete(key)
    }
  }
}

function cacheKey(location: RepositoryJsonLocation): string {
  return `${location.owner.toLowerCase()}/${location.repo.toLowerCase()}/${location.path}@${location.ref ?? ''}`
}

function formatLocation(location: RepositoryJsonLocation): string {
  return `${location.owner}/${location.repo}/${location.path}${location.ref ? `@${location.ref}` : ''}`
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
