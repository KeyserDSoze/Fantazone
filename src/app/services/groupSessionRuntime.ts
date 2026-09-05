import {
  resolveGroupLogin,
  type ExternalIdentity,
  type Group,
  type GroupLoginResolution,
} from '@fantazone/domain'
import {
  GitHubCalendarRepository,
  GitHubClient,
  GitHubGroupRepository,
  GitHubJsonStore,
  GitHubRankRepository,
  GitHubTeamRepository,
  type GitHubRepo,
  type GroupRepositoryTarget,
  type RepositoryContentClient,
} from '@fantazone/github'

export type GroupConnection = {
  token: string
  repository: GitHubRepo
  groupName: string
}

export class GroupDocumentUnavailableError extends Error {
  constructor(public readonly connection: GroupConnection) {
    super(`Il file config/group.json non è disponibile in ${connection.repository.full_name}`)
    this.name = 'GroupDocumentUnavailableError'
  }
}

export class GroupSessionRuntime {
  readonly target: GroupRepositoryTarget
  readonly store: GitHubJsonStore
  readonly groupRepository: GitHubGroupRepository
  readonly calendarRepository: GitHubCalendarRepository
  readonly rankRepository: GitHubRankRepository
  readonly teamRepository: GitHubTeamRepository

  private currentGroup: Group | null = null

  private constructor(
    readonly connection: GroupConnection,
    contentClient: RepositoryContentClient,
  ) {
    this.target = {
      owner: connection.repository.owner.login,
      repo: connection.repository.name,
      ref: connection.repository.default_branch,
    }
    this.store = new GitHubJsonStore(contentClient)
    this.groupRepository = new GitHubGroupRepository(this.store, this.target)
    this.calendarRepository = new GitHubCalendarRepository(this.store, this.target)
    this.rankRepository = new GitHubRankRepository(this.store, this.target)
    this.teamRepository = new GitHubTeamRepository(this.store, this.target, this.rankRepository)
  }

  static async open(
    connection: GroupConnection,
    contentClient: RepositoryContentClient = new GitHubClient(connection.token),
  ): Promise<GroupSessionRuntime> {
    const runtime = new GroupSessionRuntime(connection, contentClient)
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

  async resolveIdentity(
    identity: ExternalIdentity,
    options: { refreshMembership?: boolean } = {},
  ): Promise<GroupLoginResolution> {
    const group = options.refreshMembership === false ? this.group : await this.refreshGroup()
    return resolveGroupLogin(group, identity)
  }
}
