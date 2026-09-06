import { GitHubApiError, GitHubClient, type GitHubRepo } from '@fantazone/github'
import type { GroupConnection } from './groupSessionRuntime'
import type { StoredGroup } from './userSettingsOneDrive'

export interface StoredGroupReconnectClient {
  validateToken(): Promise<{ login: string }>
  discoverFantazoneRepositories(): Promise<GitHubRepo[]>
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

/**
 * Connects a group whose exact repository is already authoritative (from either
 * OneDrive settings or a secret-free invitation). It never falls back to another
 * Fantazone.* repository and never creates a replacement group.
 */
export async function connectKnownGroup(
  token: string,
  group: KnownGroupReference,
  client: StoredGroupReconnectClient = new GitHubClient(token.trim()),
): Promise<GroupConnection> {
  const normalizedToken = token.trim()
  if (!normalizedToken) throw new Error('Inserisci il PAT GitHub per collegare questo gruppo.')

  await client.validateToken()
  const repositories = await client.discoverFantazoneRepositories()
  const repository = findStoredGroupRepository(repositories, group.repository)
  if (!repository) throw new StoredGroupRepositoryAccessError(group.repository)

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
    (error instanceof GitHubApiError && error.status === 401)
}

export function findStoredGroupRepository(
  repositories: readonly GitHubRepo[],
  expectedFullName: string,
): GitHubRepo | undefined {
  const expected = expectedFullName.trim().toLowerCase()
  if (!expected) return undefined
  return repositories.find(repository => repository.full_name.trim().toLowerCase() === expected)
}
