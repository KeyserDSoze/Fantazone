import {
  ChanceType,
  TrendType,
  type Chance,
  type ChancedRealPlayer,
  type ChancedRealPlayers,
} from '@fantazone/domain'
import {
  GitHubJsonStore,
  type RepositoryJsonReadOptions,
  type RepositoryJsonSnapshot,
  type RepositoryJsonWriteOptions,
} from './repositoryStore'
import type { PlatformRepositoryTarget } from './repositoryTarget'
import { decodeRealPlayer } from './realPlayerRepository'

export const SERIE_A_CHANCES_ROOT = 'data/serie-a/chances'

export function chanceDocumentPath(year: number, serieADay: number): string {
  assertSeason(year)
  assertDay(serieADay)
  return `${SERIE_A_CHANCES_ROOT}/${year}/${serieADay}.json`
}

export class GitHubChanceRepository {
  constructor(
    private readonly store: GitHubJsonStore,
    private readonly repository: PlatformRepositoryTarget,
  ) {}

  async getSnapshot(year: number, serieADay: number, options: RepositoryJsonReadOptions = {}): Promise<RepositoryJsonSnapshot<ChancedRealPlayers> | null> {
    const snapshot = await this.store.tryReadJson<unknown>(this.location(year, serieADay), options)
    if (!snapshot) return null
    return { ...snapshot, value: decodeChancedRealPlayers(snapshot.value, year, serieADay) }
  }

  async get(year: number, serieADay: number, options: RepositoryJsonReadOptions = {}): Promise<ChancedRealPlayers | null> {
    return (await this.getSnapshot(year, serieADay, options))?.value ?? null
  }

  async write(value: ChancedRealPlayers, message = `chore: update Serie A chances ${value.year}/${value.serieADay}`, options: RepositoryJsonWriteOptions = {}): Promise<string> {
    const decoded = decodeChancedRealPlayers(value, value.year, value.serieADay)
    return (await this.store.writeJson(this.location(value.year, value.serieADay), decoded, message, options)).sha
  }

  private location(year: number, serieADay: number) {
    return { ...this.repository, path: chanceDocumentPath(year, serieADay) }
  }
}

export function decodeChancedRealPlayers(value: unknown, expectedYear?: number, expectedDay?: number): ChancedRealPlayers {
  if (!value || typeof value !== 'object') throw invalidDocument(expectedYear, expectedDay)
  const document = value as Partial<ChancedRealPlayers>
  if (!Number.isInteger(document.year) || !Number.isInteger(document.serieADay) || !Array.isArray(document.players)) {
    throw invalidDocument(expectedYear, expectedDay)
  }
  const year = document.year as number
  const serieADay = document.serieADay as number
  if (expectedYear != null && year !== expectedYear) throw new Error(`Chance year mismatch: expected ${expectedYear}, found ${year}`)
  if (expectedDay != null && serieADay !== expectedDay) throw new Error(`Chance day mismatch: expected ${expectedDay}, found ${serieADay}`)
  assertSeason(year)
  assertDay(serieADay)
  return { year, serieADay, players: document.players.map((player, index) => decodeChancedRealPlayer(player, index)) }
}

function decodeChancedRealPlayer(value: unknown, index: number): ChancedRealPlayer {
  if (!value || typeof value !== 'object') throw new Error(`Invalid chanced player at index ${index}`)
  const base = decodeRealPlayer(value, index)
  const chance = decodeChance((value as { chance?: unknown }).chance, index)
  return { ...base, chance }
}

function decodeChance(value: unknown, index: number): Chance {
  if (!value || typeof value !== 'object') throw new Error(`Invalid chance at player index ${index}`)
  const chance = value as Partial<Chance>
  if (
    typeof chance.fantagazzetta !== 'boolean' ||
    typeof chance.gazzetta !== 'boolean' ||
    typeof chance.mediaset !== 'boolean' ||
    typeof chance.sky !== 'boolean' ||
    !isChanceType(chance.status) ||
    !(typeof chance.description === 'string' || chance.description === null) ||
    !isTrendType(chance.trend) ||
    !(chance.lastGame === null || isStatPlayerGame(chance.lastGame))
  ) throw new Error(`Invalid chance at player index ${index}`)

  return {
    fantagazzetta: chance.fantagazzetta,
    gazzetta: chance.gazzetta,
    mediaset: chance.mediaset,
    sky: chance.sky,
    status: chance.status,
    description: chance.description,
    lastGame: chance.lastGame ? { ...chance.lastGame } : null,
    trend: chance.trend,
  }
}

function isChanceType(value: unknown): value is ChanceType {
  return typeof value === 'number' && Number.isInteger(value) && value >= ChanceType.Normal && value <= ChanceType.Maybe
}

function isTrendType(value: unknown): value is TrendType {
  return typeof value === 'number' && Number.isInteger(value) && value >= TrendType.Bad && value <= TrendType.Excellent
}

function isStatPlayerGame(value: unknown): value is NonNullable<Chance['lastGame']> {
  if (!value || typeof value !== 'object') return false
  const game = value as Record<string, unknown>
  return Number.isInteger(game.serieADay) &&
    (game.vote === null || typeof game.vote === 'number') &&
    typeof game.positiveness === 'number' && Number.isFinite(game.positiveness)
}

function invalidDocument(year?: number, day?: number): Error {
  return new Error(`Unsupported Serie A chance JSON schema${year ? ` for ${year}${day ? `/${day}` : ''}` : ''}. Fantazone requires readable schema v2.`)
}

function assertSeason(year: number): void {
  if (!Number.isInteger(year) || year < 1) throw new Error('Season id must be a positive integer')
}

function assertDay(day: number): void {
  if (!Number.isInteger(day) || day < 1 || day > 38) throw new Error('Serie A day must be between 1 and 38')
}
