import {
  GitHubApiError,
  type GitHubConditionalContentReadResult,
  type GitHubContentReadResult,
  type GitHubContentWriteResult,
} from './githubClient'
import type { RepositoryContentClient } from './repositoryStore'
import type { GroupRepositoryTarget } from './repositoryTarget'

export const REPOSITORY_MANIFEST_PATH = 'manifest.json'
export const REPOSITORY_REALTIME_PREFIX = 'realtime/'
export const REPOSITORY_REVISION_STALE_AFTER_MS = 5 * 60 * 1000

const REVISION_BEGIN_ATTEMPTS = 10
const REVISION_CLOSE_ATTEMPTS = 8
const REVISION_RETRY_BASE_MS = 100
const REVISION_RETRY_MAX_MS = 500

export type RepositoryRevisionManifest = {
  schemaVersion: number
  revision: number
  updatedAt: string
  /** True while an application write may still be in flight. */
  updating?: boolean
  [key: string]: unknown
}

/**
 * Decorates one content client so canonical application writes to the selected group
 * repository publish a two-phase manifest revision around the actual document write.
 * Transient `realtime/` signaling documents deliberately bypass the manifest: an SDP
 * rendezvous is not canonical group data and must not invalidate every cached screen.
 *
 * Phase 1 advances the revision and marks the repository as `updating`. Phase 2,
 * after the document write succeeds, advances it again and marks it stable. A watcher
 * that happens to observe phase 1 must therefore invalidate conservatively instead of
 * accepting that revision as a stable snapshot.
 *
 * New writers serialize on a fresh `updating` marker instead of publishing through an
 * in-flight revision. A marker older than the stale threshold is repaired with an
 * optimistic-SHA write before new work proceeds. The same repair is exposed to the
 * runtime watcher so a process/network failure cannot leave a repository permanently
 * busy. Every repair re-reads the marker after conflicts, so it never closes a newer,
 * fresh transition that raced with the repair attempt.
 */
export class RepositoryRevisionContentClient implements RepositoryContentClient {
  private _lastRevision: number | null = null

  constructor(
    private readonly client: RepositoryContentClient,
    private readonly target: GroupRepositoryTarget,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get lastRevision(): number | null {
    return this._lastRevision
  }

  async tryGetContent(owner: string, repo: string, path: string, ref?: string): Promise<GitHubContentReadResult | null> {
    return this.client.tryGetContent(owner, repo, path, ref)
  }

  async tryGetContentConditional(
    owner: string,
    repo: string,
    path: string,
    ref: string | undefined,
    etag: string,
  ): Promise<GitHubConditionalContentReadResult | null> {
    if (this.client.tryGetContentConditional) {
      return this.client.tryGetContentConditional(owner, repo, path, ref, etag)
    }
    const content = await this.client.tryGetContent(owner, repo, path, ref)
    return content ? { status: 'found', value: content } : null
  }

  async putContent(
    owner: string,
    repo: string,
    path: string,
    text: string,
    message: string,
    sha?: string,
    branch?: string,
  ): Promise<GitHubContentWriteResult> {
    if (!this.shouldTrack(owner, repo, path)) {
      return this.client.putContent(owner, repo, path, text, message, sha, branch)
    }

    const ref = branch ?? this.target.ref
    const startedRevision = await this.transitionRevision(ref, true, REVISION_BEGIN_ATTEMPTS)

    let result: GitHubContentWriteResult
    try {
      result = await this.client.putContent(owner, repo, path, text, message, sha, branch)
    } catch (error) {
      // No canonical write was committed. Best-effort close only the transition that
      // this writer actually started; a newer writer must retain ownership of its marker.
      if (startedRevision !== null) {
        try {
          await this.transitionRevision(ref, false, REVISION_CLOSE_ATTEMPTS, startedRevision)
        } catch {
          // Leaving `updating: true` is conservative and therefore still sync-safe.
        }
      }
      throw error
    }

    if (startedRevision !== null) {
      try {
        await this.transitionRevision(ref, false, REVISION_CLOSE_ATTEMPTS, startedRevision)
      } catch {
        // The canonical document write has already been committed. Reporting the
        // manifest-close race as a failure makes the UI claim that the document was
        // not written even though GitHub contains the new data. Pollers keep refreshing
        // conservatively and can repair a genuinely stale marker later.
      }
    }
    return result
  }

  /**
   * Repairs one stale `updating:true` marker and returns the stable revision that was
   * published. Returns null when the manifest is absent, already stable or still fresh.
   */
  async repairStaleRevision(
    ref: string | undefined = this.target.ref,
    staleAfterMs = REPOSITORY_REVISION_STALE_AFTER_MS,
  ): Promise<number | null> {
    const now = this.now()
    for (let attempt = 0; attempt < REVISION_CLOSE_ATTEMPTS; attempt += 1) {
      const current = await this.client.tryGetContent(
        this.target.owner,
        this.target.repo,
        REPOSITORY_MANIFEST_PATH,
        ref,
      )
      if (!current) return null

      const manifest = decodeRepositoryRevisionManifestText(current.content)
      if (!isRepositoryRevisionManifestStale(manifest, now, staleAfterMs)) {
        return null
      }

      const next: RepositoryRevisionManifest = {
        ...manifest,
        revision: manifest.revision + 1,
        updatedAt: now.toISOString(),
        updating: false,
      }

      try {
        await this.client.putContent(
          this.target.owner,
          this.target.repo,
          REPOSITORY_MANIFEST_PATH,
          `${JSON.stringify(next, null, 2)}\n`,
          `chore: repair stale repository revision ${next.revision}`,
          current.sha,
          ref,
        )
        this._lastRevision = next.revision
        return next.revision
      } catch (error) {
        const retryable = error instanceof GitHubApiError && (error.status === 409 || error.status === 422)
        if (!retryable || attempt === REVISION_CLOSE_ATTEMPTS - 1) throw error
        await sleep(Math.min(REVISION_RETRY_BASE_MS * (attempt + 1), REVISION_RETRY_MAX_MS))
      }
    }
    return null
  }

  private shouldTrack(owner: string, repo: string, path: string): boolean {
    return owner.toLowerCase() === this.target.owner.toLowerCase() &&
      repo.toLowerCase() === this.target.repo.toLowerCase() &&
      path !== REPOSITORY_MANIFEST_PATH &&
      !path.startsWith(REPOSITORY_REALTIME_PREFIX)
  }

  private async transitionRevision(
    ref: string | undefined,
    updating: boolean,
    maxAttempts: number,
    expectedUpdatingRevision?: number,
  ): Promise<number | null> {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const current = await this.client.tryGetContent(
        this.target.owner,
        this.target.repo,
        REPOSITORY_MANIFEST_PATH,
        ref,
      )
      // Legacy/test clients may omit the manifest. Production repositories are
      // initialized before the runtime is opened.
      if (!current) return null

      const manifest = decodeRepositoryRevisionManifestText(current.content)

      if (updating && manifest.updating === true) {
        if (isRepositoryRevisionManifestStale(manifest, this.now())) {
          await this.repairStaleRevision(ref)
          continue
        }
        if (attempt === maxAttempts - 1) {
          throw new GitHubApiError(409, `Repository revision ${manifest.revision} is already updating.`)
        }
        await sleep(Math.min(REVISION_RETRY_BASE_MS * (attempt + 1), REVISION_RETRY_MAX_MS))
        continue
      }

      if (!updating) {
        // Never close a transition that belongs to a newer writer. This matters when
        // an older client or another process races with the writer after phase 1.
        if (manifest.updating !== true) {
          this._lastRevision = manifest.revision
          return manifest.revision
        }
        if (expectedUpdatingRevision !== undefined && manifest.revision !== expectedUpdatingRevision) {
          return null
        }
      }

      const next: RepositoryRevisionManifest = {
        ...manifest,
        revision: manifest.revision + 1,
        updatedAt: this.now().toISOString(),
        updating,
      }

      try {
        await this.client.putContent(
          this.target.owner,
          this.target.repo,
          REPOSITORY_MANIFEST_PATH,
          `${JSON.stringify(next, null, 2)}\n`,
          updating
            ? `chore: begin repository revision ${next.revision}`
            : `chore: publish repository revision ${next.revision}`,
          current.sha,
          ref,
        )
        this._lastRevision = next.revision
        return next.revision
      } catch (error) {
        const retryable = error instanceof GitHubApiError && (error.status === 409 || error.status === 422)
        if (!retryable || attempt === maxAttempts - 1) throw error
        await sleep(Math.min(REVISION_RETRY_BASE_MS * (attempt + 1), REVISION_RETRY_MAX_MS))
      }
    }
    return null
  }
}

export function decodeRepositoryRevisionManifest(value: unknown): RepositoryRevisionManifest {
  if (!value || typeof value !== 'object') throw new Error('manifest.json non contiene un oggetto JSON valido.')
  const manifest = value as Record<string, unknown>
  if (!Number.isInteger(manifest.schemaVersion) || Number(manifest.schemaVersion) < 1) {
    throw new Error('manifest.json non contiene uno schemaVersion valido.')
  }
  if (!Number.isInteger(manifest.revision) || Number(manifest.revision) < 0) {
    throw new Error('manifest.json non contiene una revision valida.')
  }
  if (typeof manifest.updatedAt !== 'string') {
    throw new Error('manifest.json non contiene updatedAt valido.')
  }
  if (manifest.updating !== undefined && typeof manifest.updating !== 'boolean') {
    throw new Error('manifest.json non contiene uno stato updating valido.')
  }
  return manifest as RepositoryRevisionManifest
}

export function isRepositoryRevisionManifestStale(
  manifest: RepositoryRevisionManifest,
  now: Date = new Date(),
  staleAfterMs = REPOSITORY_REVISION_STALE_AFTER_MS,
): boolean {
  if (manifest.updating !== true) return false
  const updatedAt = Date.parse(manifest.updatedAt)
  if (!Number.isFinite(updatedAt)) return false
  return now.getTime() - updatedAt >= Math.max(0, staleAfterMs)
}

function decodeRepositoryRevisionManifestText(content: string): RepositoryRevisionManifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (error) {
    throw new Error('manifest.json non contiene JSON valido.', { cause: error })
  }
  return decodeRepositoryRevisionManifest(parsed)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
