import {
  LiveGroupHelper,
  LiveLeagueHelper,
  enhanceLiveGroup,
  enhanceLiveLeague,
  mapRawLiveGroupToLiveGroup,
  type CalendarDay,
  type CalendarGame,
  type EnhancedLiveGroup,
  type EnhancedLiveLeague,
  type LiveGroup,
  type LiveGroupRaw,
  type LiveLeague,
} from '@fantazone/domain'
import { GitHubJsonStore, type RepositoryJsonReadOptions, type RepositoryJsonWriteOptions } from './repositoryStore'
import type { GroupRepositoryTarget } from './repositoryTarget'

export const LIVE_GROUP_DOCUMENT_PATH = 'data/groups/live-group.json'

/** GitHub replacement for Fantasoccer LiveGroupService. */
export class GitHubLiveGroupRepository {
  constructor(
    private readonly store: GitHubJsonStore,
    private readonly repository: GroupRepositoryTarget,
  ) {}

  async getRawLiveGroup(options: RepositoryJsonReadOptions = {}): Promise<LiveGroupRaw | null> {
    const snapshot = await this.store.tryReadJson<LiveGroupRaw>(this.location(), options)
    return snapshot?.value ?? null
  }

  async getLiveGroup(options: RepositoryJsonReadOptions = {}): Promise<LiveGroup | null> {
    const raw = await this.getRawLiveGroup(options)
    return raw ? mapRawLiveGroupToLiveGroup(raw) : null
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

  /**
   * Actions/reducers write the exact legacy raw snapshot. We intentionally do
   * not reverse-map the clean projection because a raw round may be DayRaw OR
   * DayRaw[], information the clean legacy view deliberately collapses.
   */
  async writeRawLiveGroup(
    raw: LiveGroupRaw,
    message = 'chore: update live group',
    options: RepositoryJsonWriteOptions = {},
  ): Promise<string> {
    const snapshot = await this.store.writeJson(this.location(), raw, message, options)
    return snapshot.sha
  }

  private location() {
    return { ...this.repository, path: LIVE_GROUP_DOCUMENT_PATH }
  }
}
