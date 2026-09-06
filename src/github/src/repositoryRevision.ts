import { GitHubApiError, type GitHubContentWriteResult } from './githubClient'
import type { RepositoryContentClient } from './repositoryStore'
import type { GroupRepositoryTarget } from './repositoryTarget'

export const REPOSITORY_MANIFEST_PATH = 'manifest.json'

export type RepositoryRevisionManifest = {
  schemaVersion: number
  revision: number
  updatedAt: string
  [key: string]: unknown
}

/**
 * Decorates one content client so every application write to the selected group
 * repository advances manifest.revision before writing the actual document.
 *
 * Advancing first intentionally permits a harmless no-op revision when the later
 * document write conflicts. The opposite ordering could leave changed data behind
 * without advancing the sync clock, which would make remote caches unsafe.
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
    if (this.shouldAdvance(owner, repo, path)) {
      await this.advanceRevision(branch ?? this.target.ref)
    }
    return this.client.putContent(owner, repo, path, text, message, sha, branch)
  }

  private shouldAdvance(owner: string, repo: string, path: string): boolean {
    return owner.toLowerCase() === this.target.owner.toLowerCase() &&
      repo.toLowerCase() === this.target.repo.toLowerCase() &&
      path !== REPOSITORY_MANIFEST_PATH
  }

  private async advanceRevision(ref?: string): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const current = await this.client.tryGetContent(
        this.target.owner,
        this.target.repo,
        REPOSITORY_MANIFEST_PATH,
        ref,
      )
      // Legacy/malformed repositories are initialized before a runtime is opened.
      // If a custom test/client omits the manifest, preserve backwards compatibility.
      if (!current) return

      const manifest = decodeRepositoryRevisionManifestText(current.content)
      const next: RepositoryRevisionManifest = {
        ...manifest,
        revision: manifest.revision + 1,
        updatedAt: this.now().toISOString(),
      }

      try {
        await this.client.putContent(
          this.target.owner,
          this.target.repo,
          REPOSITORY_MANIFEST_PATH,
          `${JSON.stringify(next, null, 2)}\n`,
          `chore: advance repository revision to ${next.revision}`,
          current.sha,
          ref,
        )
        this._lastRevision = next.revision
        return
      } catch (error) {
        const retryable = error instanceof GitHubApiError && (error.status === 409 || error.status === 422)
        if (!retryable || attempt === 3) throw error
      }
    }
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
