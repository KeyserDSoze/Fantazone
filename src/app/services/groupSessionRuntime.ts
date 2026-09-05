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
  GitHubCalendarRepository,
  GitHubClient,
  GitHubGroupRepository,
  GitHubJsonStore,
  GitHubLiveGroupRepository,
  GitHubRankRepository,
  GitHubRealCalendarRepository,
  GitHubTeamRepository,
  type GitHubRepo,
  type GroupRepositoryTarget,
  type PlatformRepositoryTarget,
  type RepositoryContentClient,
} from '@fantazone/github'
import { GroupFormationWriter } from './groupFormationWriter'
import { GroupGameComposer } from './groupGameComposer'

export type GroupConnection = {
  token: string
  repository: GitHubRepo
  groupName: string
  expectedEmail?: string
}

export type GroupRuntimeOptions = {
  platformTarget?: PlatformRepositoryTarget
  now?: () => Date
}

export const DEFAULT_PLATFORM_TARGET: PlatformRepositoryTarget = {
  owner: 'KeyserDSoze',
  repo: 'Fantazone',
  ref: 'main',
}

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
  readonly calendarRepository: GitHubCalendarRepository
  readonly rankRepository: GitHubRankRepository
  readonly teamRepository: GitHubTeamRepository
  readonly liveGroupRepository: GitHubLiveGroupRepository
  readonly realCalendarRepository: GitHubRealCalendarRepository
  readonly gameComposer: GroupGameComposer
  readonly formationWriter: GroupFormationWriter

  private currentGroup: Group | null = null

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
    this.store = new GitHubJsonStore(contentClient)
    this.groupRepository = new GitHubGroupRepository(this.store, this.target)
    this.calendarRepository = new GitHubCalendarRepository(this.store, this.target)
    this.rankRepository = new GitHubRankRepository(this.store, this.target)
    this.teamRepository = new GitHubTeamRepository(this.store, this.target, this.rankRepository)
    this.liveGroupRepository = new GitHubLiveGroupRepository(this.store, this.target)
    this.realCalendarRepository = new GitHubRealCalendarRepository(this.store, this.platformTarget)
    this.gameComposer = new GroupGameComposer(
      () => this.group,
      this.calendarRepository,
      this.teamRepository,
      this.realCalendarRepository,
      options.now,
    )
    this.formationWriter = new GroupFormationWriter(
      () => this.refreshGroup(),
      this.gameComposer,
      this.teamRepository,
      this.realCalendarRepository,
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
    const group = await this.groupRepository.getGroup({ refresh: true })
    if (!group) throw new GroupDocumentUnavailableError(this.connection)
    this.currentGroup = group
    return group
  }

  async resolveIdentity(identity: ExternalIdentity, options: { refreshMembership?: boolean; expectedEmail?: string } = {}): Promise<GroupLoginResolution> {
    const group = options.refreshMembership === false ? this.group : await this.refreshGroup()
    const expectedEmail = options.expectedEmail ?? this.connection.expectedEmail
    return resolveGroupLogin(group, identity, expectedEmail)
  }

  async inviteMember(actor: UserOfAGroup, input: { email: string; username?: string }): Promise<UserOfAGroup> {
    const group = await this.refreshGroup()
    const currentActor = GroupHelper.findUserByEmail(group, actor.email)
    const canManageUsers = Boolean(currentActor) && (
      GroupHelper.hasRole(currentActor!, IdentityRole.Admin) ||
      GroupHelper.hasRole(currentActor!, IdentityRole.SuperAdmin)
    )
    if (!canManageUsers) throw new Error('Solo Admin o SuperAdmin possono invitare utenti nel gruppo.')

    const email = normalizeEmail(input.email)
    if (!email || !email.includes('@')) throw new Error('Inserisci una email valida per l’invito.')
    const existingIndex = group.users.findIndex(user => normalizeEmail(user.email) === email)
    const existing = existingIndex >= 0 ? group.users[existingIndex] : null
    const username = input.username?.trim() || existing?.username || email.split('@')[0]
    const invited: UserOfAGroup = existing
      ? { ...existing, username, email: existing.email, role: existing.role === IdentityRole.None ? IdentityRole.Participant : existing.role }
      : { username, email, role: IdentityRole.Participant }

    const users = [...group.users]
    if (existingIndex >= 0) users[existingIndex] = invited
    else users.push(invited)
    const updated: Group = { ...group, users }
    await this.groupRepository.writeGroup(updated, `chore: invite ${email}`)
    this.currentGroup = updated
    return invited
  }
}

function normalizeEmail(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? ''
}
