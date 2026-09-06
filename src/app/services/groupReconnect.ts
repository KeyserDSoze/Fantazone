import { GitHubClient, type GitHubRepo } from '@fantazone/github'
import type { GroupConnection } from './groupSessionRuntime'
import type { StoredGroup } from './userSettingsOneDrive'

export interface StoredGroupReconnectClient {
  validateToken(): Promise<{ login: string }>
  discoverFantazoneRepositories(): Promise<GitHubRepo[]>
}

/**
 * Reconnects a group already known by the Microsoft/OneDrive catalog.
 *
 * The stored repository full name is authoritative: reconnecting must never fall
 * back to another Fantazone.* repository or create a replacement group.
 */
export async function reconnectStoredGroup(
  token: string,
  group: StoredGroup,
  client: StoredGroupReconnectClient = new GitHubClient(token.trim()),
): Promise<GroupConnection> {
  const normalizedToken = token.trim()
  if (!normalizedToken) throw new Error('Inserisci il PAT GitHub per ricollegare questo gruppo.')

  await client.validateToken()
  const repositories = await client.discoverFantazoneRepositories()
  const repository = findStoredGroupRepository(repositories, group.repository)
  if (!repository) {
    throw new Error(`Il PAT non può aprire il repository ${group.repository}.`)
  }

  return {
    token: normalizedToken,
    repository,
    groupName: group.name,
  }
}

export function findStoredGroupRepository(
  repositories: readonly GitHubRepo[],
  expectedFullName: string,
): GitHubRepo | undefined {
  const expected = expectedFullName.trim().toLowerCase()
  if (!expected) return undefined
  return repositories.find(repository => repository.full_name.trim().toLowerCase() === expected)
}
