import {
  GroupHelper,
  IdentityRole,
  resolveGroupLogin,
  type ExternalIdentity,
  type Group,
  type GroupLoginResolution,
  type UserOfAGroup,
} from '@fantazone/domain'
import {
  applyGroupRepositorySettings,
  createGroupRepositorySettings,
  decodeRepositoryRevisionManifest,
  GitHubAuctionRepository,
  GitHubAuctionSignalingRepository,
  GitHubCalendarRepository,
  GitHubClient,
  GitHubGroupRepository,
  GitHubGroupSettingsRepository,
  GitHubHallOfFameRepository,
  GitHubJsonStore,
  GitHubLiveGroupRepository,
  GitHubMarketRepository,
  GitHubOpeningCompetitionRepository,
  GitHubRankRepository,
  GitHubRealCalendarRepository,
  GitHubRealPlayersRepository,
  GitHubSerieAVoteRepository,
  GitHubTeamRepository,
  REPOSITORY_MANIFEST_PATH,
  RepositoryRevisionContentClient,
  RepositoryWriteConflictError,
  type GitHubRepo,
  type GroupRepositorySettings,
  type GroupRepositoryTarget,
  type PlatformRepositoryTarget,
  type RepositoryContentClient,
  type RepositoryJsonPersistentCache,
} from '@fantazone/github'
import { GroupAuctionDiscoveryService } from './groupAuctionDiscovery'
import { GroupFormationWriter } from './groupFormationWriter'
import { GroupGameComposer } from './groupGameComposer'
import { GroupLiveComposer } from './groupLiveComposer'
import { GroupMarketService } from './groupMarketService'

export type GroupConnection = {
  token: string
  repository: GitHubRepo
  groupName: string
  expectedEmail?: string
}

export type GroupRuntimeOptions = {
  platformTarget?: PlatformRepositoryTarget
  now?: () => Date
  persistentCache?: RepositoryJsonPersistentCache
}

export type GroupRepositorySyncResult = {
  changed: boolean
  previousRevision: number | null
  revision: number
  offline: boolean
}

export type GroupDisplaySettingsUpdate = {
  groupName: string
  leagueNames: Record<string, string>
}

export const DEFAULT_PLATFORM_TARGET: PlatformRepositoryTarget = {
  owner: 'KeyserDSoze',
  repo: 'Fantazone',
  ref: 'main',
}

const GROUP_MUTATION_ATTEMPTS = 4

export class GroupDocumentUnavailableError extends Error {
  constructor(public readonly connection: GroupConnection) {
    super(`Il file config/group.json non è disponibile in ${connection.repository.full_name}`)
    this.name = 'GroupDocumentUnavailableError'
  }
}

export class GroupSessionRuntime {
  readonly target: GroupRepositoryTarget
  readonly platformTarget: PlatformRepositoryTarget
  readonly store: GitHubJsonStore
  readonly groupRepository: GitHubGroupRepository
  readonly groupSettingsRepository: GitHubGroupSettingsRepository
  readonly calendarRepository: GitHubCalendarRepository
  readonly rankRepository: GitHubRankRepository
  readonly realPlayersRepository: GitHubRealPlayersRepository
  readonly teamRepository: GitHubTeamRepository
  readonly marketRepository: GitHubMarketRepository
  readonly hallOfFameRepository: GitHubHallOfFameRepository
  readonly auctionRepository: GitHubAuctionRepository
  readonly auctionSignalingRepository: GitHubAuctionSignalingRepository
  readonly auctionDiscovery: GroupAuctionDiscoveryService
  readonly openingCompetitionRepository: GitHubOpeningCompetitionRepository
  /** Legacy persisted cache adapter kept temporarily for migration compatibility. Prefer liveComposer. */
  readonly liveGroupRepository: GitHubLiveGroupRepository
  readonly realCalendarRepository: GitHubRealCalendarRepository
  readonly liveVoteRepository: GitHubSerieAVoteRepository
  readonly officialVoteRepository: GitHubSerieAVoteRepository
  readonly gameComposer: GroupGameComposer
  readonly liveComposer: GroupLiveComposer
  readonly formationWriter: GroupFormationWriter
  readonly marketService: GroupMarketService

  private currentGroup: Group | null = null
  private observedRevision: number | null = null
  private readonly revisionClient: RepositoryRevisionContentClient

  private constructor(
    readonly connection: GroupConnection,
    contentClient: RepositoryContentClient,
    options: GroupRuntimeOptions = {},
  ) {
    this.target = {
      owner: connection.repository.owner.login,
      repo: connection.repository.name,
      ref: connection.repository.default_branch,
    }
    this.platformTarget = options.platformTarget ?? DEFAULT_PLATFORM_TARGET
    this.revisionClient = new RepositoryRevisionContentClient(contentClient, this.target, options.now)
    this.store = new GitHubJsonStore(this.revisionClient, options.persistentCache)
    this.groupRepository = new GitHubGroupRepository(this.store, this.target)
    this.groupSettingsRepository = new GitHubGroupSettingsRepository(this.store, this.target)
    this.calendarRepository = new GitHubCalendarRepository(this.store, this.target)
    this.rankRepository = new GitHubRankRepository(this.store, this.target)
    this.realPlayersRepository = new GitHubRealPlayersRepository(this.store, this.platformTarget)
    this.teamRepository = new GitHubTeamRepository(this.store, this.target, this.rankRepository, this.realPlayersRepository)
    this.marketRepository = new GitHubMarketRepository(this.store, this.target)
    this.hallOfFameRepository = new GitHubHallOfFameRepository(this.store, this.target)
    this.auctionRepository = new GitHubAuctionRepository(this.store, this.target)
    this.auctionSignalingRepository = new GitHubAuctionSignalingRepository(this.store, this.target, options.now)
    this.auctionDiscovery = new GroupAuctionDiscoveryService(this.auctionRepository, options.now)
    this.openingCompetitionRepository = new GitHubOpeningCompetitionRepository(this.store, this.target)
    this.liveGroupRepository = new GitHubLiveGroupRepository(this.store, this.target)
    this.realCalendarRepository = new GitHubRealCalendarRepository(this.store, this.platformTarget)
    this.liveVoteRepository = new GitHubSerieAVoteRepository(this.store, this.platformTarget, 'live')
    this.officialVoteRepository = new GitHubSerieAVoteRepository(this.store, this.platformTarget, 'official')
    this.gameComposer = new GroupGameComposer(
      () => this.group,
      this.calendarRepository,
      this.teamRepository,
      this.realCalendarRepository,
      options.now,
    )
    this.liveComposer = new GroupLiveComposer(
      () => this.group,
      this.calendarRepository,
      this.rankRepository,
      this.teamRepository,
      this.realCalendarRepository,
      this.liveVoteRepository,
      this.officialVoteRepository,
      options.now,
    )
    this.formationWriter = new GroupFormationWriter(
      () => this.refreshGroup(),
      this.gameComposer,
      this.teamRepository,
      this.realCalendarRepository,
      options.now,
    )
    this.marketService = new GroupMarketService(
      () => this.group,
      this.marketRepository,
      this.teamRepository,
      options.now,
    )
  }

  static async open(
    connection: GroupConnection,
    contentClient: RepositoryContentClient = new GitHubClient(connection.token),
    options: GroupRuntimeOptions = {},
  ): Promise<GroupSessionRuntime> {
    const runtime = new GroupSessionRuntime(connection, contentClient, options)
    await runtime.refreshGroup()
    return runtime
  }

  get group(): Group {
    if (!this.currentGroup) throw new GroupDocumentUnavailableError(this.connection)
    return this.currentGroup
  }

  async refreshGroup(): Promise<Group> {
    const canonical = await this.groupRepository.getGroup({ refresh: true })
    if (!canonical) throw new GroupDocumentUnavailableError(this.connection)
    const settings = await this.groupSettingsRepository.getSettings({ refresh: true }) ?? createGroupRepositorySettings(canonical)
    const group = applyGroupRepositorySettings(canonical, settings)
    this.currentGroup = group
    this.connection.groupName = group.name
    return group
  }

  async updateDisplaySettings(actor: UserOfAGroup, input: GroupDisplaySettingsUpdate): Promise<GroupRepositorySettings> {
    const group = await this.refreshGroup()
    const currentActor = GroupHelper.findUserByEmail(group, actor.email)
    const canManageSettings = Boolean(currentActor) && (
      GroupHelper.hasRole(currentActor!, IdentityRole.Admin) ||
      GroupHelper.hasRole(currentActor!, IdentityRole.SuperAdmin)
    )
    if (!canManageSettings) throw new Error('Solo Admin o SuperAdmin possono modificare i nomi del gruppo e delle leghe.')

    const groupName = input.groupName.trim()
    if (!groupName) throw new Error('Il nome visualizzato del gruppo non può essere vuoto.')
    const current = await this.groupSettingsRepository.getSettings({ refresh: true }) ?? createGroupRepositorySettings(group)
    const leagues = { ...current.leagues }
    for (const league of group.leagues) {
      const requested = input.leagueNames[league.id]
      const name = requested == null ? (leagues[league.id]?.name || league.name || league.id) : requested.trim()
      if (!name) throw new Error(`Il nome visualizzato della lega ${league.id} non può essere vuoto.`)
      leagues[league.id] = { name }
    }

    const normalizedLeagueNames = Object.values(leagues).map(item => item.name.trim().toLowerCase())
    if (new Set(normalizedLeagueNames).size !== normalizedLeagueNames.length) {
      throw new Error('Due leghe non possono avere lo stesso nome visualizzato.')
    }

    const next: GroupRepositorySettings = {
      ...current,
      group: { ...current.group, name: groupName },
      leagues,
    }
    await this.groupSettingsRepository.writeSettings(next, 'chore: update group display names')
    await this.refreshGroup()
    return next
  }

  async syncRepositoryRevision(): Promise<GroupRepositorySyncResult> {
    const manifestLocation = { ...this.target, path: REPOSITORY_MANIFEST_PATH }
    const cachedManifest = await this.store.readCachedJson<unknown>(manifestLocation)
    const cachedRevision = cachedManifest ? decodeRepositoryRevisionManifest(cachedManifest.value).revision : null
    const previousRevision = this.revisionClient.lastRevision ?? this.observedRevision ?? cachedRevision

    let freshSnapshot = await this.store.readJson<unknown>(manifestLocation, { refresh: true })
    let freshManifest = decodeRepositoryRevisionManifest(freshSnapshot.value)
    if (freshSnapshot.fromCache) {
      return { changed: false, previousRevision, revision: freshManifest.revision, offline: true }
    }

    if (freshManifest.updating === true) {
      try {
        const repairedRevision = await this.revisionClient.repairStaleRevision(this.target.ref)
        if (repairedRevision !== null) {
          // The revision client writes the manifest below the JSON store boundary, so
          // explicitly refresh once more to replace the cached in-flight snapshot.
          freshSnapshot = await this.store.readJson<unknown>(manifestLocation, { refresh: true })
          freshManifest = decodeRepositoryRevisionManifest(freshSnapshot.value)
        }
      } catch {
        // A read-only token, concurrent writer or transport failure must never make
        // synchronization less safe. Keep treating the marker as in-flight and retry
        // on the next regular poll.
      }
    }

    const revision = freshManifest.revision
    this.observedRevision = revision
    if (freshManifest.updating !== true && (previousRevision == null || previousRevision === revision)) {
      return { changed: false, previousRevision, revision, offline: false }
    }

    this.store.invalidateRepositoryMemory(this.target.owner, this.target.repo, [manifestLocation])
    await this.refreshGroup()
    return { changed: true, previousRevision, revision, offline: false }
  }

  async resolveIdentity(identity: ExternalIdentity, options: { refreshMembership?: boolean; expectedEmail?: string } = {}): Promise<GroupLoginResolution> {
    const group = options.refreshMembership === false ? this.group : await this.refreshGroup()
    const expectedEmail = options.expectedEmail ?? this.connection.expectedEmail
    return resolveGroupLogin(group, identity, expectedEmail)
  }

  async inviteMember(actor: UserOfAGroup, input: { email: string; username?: string }): Promise<UserOfAGroup> {
    const email = normalizeEmail(input.email)
    if (!email || !email.includes('@')) throw new Error('Inserisci una email valida per l’invito.')

    for (let attempt = 0; attempt < GROUP_MUTATION_ATTEMPTS; attempt += 1) {
      const canonical = await this.groupRepository.getGroup({ refresh: true })
      if (!canonical) throw new GroupDocumentUnavailableError(this.connection)
      const currentActor = GroupHelper.findUserByEmail(canonical, actor.email)
      const canManageUsers = Boolean(currentActor) && (
        GroupHelper.hasRole(currentActor!, IdentityRole.Admin) ||
        GroupHelper.hasRole(currentActor!, IdentityRole.SuperAdmin)
      )
      if (!canManageUsers) throw new Error('Solo Admin o SuperAdmin possono invitare utenti nel gruppo.')

      const existingIndex = canonical.users.findIndex(user => normalizeEmail(user.email) === email)
      const existing = existingIndex >= 0 ? canonical.users[existingIndex] : null
      const username = input.username?.trim() || existing?.username || email.split('@')[0]
      const invited: UserOfAGroup = existing
        ? { ...existing, username, email: existing.email, role: existing.role === IdentityRole.None ? IdentityRole.Participant : existing.role }
        : { username, email, role: IdentityRole.Participant }

      if (existing && invited.username === existing.username && invited.role === existing.role) {
        await this.refreshGroup()
        return GroupHelper.findUserByEmail(this.group, email) ?? invited
      }

      const users = [...canonical.users]
      if (existingIndex >= 0) users[existingIndex] = invited
      else users.push(invited)
      try {
        await this.groupRepository.writeGroup({ ...canonical, users }, `chore: invite ${email}`)
        await this.refreshGroup()
        return GroupHelper.findUserByEmail(this.group, email) ?? invited
      } catch (error) {
        if (!(error instanceof RepositoryWriteConflictError) || attempt === GROUP_MUTATION_ATTEMPTS - 1) throw error
        await sleep(120 * (attempt + 1))
      }
    }
    throw new Error('Impossibile aggiornare i partecipanti del gruppo.')
  }

  async ensureSharedInviteParticipant(identity: ExternalIdentity): Promise<UserOfAGroup> {
    const email = normalizeEmail(identity.email)
    if (!email || !email.includes('@')) throw new Error('L’account Microsoft non espone una email valida.')

    for (let attempt = 0; attempt < GROUP_MUTATION_ATTEMPTS; attempt += 1) {
      const canonical = await this.groupRepository.getGroup({ refresh: true })
      if (!canonical) throw new GroupDocumentUnavailableError(this.connection)
      const existing = GroupHelper.findUserByEmail(canonical, email)
      if (existing) {
        if (existing.role === IdentityRole.None) {
          throw new Error('Questo account è stato disabilitato nel gruppo e non può rientrare tramite l’invito generale.')
        }
        await this.refreshGroup()
        return GroupHelper.findUserByEmail(this.group, email) ?? existing
      }

      const participant: UserOfAGroup = {
        username: identity.displayName?.trim() || email.split('@')[0],
        email,
        role: IdentityRole.Participant,
      }
      try {
        await this.groupRepository.writeGroup(
          { ...canonical, users: [...canonical.users, participant] },
          `chore: join shared invite ${email}`,
        )
        await this.refreshGroup()
        return GroupHelper.findUserByEmail(this.group, email) ?? participant
      } catch (error) {
        if (!(error instanceof RepositoryWriteConflictError) || attempt === GROUP_MUTATION_ATTEMPTS - 1) throw error
        await sleep(120 * (attempt + 1))
      }
    }
    throw new Error('Impossibile censire il partecipante nel gruppo.')
  }
}

function normalizeEmail(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? ''
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
