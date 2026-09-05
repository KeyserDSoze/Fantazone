import {
  TeamHelper,
  enhanceTeam,
  type EnhancedTeam,
  type LeagueSetting,
  type Player,
  type Rank,
  type Role,
  type Team,
} from '@fantazone/domain'
import {
  GitHubJsonStore,
  type RepositoryJsonReadOptions,
  type RepositoryJsonSnapshot,
  type RepositoryJsonWriteOptions,
} from './repositoryStore'
import type { GroupRepositoryTarget } from './repositoryTarget'
import type { GitHubRankRepository } from './rankRepository'

export class GitHubTeamRepository {
  constructor(
    private readonly store: GitHubJsonStore,
    private readonly repository: GroupRepositoryTarget,
    private readonly rankRepository?: GitHubRankRepository,
  ) {}

  async getTeam(basketId: string, season: number, email: string, options: RepositoryJsonReadOptions = {}): Promise<Team | null> {
    return (await this.getTeamSnapshot(basketId, season, email, options))?.value ?? null
  }

  async getTeamDay(basketId: string, season: number, day: number, email: string, options: RepositoryJsonReadOptions = {}): Promise<Team | null> {
    return (await this.getTeamDaySnapshot(basketId, season, day, email, options))?.value ?? null
  }

  async getTeamSnapshot(basketId: string, season: number, email: string, options: RepositoryJsonReadOptions = {}): Promise<RepositoryJsonSnapshot<Team> | null> {
    return this.store.tryReadJson<Team>(this.location(seasonTeamDocumentPath(basketId, season, email)), options)
  }

  async getTeamDaySnapshot(basketId: string, season: number, day: number, email: string, options: RepositoryJsonReadOptions = {}): Promise<RepositoryJsonSnapshot<Team> | null> {
    return this.store.tryReadJson<Team>(this.location(dayTeamDocumentPath(basketId, season, day, email)), options)
  }

  async getEnhancedTeam(basketId: string, season: number, email: string, context: { leagueId?: string; leagueSettings?: LeagueSetting } = {}): Promise<EnhancedTeam | null> {
    const team = await this.getTeam(basketId, season, email)
    return team ? this.enhanceWithOptionalRank(team, season, context) : null
  }

  async getEnhancedTeamDay(basketId: string, season: number, day: number, email: string, context: { leagueId?: string; leagueSettings?: LeagueSetting } = {}): Promise<EnhancedTeam | null> {
    const team = await this.getTeamDay(basketId, season, day, email)
    return team ? this.enhanceWithOptionalRank(team, season, context) : null
  }

  async getTeamPlayers(basketId: string, season: number, email: string): Promise<Player[]> {
    return (await this.getTeam(basketId, season, email))?.players ?? []
  }

  async getActiveTeamPlayers(basketId: string, season: number, email: string): Promise<Player[]> {
    const team = await this.getTeam(basketId, season, email)
    return team ? TeamHelper.getActivePlayers(team) : []
  }

  async getTeamPlayersByRole(basketId: string, season: number, email: string, role: Role): Promise<Player[]> {
    const team = await this.getTeam(basketId, season, email)
    return team ? TeamHelper.getPlayersByRole(team, role) : []
  }

  async getTeamsByBasket(basketId: string, season: number, owners: string[]): Promise<Team[]> {
    const teams = await Promise.all(owners.map(owner => this.getTeam(basketId, season, owner)))
    return teams.filter((team): team is Team => team !== null)
  }

  async writeTeam(basketId: string, season: number, email: string, team: Team, message = 'chore: update season team', options: RepositoryJsonWriteOptions = {}): Promise<string> {
    return (await this.store.writeJson(this.location(seasonTeamDocumentPath(basketId, season, email)), team, message, options)).sha
  }

  async writeTeamDay(basketId: string, season: number, day: number, email: string, team: Team, message = 'chore: update day team', options: RepositoryJsonWriteOptions = {}): Promise<string> {
    return (await this.store.writeJson(this.location(dayTeamDocumentPath(basketId, season, day, email)), team, message, options)).sha
  }

  private async enhanceWithOptionalRank(team: Team, season: number, context: { leagueId?: string; leagueSettings?: LeagueSetting }): Promise<EnhancedTeam> {
    if ((!team.moneyFromRank || team.moneyFromRank === 0) && context.leagueId && context.leagueSettings && this.rankRepository) {
      const rank: Rank | null = await this.rankRepository.getRank(context.leagueId, season)
      const moneyFromRank = TeamHelper.calculateMoneyFromRank(team, rank, context.leagueSettings)
      if (moneyFromRank !== 0) team = { ...team, moneyFromRank }
    }
    return enhanceTeam(team)
  }

  private location(path: string) {
    return { ...this.repository, path }
  }
}

export function seasonTeamDocumentPath(basketId: string, season: number, email: string): string {
  validateTeamKey(basketId, season, email)
  return `data/groups/seasons/${season}/teams/${encodeURIComponent(basketId.trim())}/${encodeURIComponent(email.trim())}.json`
}

export function dayTeamDocumentPath(basketId: string, season: number, day: number, email: string): string {
  validateTeamKey(basketId, season, email)
  if (!Number.isInteger(day) || day < 1) throw new Error('Day must be a positive integer')
  return `data/groups/seasons/${season}/days/${day}/teams/${encodeURIComponent(basketId.trim())}/${encodeURIComponent(email.trim())}.json`
}

function validateTeamKey(basketId: string, season: number, email: string): void {
  if (!Number.isInteger(season) || season < 1) throw new Error('Season must be a positive integer')
  if (!basketId.trim()) throw new Error('Basket id is required')
  if (!email.trim()) throw new Error('Owner email is required')
}
