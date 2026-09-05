import type { StatPlayer, StatPlayerGame, StatPlayers } from '@fantazone/domain'
import {
  GitHubJsonStore,
  type RepositoryJsonReadOptions,
  type RepositoryJsonSnapshot,
  type RepositoryJsonWriteOptions,
} from './repositoryStore'
import type { PlatformRepositoryTarget } from './repositoryTarget'
import { decodeRealPlayer } from './realPlayerRepository'

export const SERIE_A_STATS_ROOT = 'data/serie-a/stats'

export function statPlayersDocumentPath(year: number): string {
  assertSeason(year)
  return `${SERIE_A_STATS_ROOT}/${year}.json`
}

export class GitHubStatPlayersRepository {
  constructor(
    private readonly store: GitHubJsonStore,
    private readonly repository: PlatformRepositoryTarget,
  ) {}

  async getStats(year: number, options: RepositoryJsonReadOptions = {}): Promise<StatPlayers | null> {
    return (await this.getStatsSnapshot(year, options))?.value ?? null
  }

  async getStatsSnapshot(
    year: number,
    options: RepositoryJsonReadOptions = {},
  ): Promise<RepositoryJsonSnapshot<StatPlayers> | null> {
    const snapshot = await this.store.tryReadJson<unknown>(this.location(year), options)
    if (!snapshot) return null
    return { ...snapshot, value: decodeStatPlayers(snapshot.value, year) }
  }

  async writeStats(
    value: StatPlayers,
    message = `chore: rebuild Serie A player stats ${value.year} through day ${value.untilSerieADay}`,
    options: RepositoryJsonWriteOptions = {},
  ): Promise<string> {
    const decoded = decodeStatPlayers(value, value.year)
    const snapshot = await this.store.writeJson(this.location(value.year), decoded, message, options)
    return snapshot.sha
  }

  private location(year: number) {
    return { ...this.repository, path: statPlayersDocumentPath(year) }
  }
}

export function decodeStatPlayers(value: unknown, expectedYear?: number): StatPlayers {
  if (!value || typeof value !== 'object') throw invalidStats(expectedYear)
  const document = value as Partial<StatPlayers>
  const year = document.year
  const untilSerieADay = document.untilSerieADay
  if (
    typeof year !== 'number' || !Number.isInteger(year) ||
    typeof untilSerieADay !== 'number' || !Number.isInteger(untilSerieADay) ||
    untilSerieADay < 1 || untilSerieADay > 38 ||
    !Array.isArray(document.players)
  ) {
    throw invalidStats(expectedYear)
  }
  if (expectedYear != null && year !== expectedYear) {
    throw new Error(`Serie A stats year mismatch: expected ${expectedYear}, found ${year}`)
  }
  return { year, untilSerieADay, players: document.players.map((player, index) => decodeStatPlayer(player, index)) }
}

export function decodeStatPlayer(value: unknown, index = -1): StatPlayer {
  if (!value || typeof value !== 'object') throw invalidPlayer(index)
  const base = decodeRealPlayer(value, index)
  const player = value as Partial<StatPlayer>
  if (!finite(player.summatory) || !finite(player.fantaSummatory) || !Array.isArray(player.games)) {
    throw invalidPlayer(index)
  }
  return {
    ...base,
    summatory: player.summatory,
    fantaSummatory: player.fantaSummatory,
    withVote: count(player.withVote, index),
    withoutVote: count(player.withoutVote, index),
    noPlayed: count(player.noPlayed, index),
    withSpecial: count(player.withSpecial, index),
    goals: count(player.goals, index),
    penalties: count(player.penalties, index),
    assists: count(player.assists, index),
    stoppedPenalties: count(player.stoppedPenalties, index),
    sufferedGoals: count(player.sufferedGoals, index),
    wrongedPenalties: count(player.wrongedPenalties, index),
    ownGoals: count(player.ownGoals, index),
    yellowCards: count(player.yellowCards, index),
    redCards: count(player.redCards, index),
    enoughVotes: count(player.enoughVotes, index),
    manOfTheMatch: count(player.manOfTheMatch, index),
    injured: count(player.injured, index),
    games: player.games.map((game, gameIndex) => decodeStatPlayerGame(game, index, gameIndex)),
  }
}

export function decodeStatPlayerGame(value: unknown, playerIndex = -1, gameIndex = -1): StatPlayerGame {
  if (!value || typeof value !== 'object') throw invalidGame(playerIndex, gameIndex)
  const game = value as Partial<StatPlayerGame>
  if (
    typeof game.serieADay !== 'number' || !Number.isInteger(game.serieADay) || game.serieADay < 1 || game.serieADay > 38 ||
    !(game.vote == null || finite(game.vote)) ||
    typeof game.positiveness !== 'number' || !Number.isInteger(game.positiveness)
  ) {
    throw invalidGame(playerIndex, gameIndex)
  }
  return { serieADay: game.serieADay, vote: game.vote ?? null, positiveness: game.positiveness }
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function count(value: unknown, index: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw invalidPlayer(index)
  return value
}

function invalidPlayer(index: number): Error {
  return new Error(`Invalid StatPlayer${suffix(index)}`)
}

function invalidGame(playerIndex: number, gameIndex: number): Error {
  return new Error(`Invalid StatPlayer game${playerIndex >= 0 ? ` for player ${playerIndex}` : ''}${gameIndex >= 0 ? ` at index ${gameIndex}` : ''}`)
}

function suffix(index: number): string {
  return index >= 0 ? ` at index ${index}` : ''
}

function invalidStats(year?: number): Error {
  return new Error(`Unsupported Serie A stats JSON schema${year != null ? ` for ${year}` : ''}. Fantazone requires readable schema v2.`)
}

function assertSeason(year: number): void {
  if (!Number.isInteger(year) || year < 1) throw new Error('Season id must be a positive integer')
}
