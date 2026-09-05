import {
  LiveGroupHelper,
  LiveLeagueHelper,
  enhanceLiveGroup,
  enhanceLiveLeague,
  type CalendarDay,
  type CalendarGame,
  type EnhancedLiveGroup,
  type EnhancedLiveLeague,
  type LiveGroup,
  type LiveLeague,
} from '@fantazone/domain'
import {
  GitHubJsonStore,
  type RepositoryJsonReadOptions,
  type RepositoryJsonWriteOptions,
} from './repositoryStore'
import type { GroupRepositoryTarget } from './repositoryTarget'

export const LIVE_GROUP_DOCUMENT_PATH = 'data/groups/live-group.json'

/** GitHub replacement for Fantasoccer LiveGroupService using schema-v2 documents directly. */
export class GitHubLiveGroupRepository {
  constructor(
    private readonly store: GitHubJsonStore,
    private readonly repository: GroupRepositoryTarget,
  ) {}

  async getLiveGroup(options: RepositoryJsonReadOptions = {}): Promise<LiveGroup | null> {
    const snapshot = await this.store.tryReadJson<LiveGroup>(this.location(), options)
    return snapshot?.value ?? null
  }

  async getEnhancedLiveGroup(options: RepositoryJsonReadOptions = {}): Promise<EnhancedLiveGroup | null> {
    const group = await this.getLiveGroup(options)
    return group ? enhanceLiveGroup(group) : null
  }

  async getLiveLeagues(options: RepositoryJsonReadOptions = {}): Promise<LiveLeague[]> {
    return (await this.getLiveGroup(options))?.leagues ?? []
  }

  async getEnhancedLiveLeagues(options: RepositoryJsonReadOptions = {}): Promise<EnhancedLiveLeague[]> {
    return (await this.getEnhancedLiveGroup(options))?.leaguesWithRounds ?? []
  }

  async getLiveLeague(leagueId: string, options: RepositoryJsonReadOptions = {}): Promise<LiveLeague | null> {
    const group = await this.getLiveGroup(options)
    return group ? LiveGroupHelper.getLeagueById(group, leagueId) : null
  }

  async getEnhancedLiveLeague(leagueId: string, options: RepositoryJsonReadOptions = {}): Promise<EnhancedLiveLeague | null> {
    const league = await this.getLiveLeague(leagueId, options)
    return league ? enhanceLiveLeague(league) : null
  }

  async getLiveRound(leagueId: string, roundKey: string): Promise<CalendarDay | null> {
    const league = await this.getLiveLeague(leagueId)
    return league ? LiveLeagueHelper.getRound(league, roundKey) : null
  }

  async getPendingGames(): Promise<CalendarGame[]> {
    const leagues = await this.getLiveLeagues()
    return leagues.flatMap(league => LiveLeagueHelper.getPendingGames(league))
  }

  async writeLiveGroup(
    group: LiveGroup,
    message = 'chore: update live group',
    options: RepositoryJsonWriteOptions = {},
  ): Promise<string> {
    const snapshot = await this.store.writeJson(this.location(), group, message, options)
    return snapshot.sha
  }

  private location() {
    return { ...this.repository, path: LIVE_GROUP_DOCUMENT_PATH }
  }
}
