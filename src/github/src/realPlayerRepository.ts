import { Role, type RealPlayer, type RealPlayers } from '@fantazone/domain'
import {
  GitHubJsonStore,
  type RepositoryJsonReadOptions,
  type RepositoryJsonSnapshot,
  type RepositoryJsonWriteOptions,
} from './repositoryStore'
import type { PlatformRepositoryTarget } from './repositoryTarget'
import { decodeRealTeam } from './realTeamRepository'

export const SERIE_A_PLAYERS_ROOT = 'data/serie-a/players'

export function realPlayersDocumentPath(year: number): string {
  assertSeason(year)
  return `${SERIE_A_PLAYERS_ROOT}/${year}.json`
}

export class GitHubRealPlayersRepository {
  constructor(
    private readonly store: GitHubJsonStore,
    private readonly repository: PlatformRepositoryTarget,
  ) {}

  async getPlayers(year: number, options: RepositoryJsonReadOptions = {}): Promise<RealPlayers | null> {
    return (await this.getPlayersSnapshot(year, options))?.value ?? null
  }

  async getPlayersSnapshot(
    year: number,
    options: RepositoryJsonReadOptions = {},
  ): Promise<RepositoryJsonSnapshot<RealPlayers> | null> {
    const snapshot = await this.store.tryReadJson<unknown>(this.location(year), options)
    if (!snapshot) return null
    return { ...snapshot, value: decodeRealPlayers(snapshot.value, year) }
  }

  async writePlayers(
    value: RealPlayers,
    message = `chore: update Serie A players ${value.year}`,
    options: RepositoryJsonWriteOptions = {},
  ): Promise<string> {
    const decoded = decodeRealPlayers(value, value.year)
    const snapshot = await this.store.writeJson(this.location(value.year), decoded, message, options)
    return snapshot.sha
  }

  private location(year: number) {
    return { ...this.repository, path: realPlayersDocumentPath(year) }
  }
}

export function decodeRealPlayers(value: unknown, expectedYear?: number): RealPlayers {
  if (!value || typeof value !== 'object') throw invalidPlayers(expectedYear)
  const document = value as Partial<RealPlayers>
  if (!Number.isInteger(document.year) || !Array.isArray(document.players)) throw invalidPlayers(expectedYear)
  const year = document.year as number
  if (expectedYear != null && year !== expectedYear) {
    throw new Error(`Serie A players year mismatch: expected ${expectedYear}, found ${year}`)
  }
  return { year, players: document.players.map((player, index) => decodeRealPlayer(player, index)) }
}

export function decodeRealPlayer(value: unknown, index = -1): RealPlayer {
  if (!value || typeof value !== 'object') throw invalidPlayer(index)
  const player = value as Partial<RealPlayer>
  if (
    typeof player.name !== 'string' || !player.name.trim() ||
    typeof player.role !== 'number' || !isRole(player.role) ||
    typeof player.isActive !== 'boolean' ||
    typeof player.visible !== 'boolean'
  ) {
    throw invalidPlayer(index)
  }
  return {
    name: player.name,
    team: decodeRealTeam(player.team),
    role: player.role,
    isActive: player.isActive,
    visible: player.visible,
  }
}

function isRole(value: number): value is Role {
  return Number.isInteger(value) && value >= Role.Undefined && value <= Role.Forward
}

function invalidPlayers(expectedYear?: number): Error {
  return new Error(`Unsupported Serie A players JSON schema${expectedYear ? ` for ${expectedYear}` : ''}. Fantazone requires readable schema v2.`)
}

function invalidPlayer(index: number): Error {
  return new Error(`Invalid Serie A player${index >= 0 ? ` at index ${index}` : ''}`)
}

function assertSeason(year: number): void {
  if (!Number.isInteger(year) || year < 1) throw new Error('Season id must be a positive integer')
}
