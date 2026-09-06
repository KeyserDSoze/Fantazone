import {
  GroupHelper,
  IdentityRole,
  type AnnualLeague,
  type Basket,
  type FantazoneManifest,
  type Group,
  type League,
  type UserOfAGroup,
} from '@fantazone/domain'
import { normalizeGroupName, type GitHubRepo } from './githubClient'
import {
  GROUP_RECALCULATION_WORKFLOW,
  GROUP_RECALCULATION_WORKFLOW_PATH,
  GROUP_REPOSITORY_RUNTIME_VERSION,
} from './groupWorkflow'
import { RepositoryRevisionContentClient } from './repositoryRevision'
import {
  GitHubJsonStore,
  type RepositoryContentClient,
  type RepositoryJsonReadOptions,
} from './repositoryStore'
import type { GroupRepositoryTarget } from './repositoryTarget'

export const FANTAZONE_SCHEMA_VERSION = 2
export const GROUP_DOCUMENT_PATH = 'config/group.json'
export const GROUP_REPOSITORY_METADATA_PATH = 'fantazone.json'

export type GroupRepositoryMetadata = {
  schemaVersion: number
  kind: 'fantazone-group'
  groupName: string
  groupRuntimeVersion: number
  createdAt: string
  updatedAt: string
}

type DecodedGroupRepositoryMetadata = Omit<GroupRepositoryMetadata, 'kind'> & { kind: string }

export type GroupRepositoryUpgradeResult = {
  runtimeVersion: number
  createdFiles: string[]
  updatedManagedFiles: string[]
}

export type InitializedGroup = {
  repository: GitHubRepo
  groupName: string
  runtimeVersion: number
}

export type InitialGroupAdmin = {
  email: string
  username?: string
}

export type CreateGroupOptions = {
  isPrivate?: boolean
  /** Required bootstrap identity for a newly created group. The first OAuth login must prove this email. */
  initialAdmin: InitialGroupAdmin
}

export type LegacyGroupBootstrap = {
  name: string
  repository?: string
  schemaVersion?: number
}

export interface GroupSetupClient extends RepositoryContentClient {
  discoverFantazoneRepositories(): Promise<GitHubRepo[]>
  createRepository(input: { name: string; isPrivate?: boolean; description?: string }): Promise<GitHubRepo>
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
    const group = await this.getGroup()
    return group?.baskets.find(basket => basket.id === basketId) ?? null
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

/**
 * Creates a Fantazone.<group> repository from scratch when it does not exist and
 * immediately bootstraps the current group runtime inside that repository.
 */
export async function createAndInitializeGroup(
  client: GroupSetupClient,
  groupName: string,
  options: CreateGroupOptions,
): Promise<InitializedGroup> {
  const normalized = normalizeGroupName(groupName)
  if (!normalized) throw new Error('Il nome del gruppo non è valido')
  const initialAdmin = createInitialAdmin(options.initialAdmin)

  const repositoryName = `Fantazone.${normalized}`
  const existing = (await client.discoverFantazoneRepositories()).find(
    repo => repo.name.toLowerCase() === repositoryName.toLowerCase(),
  )
  if (existing) {
    const upgrade = await ensureGroupInitialized(client, existing, groupName)
    await ensureInitialAdminIfGroupIsEmpty(client, existing, initialAdmin)
    return { repository: existing, groupName, runtimeVersion: upgrade.runtimeVersion }
  }

  const repository = await client.createRepository({
    name: repositoryName,
    isPrivate: options.isPrivate ?? true,
    description: `Fantazone group: ${groupName}`,
  })
  const upgrade = await ensureGroupInitialized(client, repository, groupName, { initialAdmin: options.initialAdmin })
  return { repository, groupName, runtimeVersion: upgrade.runtimeVersion }
}

/**
 * Idempotent bootstrap + runtime upgrade for a group repository.
 *
 * Canonical/user-owned data is create-only here. Fantazone-managed workflow files
 * are the only files this routine is allowed to replace, and they are updated using
 * their current GitHub SHA. The runtime metadata is advanced only after all managed
 * artifacts were installed successfully.
 */
export async function ensureGroupInitialized(
  client: RepositoryContentClient,
  repository: GitHubRepo,
  groupName: string,
  options: { initialAdmin?: InitialGroupAdmin } = {},
): Promise<GroupRepositoryUpgradeResult> {
  const owner = repository.owner.login
  const repo = repository.name
  const now = new Date().toISOString()
  const createdFiles: string[] = []
  const updatedManagedFiles: string[] = []

  const normalized = normalizeGroupName(groupName) || repository.name.replace(/^Fantazone\./i, '')
  const initialGroup: Group = {
    id: normalized,
    name: groupName,
    leagues: [],
    users: options.initialAdmin ? [createInitialAdmin(options.initialAdmin)] : [],
    baskets: [],
  }
  const manifest: FantazoneManifest = {
    schemaVersion: FANTAZONE_SCHEMA_VERSION,
    revision: 1,
    updatedAt: now,
  }

  // Canonical group data is never rewritten by a runtime/application upgrade.
  await ensureCreateOnlyFile(client, owner, repo, 'manifest.json', serializeJson(manifest), createdFiles)
  await ensureCreateOnlyFile(client, owner, repo, GROUP_DOCUMENT_PATH, serializeJson(initialGroup), createdFiles)

  // This path is explicitly Fantazone-managed. Existing custom workflows elsewhere
  // in .github/workflows are untouched.
  const workflow = await client.tryGetContent(owner, repo, GROUP_RECALCULATION_WORKFLOW_PATH)
  if (!workflow) {
    await writeManagedWorkflow(
      client,
      owner,
      repo,
      GROUP_RECALCULATION_WORKFLOW,
      undefined,
      `chore: install Fantazone group runtime v${GROUP_REPOSITORY_RUNTIME_VERSION}`,
    )
    createdFiles.push(GROUP_RECALCULATION_WORKFLOW_PATH)
  } else if (normalizeManagedText(workflow.content) !== normalizeManagedText(GROUP_RECALCULATION_WORKFLOW)) {
    await writeManagedWorkflow(
      client,
      owner,
      repo,
      GROUP_RECALCULATION_WORKFLOW,
      workflow.sha,
      `chore: upgrade Fantazone group runtime v${GROUP_REPOSITORY_RUNTIME_VERSION}`,
    )
    updatedManagedFiles.push(GROUP_RECALCULATION_WORKFLOW_PATH)
  }

  // Metadata is managed too, but it is written last: an upgrade is never marked as
  // complete if a required managed workflow could not be installed.
  const metadataSnapshot = await client.tryGetContent(owner, repo, GROUP_REPOSITORY_METADATA_PATH)
  const metadata = decodeGroupRepositoryMetadata(metadataSnapshot?.content, groupName, now)
  const metadataNeedsUpgrade =
    !metadataSnapshot ||
    metadata.schemaVersion !== FANTAZONE_SCHEMA_VERSION ||
    metadata.kind !== 'fantazone-group' ||
    metadata.groupName !== groupName ||
    metadata.groupRuntimeVersion !== GROUP_REPOSITORY_RUNTIME_VERSION

  if (metadataNeedsUpgrade) {
    const nextMetadata: GroupRepositoryMetadata = {
      schemaVersion: FANTAZONE_SCHEMA_VERSION,
      kind: 'fantazone-group',
      groupName,
      groupRuntimeVersion: GROUP_REPOSITORY_RUNTIME_VERSION,
      createdAt: metadata.createdAt,
      updatedAt: now,
    }
    await client.putContent(
      owner,
      repo,
      GROUP_REPOSITORY_METADATA_PATH,
      serializeJson(nextMetadata),
      metadataSnapshot
        ? `chore: record Fantazone group runtime v${GROUP_REPOSITORY_RUNTIME_VERSION}`
        : `chore: initialize ${GROUP_REPOSITORY_METADATA_PATH}`,
      metadataSnapshot?.sha,
    )
    if (metadataSnapshot) updatedManagedFiles.push(GROUP_REPOSITORY_METADATA_PATH)
    else createdFiles.push(GROUP_REPOSITORY_METADATA_PATH)
  }

  return {
    runtimeVersion: GROUP_REPOSITORY_RUNTIME_VERSION,
    createdFiles,
    updatedManagedFiles,
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

function createInitialAdmin(input: InitialGroupAdmin): UserOfAGroup {
  const email = normalizeEmail(input.email)
  if (!email || !email.includes('@')) throw new Error('Inserisci una email valida per l’amministratore iniziale.')
  return {
    username: input.username?.trim() || email.split('@')[0],
    email,
    role: IdentityRole.Participant | IdentityRole.Admin | IdentityRole.SuperAdmin,
  }
}

async function ensureCreateOnlyFile(
  client: RepositoryContentClient,
  owner: string,
  repo: string,
  path: string,
  content: string,
  createdFiles: string[],
): Promise<void> {
  if (await client.tryGetContent(owner, repo, path)) return
  await client.putContent(owner, repo, path, content, `chore: initialize ${path}`)
  createdFiles.push(path)
}

async function writeManagedWorkflow(
  client: RepositoryContentClient,
  owner: string,
  repo: string,
  content: string,
  sha: string | undefined,
  message: string,
): Promise<void> {
  try {
    await client.putContent(owner, repo, GROUP_RECALCULATION_WORKFLOW_PATH, content, message, sha)
  } catch (error) {
    throw new Error(
      `Impossibile installare/aggiornare ${GROUP_RECALCULATION_WORKFLOW_PATH}. ` +
      'Il token GitHub usato per il gruppo deve poter modificare i workflow del repository.',
      { cause: error },
    )
  }
}

function decodeGroupRepositoryMetadata(
  content: string | undefined,
  groupName: string,
  now: string,
): DecodedGroupRepositoryMetadata {
  if (!content) {
    return {
      schemaVersion: FANTAZONE_SCHEMA_VERSION,
      kind: 'fantazone-group',
      groupName,
      groupRuntimeVersion: 0,
      createdAt: now,
      updatedAt: now,
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error(`Il file ${GROUP_REPOSITORY_METADATA_PATH} non contiene JSON valido.`)
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Il file ${GROUP_REPOSITORY_METADATA_PATH} non contiene metadata Fantazone valide.`)
  }
  const value = parsed as Record<string, unknown>
  return {
    schemaVersion: typeof value.schemaVersion === 'number' ? value.schemaVersion : 0,
    kind: typeof value.kind === 'string' ? value.kind : '',
    groupName: typeof value.groupName === 'string' ? value.groupName : groupName,
    groupRuntimeVersion: typeof value.groupRuntimeVersion === 'number' ? value.groupRuntimeVersion : 0,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now,
  }
}

async function ensureInitialAdminIfGroupIsEmpty(
  client: GroupSetupClient,
  repository: GitHubRepo,
  initialAdmin: UserOfAGroup,
): Promise<void> {
  const current = await client.tryGetContent(
    repository.owner.login,
    repository.name,
    GROUP_DOCUMENT_PATH,
    repository.default_branch,
  ) ?? await client.tryGetContent(repository.owner.login, repository.name, GROUP_DOCUMENT_PATH)
  if (!current) return

  let value: unknown
  try {
    value = JSON.parse(current.content)
  } catch {
    return
  }
  if (!isGroupDocument(value) || value.users.length > 0) return

  const updated: Group = { ...value, users: [initialAdmin] }
  const revisionClient = new RepositoryRevisionContentClient(client, {
    owner: repository.owner.login,
    repo: repository.name,
    ref: repository.default_branch,
  })
  await revisionClient.putContent(
    repository.owner.login,
    repository.name,
    GROUP_DOCUMENT_PATH,
    serializeJson(updated),
    `chore: bootstrap initial admin ${initialAdmin.email}`,
    current.sha,
    repository.default_branch,
  )
}

function normalizeManagedText(value: string): string {
  return value.replace(/\r\n/g, '\n').trimEnd()
}

function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function normalizeEmail(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? ''
}
