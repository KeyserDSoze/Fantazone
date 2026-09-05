import {
  GroupHelper,
  type AnnualLeague,
  type Basket,
  type FantazoneManifest,
  type Group,
  type League,
  type UserOfAGroup,
} from '@fantazone/domain'
import { GitHubClient, normalizeGroupName, type GitHubRepo } from './githubClient'
import { GitHubJsonStore, type RepositoryJsonReadOptions } from './repositoryStore'
import type { GroupRepositoryTarget } from './repositoryTarget'

export const FANTAZONE_SCHEMA_VERSION = 2
export const GROUP_DOCUMENT_PATH = 'config/group.json'

export type InitializedGroup = {
  repository: GitHubRepo
  groupName: string
}

export type LegacyGroupBootstrap = {
  name: string
  repository?: string
  schemaVersion?: number
}

export interface GroupSetupClient {
  discoverFantazoneRepositories(): Promise<GitHubRepo[]>
  createRepository(input: { name: string; isPrivate?: boolean; description?: string }): Promise<GitHubRepo>
  tryGetContent(owner: string, repo: string, path: string, ref?: string): Promise<{ sha: string; content: string } | null>
  putContent(
    owner: string,
    repo: string,
    path: string,
    text: string,
    message: string,
    sha?: string,
    branch?: string,
  ): Promise<{ sha: string }>
}

/** GitHub-backed Group repository. Schema v2 stores the readable Group model directly. */
export class GitHubGroupRepository {
  constructor(
    private readonly store: GitHubJsonStore,
    private readonly repository: GroupRepositoryTarget,
  ) {}

  async getGroup(options: RepositoryJsonReadOptions = {}): Promise<Group | null> {
    const snapshot = await this.store.tryReadJson<unknown>(this.location(), options)
    if (!snapshot) return null
    return decodeStoredGroup(snapshot.value, this.repository)
  }

  async writeGroup(group: Group, message = 'chore: update group'): Promise<string> {
    const snapshot = await this.store.writeJson(this.location(), group, message)
    return snapshot.sha
  }

  async getLeagues(): Promise<League[]> {
    return (await this.getGroup())?.leagues ?? []
  }

  async getLeague(leagueId: string): Promise<League | null> {
    return (await this.getGroup())?.leagues.find(league => league.id === leagueId) ?? null
  }

  async getAnnualLeague(leagueId: string, year: number): Promise<AnnualLeague | null> {
    const group = await this.getGroup()
    return group ? GroupHelper.getAnnualLeague(group, leagueId, year) : null
  }

  async getAnnualLeagues(year: number): Promise<AnnualLeague[]> {
    const group = await this.getGroup()
    return group ? GroupHelper.getAnnualLeagues(group, year) : []
  }

  async getBaskets(): Promise<Basket[]> {
    return (await this.getGroup())?.baskets ?? []
  }

  async getBasket(basketId: string): Promise<Basket | null> {
    return (await this.getGroup())?.baskets.find(basket => basket.id === basketId) ?? null
  }

  async findUserByEmail(email: string, options: RepositoryJsonReadOptions = {}): Promise<UserOfAGroup | null> {
    const group = await this.getGroup(options)
    return group ? GroupHelper.findUserByEmail(group, email) : null
  }

  async hasUser(email: string): Promise<boolean> {
    return (await this.findUserByEmail(email)) !== null
  }

  async getAvailableYears(): Promise<number[]> {
    const group = await this.getGroup()
    return group ? GroupHelper.getAvailableYears(group) : []
  }

  private location() {
    return { ...this.repository, path: GROUP_DOCUMENT_PATH }
  }
}

export async function createAndInitializeGroup(
  client: GroupSetupClient,
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
    isPrivate: options.isPrivate ?? true,
    description: `Fantazone group: ${groupName}`,
  })
  await ensureGroupInitialized(client, repository, groupName)
  return { repository, groupName }
}

export async function ensureGroupInitialized(
  client: GroupSetupClient | GitHubClient,
  repository: GitHubRepo,
  groupName: string,
): Promise<void> {
  const manifest: FantazoneManifest = {
    schemaVersion: FANTAZONE_SCHEMA_VERSION,
    revision: 1,
    updatedAt: new Date().toISOString(),
  }

  const normalized = normalizeGroupName(groupName) || repository.name.replace(/^Fantazone\./i, '')
  const initialGroup: Group = {
    id: normalized,
    name: groupName,
    leagues: [],
    users: [],
    baskets: [],
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
    { path: GROUP_DOCUMENT_PATH, value: initialGroup },
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

export function isGroupDocument(value: unknown): value is Group {
  if (!value || typeof value !== 'object') return false
  const group = value as Partial<Group>
  return typeof group.id === 'string' && typeof group.name === 'string' &&
    Array.isArray(group.leagues) && Array.isArray(group.users) && Array.isArray(group.baskets)
}

export function isLegacyGroupBootstrap(value: unknown): value is LegacyGroupBootstrap {
  if (!value || typeof value !== 'object') return false
  const bootstrap = value as Partial<LegacyGroupBootstrap>
  return typeof bootstrap.name === 'string' && !('id' in bootstrap)
}

export function decodeStoredGroup(value: unknown, repository: GroupRepositoryTarget): Group {
  if (isGroupDocument(value)) return value
  if (isLegacyGroupBootstrap(value)) {
    return {
      id: repository.repo.replace(/^Fantazone\./i, '') || normalizeGroupName(value.name),
      name: value.name,
      leagues: [],
      users: [],
      baskets: [],
    }
  }
  throw new Error(`Unsupported group JSON schema in ${repository.owner}/${repository.repo}/${GROUP_DOCUMENT_PATH}. Fantazone schema v2 requires readable property names.`)
}
