import {
  enhanceRank,
  enhanceRankedTeam,
  enhanceRankWithTeamPositions,
  mapRankToRawRank,
  mapRawRankToRank,
  RankHelper,
  type EnhancedRank,
  type EnhancedRankedTeam,
  type Rank,
  type RankedTeam,
  type RankRaw,
} from '@fantazone/domain'
import {
  GitHubJsonStore,
  type RepositoryJsonReadOptions,
  type RepositoryJsonWriteOptions,
} from './repositoryStore'
import type { GroupRepositoryTarget } from './calendarRepository'

export class GitHubRankRepository {
  constructor(
    private readonly store: GitHubJsonStore,
    private readonly repository: GroupRepositoryTarget,
  ) {}

  async getRank(
    leagueId: string,
    season: number,
    options: RepositoryJsonReadOptions = {},
  ): Promise<Rank | null> {
    return this.readRank(seasonRankDocumentPath(leagueId, season), options)
  }

  async getDailyRank(
    leagueId: string,
    season: number,
    day: number,
    options: RepositoryJsonReadOptions = {},
  ): Promise<Rank | null> {
    return this.readRank(dailyRankDocumentPath(leagueId, season, day), options)
  }

  async getEnhancedRank(leagueId: string, season: number): Promise<EnhancedRank | null> {
    const rank = await this.getRank(leagueId, season)
    return rank ? enhanceRank(rank) : null
  }

  async getTeamRanking(
    leagueId: string,
    season: number,
    roundId: string,
    owner: string,
  ): Promise<RankedTeam | null> {
    const rank = await this.getRank(leagueId, season)
    return rank ? RankHelper.getRankedTeamByOwner(rank, roundId, owner) : null
  }

  async getEnhancedTeamRanking(
    leagueId: string,
    season: number,
    roundId: string,
    owner: string,
  ): Promise<EnhancedRankedTeam | null> {
    const rank = await this.getRank(leagueId, season)
    if (!rank) return null
    const team = RankHelper.getRankedTeamByOwner(rank, roundId, owner)
    if (!team) return null
    const position = RankHelper.getTeamPosition(rank, roundId, owner)
    return enhanceRankedTeam(team, position > 0 ? position : undefined)
  }

  async getTeamPosition(leagueId: string, season: number, roundId: string, owner: string): Promise<number> {
    const rank = await this.getRank(leagueId, season)
    return rank ? RankHelper.getTeamPosition(rank, roundId, owner) : -1
  }

  async getRoundRanking(leagueId: string, season: number, roundId: string): Promise<RankedTeam[]> {
    const rank = await this.getRank(leagueId, season)
    return rank ? RankHelper.getTeamsSortedByPoints(rank, roundId) : []
  }

  async getEnhancedRoundRanking(
    leagueId: string,
    season: number,
    roundId: string,
  ): Promise<EnhancedRankedTeam[]> {
    const rank = await this.getRank(leagueId, season)
    return rank ? (enhanceRankWithTeamPositions(rank)[roundId] ?? []) : []
  }

  async getRoundRankingByValueAssets(
    leagueId: string,
    season: number,
    roundId: string,
  ): Promise<RankedTeam[]> {
    const rank = await this.getRank(leagueId, season)
    return rank ? RankHelper.getTeamsSortedByValueAssets(rank, roundId) : []
  }

  async getAvailableRounds(leagueId: string, season: number): Promise<string[]> {
    const rank = await this.getRank(leagueId, season)
    return rank ? RankHelper.getAvailableRounds(rank) : []
  }

  async getRoundTeamCount(leagueId: string, season: number, roundId: string): Promise<number> {
    const rank = await this.getRank(leagueId, season)
    return rank ? RankHelper.getTeamCount(rank, roundId) : 0
  }

  async getCurrentSerieADay(leagueId: string, season: number): Promise<number> {
    return (await this.getRank(leagueId, season))?.serieADay ?? 0
  }

  async writeRank(
    leagueId: string,
    season: number,
    rank: Rank,
    message = 'rank: update season ranking',
    options: RepositoryJsonWriteOptions = {},
  ): Promise<string> {
    const result = await this.store.writeJson(
      this.location(seasonRankDocumentPath(leagueId, season)),
      mapRankToRawRank(rank),
      message,
      options,
    )
    return result.sha
  }

  async writeDailyRank(
    leagueId: string,
    season: number,
    day: number,
    rank: Rank,
    message = `rank: update day ${day}`,
    options: RepositoryJsonWriteOptions = {},
  ): Promise<string> {
    const result = await this.store.writeJson(
      this.location(dailyRankDocumentPath(leagueId, season, day)),
      mapRankToRawRank(rank),
      message,
      options,
    )
    return result.sha
  }

  private async readRank(path: string, options: RepositoryJsonReadOptions): Promise<Rank | null> {
    const snapshot = await this.store.tryReadJson<RankRaw>(this.location(path), options)
    return snapshot ? mapRawRankToRank(snapshot.value) : null
  }

  private location(path: string) {
    return { ...this.repository, path }
  }
}

export function seasonRankDocumentPath(leagueId: string, season: number): string {
  return `${leaguePath(leagueId, season)}/ranking.json`
}

export function dailyRankDocumentPath(leagueId: string, season: number, day: number): string {
  if (!Number.isInteger(day) || day < 1) throw new Error('Day must be a positive integer')
  return `${leaguePath(leagueId, season)}/days/${day}/ranking.json`
}

function leaguePath(leagueId: string, season: number): string {
  if (!Number.isInteger(season) || season < 1) throw new Error('Season must be a positive integer')
  const normalizedLeague = leagueId.trim()
  if (!normalizedLeague) throw new Error('League id is required')
  return `data/groups/seasons/${season}/leagues/${encodeURIComponent(normalizedLeague)}`
}
