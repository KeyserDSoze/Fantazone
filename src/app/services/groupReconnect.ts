import {
  decodeRepositoryRevisionManifest,
  decodeStoredGroup,
  GitHubApiError,
  GitHubClient,
  GROUP_DOCUMENT_PATH,
  REPOSITORY_MANIFEST_PATH,
  type GitHubRepo,
} from '@fantazone/github'
import type { GroupConnection } from './groupSessionRuntime'
import type { StoredGroup } from './userSettingsOneDrive'

export interface StoredGroupReconnectClient {
  validateToken(): Promise<{ login: string }>
  getRepository(owner: string, repo: string): Promise<GitHubRepo>
  getContent(owner: string, repo: string, path: string, ref?: string): Promise<{ sha: string; content: string }>
}

export type KnownGroupReference = {
  name: string
  repository: string
}

export class StoredGroupRepositoryAccessError extends Error {
  constructor(readonly repository: string) {
    super(`Il PAT non può aprire il repository ${repository}.`)
    this.name = 'StoredGroupRepositoryAccessError'
  }
}

export class StoredGroupRepositoryReadError extends Error {
  constructor(readonly repository: string) {
    super(`Il PAT non ha accesso in lettura al repository ${repository}.`)
    this.name = 'StoredGroupRepositoryReadError'
  }
}

export class StoredGroupRepositoryWriteError extends Error {
  constructor(readonly repository: string) {
    super(`Il PAT non ha accesso in scrittura al repository ${repository}.`)
    this.name = 'StoredGroupRepositoryWriteError'
  }
}

export class StoredGroupRepositoryContractError extends Error {
  constructor(readonly repository: string, detail: string) {
    super(`Il repository ${repository} non è un gruppo Fantazone valido: ${detail}`)
    this.name = 'StoredGroupRepositoryContractError'
  }
}

/**
 * Connects a group whose exact repository is already authoritative (from OneDrive
 * settings or an invitation). The shared PAT is checked against the exact repo;
 * no repository listing/fallback is used.
 *
 * This preflight proves the token, exact repository, read/write repository flags
 * and a readable schema-v2 Group document. A missing revision manifest is accepted
 * for migrated/partially bootstrapped repositories: `ensureGroupInitialized()`
 * creates it (and any other missing managed runtime files) before the connection is
 * persisted by App.tsx. An existing manifest must still be valid.
 */
export async function connectKnownGroup(
  token: string,
  group: KnownGroupReference,
  client: StoredGroupReconnectClient = new GitHubClient(token.trim()),
): Promise<GroupConnection> {
  const normalizedToken = token.trim()
  if (!normalizedToken) throw new Error('Inserisci il PAT GitHub condiviso per collegare questo gruppo.')

  await client.validateToken()
  const target = parseRepository(group.repository)
  let repository: GitHubRepo
  try {
    repository = await client.getRepository(target.owner, target.repo)
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) {
      throw new StoredGroupRepositoryAccessError(group.repository)
    }
    throw error
  }

  if (repository.full_name.trim().toLowerCase() !== group.repository.trim().toLowerCase()) {
    throw new StoredGroupRepositoryAccessError(group.repository)
  }
  if (repository.permissions?.pull !== true) throw new StoredGroupRepositoryReadError(group.repository)
  if (repository.permissions?.push !== true) throw new StoredGroupRepositoryWriteError(group.repository)

  await validateCanonicalDocuments(client, repository)

  return {
    token: normalizedToken,
    repository,
    groupName: group.name,
  }
}

export async function reconnectStoredGroup(
  token: string,
  group: StoredGroup,
  client: StoredGroupReconnectClient = new GitHubClient(token.trim()),
): Promise<GroupConnection> {
  return connectKnownGroup(token, group, client)
}

export function shouldRecoverStoredGroupCredential(error: unknown): boolean {
  return error instanceof StoredGroupRepositoryAccessError ||
    error instanceof StoredGroupRepositoryReadError ||
    error instanceof StoredGroupRepositoryWriteError ||
    (error instanceof GitHubApiError && error.status === 401)
}

async function validateCanonicalDocuments(client: StoredGroupReconnectClient, repository: GitHubRepo): Promise<void> {
  const owner = repository.owner.login
  const repo = repository.name
  const ref = repository.default_branch
  try {
    const [manifestSnapshot, groupSnapshot] = await Promise.all([
      readOptionalManifest(client, repository),
      readRequiredGroupDocument(client, repository),
    ])

    decodeStoredGroup(JSON.parse(groupSnapshot.content), { owner, repo, ref })
    if (manifestSnapshot) decodeRepositoryRevisionManifest(JSON.parse(manifestSnapshot.content))
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new StoredGroupRepositoryContractError(repository.full_name, 'JSON canonico non valido')
    }
    if (error instanceof StoredGroupRepositoryContractError) throw error
    if (error instanceof GitHubApiError) throw error
    throw new StoredGroupRepositoryContractError(
      repository.full_name,
      error instanceof Error ? error.message : 'documenti canonici non validi',
    )
  }
}

async function readOptionalManifest(
  client: StoredGroupReconnectClient,
  repository: GitHubRepo,
): Promise<{ sha: string; content: string } | null> {
  try {
    return await client.getContent(
      repository.owner.login,
      repository.name,
      REPOSITORY_MANIFEST_PATH,
      repository.default_branch,
    )
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) return null
    throw error
  }
}

async function readRequiredGroupDocument(
  client: StoredGroupReconnectClient,
  repository: GitHubRepo,
): Promise<{ sha: string; content: string }> {
  try {
    return await client.getContent(
      repository.owner.login,
      repository.name,
      GROUP_DOCUMENT_PATH,
      repository.default_branch,
    )
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) {
      throw new StoredGroupRepositoryContractError(repository.full_name, `manca ${GROUP_DOCUMENT_PATH}`)
    }
    throw error
  }
}

function parseRepository(value: string): { owner: string; repo: string } {
  const parts = value.trim().split('/').map(part => part.trim()).filter(Boolean)
  if (parts.length !== 2) throw new StoredGroupRepositoryAccessError(value)
  return { owner: parts[0], repo: parts[1] }
}
