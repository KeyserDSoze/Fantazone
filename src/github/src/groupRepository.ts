import type { FantazoneManifest } from '@fantazone/domain'
import { GitHubClient, normalizeGroupName, type GitHubRepo } from './githubClient'

export const FANTAZONE_SCHEMA_VERSION = 1

export type InitializedGroup = {
  repository: GitHubRepo
  groupName: string
}

export async function createAndInitializeGroup(
  client: GitHubClient,
  groupName: string,
  options: { isPrivate?: boolean } = {},
): Promise<InitializedGroup> {
  const normalized = normalizeGroupName(groupName)
  if (!normalized) throw new Error('Il nome del gruppo non è valido')

  const repositoryName = `Fantazone.${normalized}`
  const existing = (await client.discoverFantazoneRepositories()).find(
    repo => repo.name.toLowerCase() === repositoryName.toLowerCase(),
  )
  if (existing) {
    await ensureGroupInitialized(client, existing, groupName)
    return { repository: existing, groupName }
  }

  const repository = await client.createRepository({
    name: repositoryName,
    isPrivate: options.isPrivate ?? false,
    description: `Fantazone group: ${groupName}`,
  })
  await ensureGroupInitialized(client, repository, groupName)
  return { repository, groupName }
}

export async function ensureGroupInitialized(
  client: GitHubClient,
  repository: GitHubRepo,
  groupName: string,
): Promise<void> {
  const manifest: FantazoneManifest = {
    schemaVersion: FANTAZONE_SCHEMA_VERSION,
    revision: 1,
    updatedAt: new Date().toISOString(),
  }

  const files: Array<{ path: string; value: unknown }> = [
    {
      path: 'fantazone.json',
      value: {
        schemaVersion: FANTAZONE_SCHEMA_VERSION,
        kind: 'fantazone-group',
        groupName,
        createdAt: new Date().toISOString(),
      },
    },
    { path: 'manifest.json', value: manifest },
    {
      path: 'config/group.json',
      value: {
        name: groupName,
        repository: repository.full_name,
        schemaVersion: FANTAZONE_SCHEMA_VERSION,
      },
    },
    { path: 'members/members.json', value: [] },
  ]

  for (const file of files) {
    const current = await client.tryGetContent(repository.owner.login, repository.name, file.path)
    if (current) continue
    await client.putContent(
      repository.owner.login,
      repository.name,
      file.path,
      `${JSON.stringify(file.value, null, 2)}\n`,
      `chore: initialize ${file.path}`,
    )
  }
}
