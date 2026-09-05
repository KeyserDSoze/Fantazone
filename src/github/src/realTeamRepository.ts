import type { RealTeam, RealTeams } from '@fantazone/domain'
import {
  GitHubJsonStore,
  type RepositoryJsonReadOptions,
  type RepositoryJsonSnapshot,
  type RepositoryJsonWriteOptions,
} from './repositoryStore'
import type { PlatformRepositoryTarget } from './repositoryTarget'

export const SERIE_A_TEAMS_ROOT = 'data/serie-a/teams'

export function realTeamsDocumentPath(year: number): string {
  assertSeason(year)
  return `${SERIE_A_TEAMS_ROOT}/${year}.json`
}

export class GitHubRealTeamsRepository {
  constructor(
    private readonly store: GitHubJsonStore,
    private readonly repository: PlatformRepositoryTarget,
  ) {}

  async getTeams(year: number, options: RepositoryJsonReadOptions = {}): Promise<RealTeams | null> {
    return (await this.getTeamsSnapshot(year, options))?.value ?? null
  }

  async getTeamsSnapshot(
    year: number,
    options: RepositoryJsonReadOptions = {},
  ): Promise<RepositoryJsonSnapshot<RealTeams> | null> {
    const snapshot = await this.store.tryReadJson<unknown>(this.location(year), options)
    if (!snapshot) return null
    return { ...snapshot, value: decodeRealTeams(snapshot.value, year) }
  }

  async writeTeams(
    value: RealTeams,
    message = `chore: update Serie A teams ${value.year}`,
    options: RepositoryJsonWriteOptions = {},
  ): Promise<string> {
    const decoded = decodeRealTeams(value, value.year)
    const snapshot = await this.store.writeJson(this.location(value.year), decoded, message, options)
    return snapshot.sha
  }

  private location(year: number) {
    return { ...this.repository, path: realTeamsDocumentPath(year) }
  }
}

export function decodeRealTeams(value: unknown, expectedYear?: number): RealTeams {
  if (!value || typeof value !== 'object') throw invalidTeams(expectedYear)
  const document = value as Partial<RealTeams>
  if (!Number.isInteger(document.year) || !Array.isArray(document.teams)) throw invalidTeams(expectedYear)
  const year = document.year as number
  if (expectedYear != null && year !== expectedYear) {
    throw new Error(`Serie A teams year mismatch: expected ${expectedYear}, found ${year}`)
  }
  return { year, teams: document.teams.map((team, index) => decodeRealTeam(team, index)) }
}

export function decodeRealTeam(value: unknown, index = -1): RealTeam {
  if (!value || typeof value !== 'object') throw new Error(`Invalid Serie A team${index >= 0 ? ` at index ${index}` : ''}`)
  const team = value as Partial<RealTeam>
  if (typeof team.name !== 'string' || !team.name.trim() || typeof team.abbreviation !== 'string' || !team.abbreviation.trim()) {
    throw new Error(`Invalid Serie A team${index >= 0 ? ` at index ${index}` : ''}`)
  }
  return { name: team.name, abbreviation: team.abbreviation }
}

function invalidTeams(expectedYear?: number): Error {
  return new Error(`Unsupported Serie A teams JSON schema${expectedYear ? ` for ${expectedYear}` : ''}. Fantazone requires readable schema v2.`)
}

function assertSeason(year: number): void {
  if (!Number.isInteger(year) || year < 1) throw new Error('Season id must be a positive integer')
}
