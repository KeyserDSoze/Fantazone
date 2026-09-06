import { GitHubApiError, type GitHubContentWriteResult } from './githubClient'
import type { RepositoryContentClient } from './repositoryStore'
import type { GroupRepositoryTarget } from './repositoryTarget'

export const REPOSITORY_MANIFEST_PATH = 'manifest.json'

export type RepositoryRevisionManifest = {
  schemaVersion: number
  revision: number
  updatedAt: string
  /** True while an application write may still be in flight. */
  updating?: boolean
  [key: string]: unknown
}

/**
 * Decorates one content client so application writes to the selected group repository
 * publish a two-phase manifest revision around the actual document write.
 *
 * Phase 1 advances the revision and marks the repository as `updating`. Phase 2,
 * after the document write succeeds, advances it again and marks it stable. A watcher
 * that happens to observe phase 1 must therefore invalidate conservatively instead of
 * accepting that revision as a stable snapshot. If a process/network failure leaves
 * the manifest in `updating`, repeated watcher checks remain safe and keep refreshing
 * stale documents rather than silently trusting them.
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

  async tryGetContent(owner: string, repo: string, path: string, ref?: string): Promise<{ sha: string; content: string } | null> {
    return this.client.tryGetContent(owner, repo, path, ref)
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
    const startedRevision = await this.transitionRevision(ref, true)

    let result: GitHubContentWriteResult
    try {
      result = await this.client.putContent(owner, repo, path, text, message, sha, branch)
    } catch (error) {
      // No canonical write was committed. Best-effort close the transition so a
      // transient conflict does not leave the repository permanently marked busy.
      if (startedRevision !== null) {
        try {
          await this.transitionRevision(ref, false)
        } catch {
          // Leaving `updating: true` is conservative and therefore still sync-safe.
        }
      }
      throw error
    }

    if (startedRevision !== null) await this.transitionRevision(ref, false)
    return result
  }

  private shouldTrack(owner: string, repo: string, path: string): boolean {
    return owner.toLowerCase() === this.target.owner.toLowerCase() &&
      repo.toLowerCase() === this.target.repo.toLowerCase() &&
      path !== REPOSITORY_MANIFEST_PATH
  }

  private async transitionRevision(ref: string | undefined, updating: boolean): Promise<number | null> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
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
        if (!retryable || attempt === 3) throw error
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

function decodeRepositoryRevisionManifestText(content: string): RepositoryRevisionManifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (error) {
    throw new Error('manifest.json non contiene JSON valido.', { cause: error })
  }
  return decodeRepositoryRevisionManifest(parsed)
}
