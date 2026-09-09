import type { OpeningCompetitionStandings, Team } from '@fantazone/domain'
import {
  GitHubJsonStore,
  type RepositoryJsonReadOptions,
  type RepositoryJsonSnapshot,
  type RepositoryJsonWriteOptions,
} from './repositoryStore'
import type { GroupRepositoryTarget } from './repositoryTarget'

export class GitHubOpeningCompetitionRepository {
  constructor(
    private readonly store: GitHubJsonStore,
    private readonly repository: GroupRepositoryTarget,
  ) {}

  async getTeam(leagueId: string, season: number, basketId: string, email: string, options: RepositoryJsonReadOptions = {}): Promise<Team | null> {
    return (await this.getTeamSnapshot(leagueId, season, basketId, email, options))?.value ?? null
  }

  async getTeamSnapshot(leagueId: string, season: number, basketId: string, email: string, options: RepositoryJsonReadOptions = {}): Promise<RepositoryJsonSnapshot<Team> | null> {
    return this.store.tryReadJson<Team>(this.location(openingTeamDocumentPath(leagueId, season, basketId, email)), options)
  }

  async writeTeam(leagueId: string, season: number, basketId: string, email: string, team: Team, message = 'chore: write opening team', options: RepositoryJsonWriteOptions = {}): Promise<string> {
    return (await this.store.writeJson(this.location(openingTeamDocumentPath(leagueId, season, basketId, email)), normalizeTeam(team), message, options)).sha
  }

  async getTeamDay(leagueId: string, season: number, basketId: string, day: number, email: string, options: RepositoryJsonReadOptions = {}): Promise<Team | null> {
    return (await this.getTeamDaySnapshot(leagueId, season, basketId, day, email, options))?.value ?? null
  }

  async getTeamDaySnapshot(leagueId: string, season: number, basketId: string, day: number, email: string, options: RepositoryJsonReadOptions = {}): Promise<RepositoryJsonSnapshot<Team> | null> {
    return this.store.tryReadJson<Team>(this.location(openingTeamDayDocumentPath(leagueId, season, basketId, day, email)), options)
  }

  async writeTeamDay(leagueId: string, season: number, basketId: string, day: number, email: string, team: Team, message = 'chore: write opening team day', options: RepositoryJsonWriteOptions = {}): Promise<string> {
    return (await this.store.writeJson(this.location(openingTeamDayDocumentPath(leagueId, season, basketId, day, email)), normalizeTeam(team), message, options)).sha
  }

  async getStandings(leagueId: string, season: number, options: RepositoryJsonReadOptions = {}): Promise<OpeningCompetitionStandings | null> {
    return (await this.getStandingsSnapshot(leagueId, season, options))?.value ?? null
  }

  async getStandingsSnapshot(leagueId: string, season: number, options: RepositoryJsonReadOptions = {}): Promise<RepositoryJsonSnapshot<OpeningCompetitionStandings> | null> {
    return this.store.tryReadJson<OpeningCompetitionStandings>(this.location(openingCompetitionDocumentPath(leagueId, season)), options)
  }

  async writeStandings(leagueId: string, season: number, value: OpeningCompetitionStandings, message = 'chore: update opening competition standings', options: RepositoryJsonWriteOptions = {}): Promise<string> {
    return (await this.store.writeJson(this.location(openingCompetitionDocumentPath(leagueId, season)), value, message, options)).sha
  }

  private location(path: string) { return { ...this.repository, path } }
}

export function openingTeamDocumentPath(leagueId: string, season: number, basketId: string, email: string): string {
  validate(leagueId, season, basketId, email)
  return `data/groups/seasons/${season}/opening/${encodeURIComponent(leagueId.trim())}/teams/${encodeURIComponent(basketId.trim())}/${email.trim()}.json`
}

export function openingTeamDayDocumentPath(leagueId: string, season: number, basketId: string, day: number, email: string): string {
  validate(leagueId, season, basketId, email)
  if (!Number.isInteger(day) || day < 1 || day > 38) throw new Error('Opening competition day must be between 1 and 38')
  return `data/groups/seasons/${season}/opening/${encodeURIComponent(leagueId.trim())}/days/${day}/teams/${encodeURIComponent(basketId.trim())}/${email.trim()}.json`
}

export function openingCompetitionDocumentPath(leagueId: string, season: number): string {
  if (!leagueId.trim()) throw new Error('League id is required')
  if (!Number.isInteger(season) || season < 1) throw new Error('Season must be a positive integer')
  return `data/groups/seasons/${season}/opening/${encodeURIComponent(leagueId.trim())}/standings.json`
}

function normalizeTeam(team: Team): Team {
  return {
    ...team,
    additionalOwners: [...(team.additionalOwners ?? [])],
    openingCompetitionPrize: team.openingCompetitionPrize ?? 0,
    formationChanges: team.formationChanges ?? 0,
    players: team.players.map(player => ({ ...player, team: { ...player.team } })),
  }
}

function validate(leagueId: string, season: number, basketId: string, email: string): void {
  if (!leagueId.trim()) throw new Error('League id is required')
  if (!Number.isInteger(season) || season < 1) throw new Error('Season must be a positive integer')
  if (!basketId.trim()) throw new Error('Basket id is required')
  if (!email.trim() || email.includes('/') || email.includes('\\')) throw new Error('Owner email is invalid')
}
