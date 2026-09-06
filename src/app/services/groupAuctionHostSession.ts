import {
  createAuctionAssignmentOutcome,
  processAuctionCommand,
  type AuctionAssignmentOutcome,
  type AuctionCheckpoint,
  type AuctionCommand,
  type AuctionCommandResult,
  type AuctionTeams,
  type Group,
  type StatPlayer,
} from '@fantazone/domain'
import {
  GitHubAuctionRepository,
  type RepositoryJsonSnapshot,
} from '@fantazone/github'

export type GroupAuctionHostSessionContext = {
  group: Group
  leagueId: string
  season: number
  players: readonly StatPlayer[]
  teams: AuctionTeams
  now?: () => Date
}

export type GroupAuctionDispatchResult = AuctionCommandResult & {
  /** Present only after an accepted ASSIGN_CURRENT; submit it once to the group repository. */
  assignmentOutcome: AuctionAssignmentOutcome | null
}

/**
 * Transport-agnostic authoritative auction host state.
 * WebRTC hands commands to this object; business rules remain in the pure reducer.
 * Persisting is explicit so a bid does not become a Git commit by accident.
 */
export class GroupAuctionHostSession {
  private state: AuctionCheckpoint
  private teams: AuctionTeams
  private checkpointSha: string
  private readonly now: () => Date

  private constructor(
    private readonly repository: GitHubAuctionRepository,
    snapshot: RepositoryJsonSnapshot<AuctionCheckpoint>,
    private readonly context: Omit<GroupAuctionHostSessionContext, 'teams' | 'now'>,
    teams: AuctionTeams,
    now: () => Date,
  ) {
    this.state = cloneJson(snapshot.value)
    this.teams = teams
    this.checkpointSha = snapshot.sha
    this.now = now
  }

  static async create(
    repository: GitHubAuctionRepository,
    checkpoint: AuctionCheckpoint,
    context: GroupAuctionHostSessionContext,
  ): Promise<GroupAuctionHostSession> {
    const snapshot = await repository.createCheckpoint(checkpoint)
    return new GroupAuctionHostSession(
      repository,
      snapshot,
      stripMutableContext(context),
      context.teams,
      context.now ?? (() => new Date()),
    )
  }

  static resume(
    repository: GitHubAuctionRepository,
    snapshot: RepositoryJsonSnapshot<AuctionCheckpoint>,
    context: GroupAuctionHostSessionContext,
  ): GroupAuctionHostSession {
    return new GroupAuctionHostSession(
      repository,
      snapshot,
      stripMutableContext(context),
      context.teams,
      context.now ?? (() => new Date()),
    )
  }

  get checkpoint(): AuctionCheckpoint {
    return cloneJson(this.state)
  }

  get currentTeams(): AuctionTeams {
    return cloneTeams(this.teams)
  }

  dispatch(command: AuctionCommand, at: Date = this.now()): GroupAuctionDispatchResult {
    const checkpointBefore = cloneJson(this.state)
    const result = processAuctionCommand(this.state, command, {
      ...this.context,
      teams: this.teams,
      now: at,
    })
    const assignmentOutcome = command.type === 'ASSIGN_CURRENT' && result.status === 'accepted'
      ? createAuctionAssignmentOutcome({ checkpointBefore, command, result })
      : null

    this.state = result.checkpoint
    this.teams = result.teams
    return {
      ...result,
      checkpoint: cloneJson(result.checkpoint),
      teams: cloneTeams(result.teams),
      assignmentOutcome,
    }
  }

  /**
   * Persist the latest host checkpoint with Git blob optimistic concurrency.
   * Call this at durable boundaries and periodically; do not call it for every bid.
   */
  async persistCheckpoint(): Promise<RepositoryJsonSnapshot<AuctionCheckpoint>> {
    const written = await this.repository.writeCheckpoint(this.state, { expectedSha: this.checkpointSha })
    this.checkpointSha = written.sha
    return written
  }
}

/** Events worth checkpointing immediately. BID_ACCEPTED stays realtime-only. */
export function isAuctionDurableBoundary(result: AuctionCommandResult): boolean {
  return result.status === 'accepted' && Boolean(result.event) && result.event!.type !== 'BID_ACCEPTED'
}

function stripMutableContext(context: GroupAuctionHostSessionContext): Omit<GroupAuctionHostSessionContext, 'teams' | 'now'> {
  return {
    group: context.group,
    leagueId: context.leagueId,
    season: context.season,
    players: context.players,
  }
}

function cloneTeams(teams: AuctionTeams): AuctionTeams {
  return new Map([...teams].map(([owner, entry]) => [owner, {
    basketId: entry.basketId,
    team: cloneJson(entry.team),
  }]))
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
