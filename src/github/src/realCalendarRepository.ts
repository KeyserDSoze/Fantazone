import type { RealCalendar, RealDay, RealGame, RealTeam } from '@fantazone/domain'
import {
  GitHubJsonStore,
  type RepositoryJsonReadOptions,
  type RepositoryJsonSnapshot,
  type RepositoryJsonWriteOptions,
} from './repositoryStore'
import type { PlatformRepositoryTarget } from './repositoryTarget'

export const SERIE_A_CALENDAR_ROOT = 'data/serie-a/calendars'

export function realCalendarDocumentPath(season: number): string {
  if (!Number.isInteger(season) || season < 1) throw new Error('Serie A calendar season id must be a positive integer')
  return `${SERIE_A_CALENDAR_ROOT}/${season}.json`
}

/** Shared/global Serie A calendar repository. It is intentionally not scoped to one fantasy group. */
export class GitHubRealCalendarRepository {
  constructor(
    private readonly store: GitHubJsonStore,
    private readonly repository: PlatformRepositoryTarget,
  ) {}

  async getCalendar(season: number, options: RepositoryJsonReadOptions = {}): Promise<RealCalendar | null> {
    return (await this.getCalendarSnapshot(season, options))?.value ?? null
  }

  async getCalendarSnapshot(
    season: number,
    options: RepositoryJsonReadOptions = {},
  ): Promise<RepositoryJsonSnapshot<RealCalendar> | null> {
    const snapshot = await this.store.tryReadJson<unknown>(this.location(season), options)
    if (!snapshot) return null
    return { ...snapshot, value: decodeRealCalendar(snapshot.value, season) }
  }

  async writeCalendar(
    calendar: RealCalendar,
    message = `chore: update Serie A calendar ${calendar.year}`,
    options: RepositoryJsonWriteOptions = {},
  ): Promise<string> {
    const decoded = decodeRealCalendar(calendar, calendar.year)
    const snapshot = await this.store.writeJson(this.location(calendar.year), decoded, message, options)
    return snapshot.sha
  }

  private location(season: number) {
    return { ...this.repository, path: realCalendarDocumentPath(season) }
  }
}

export function decodeRealCalendar(value: unknown, expectedSeason?: number): RealCalendar {
  if (!value || typeof value !== 'object') throw invalidCalendar(expectedSeason)
  const calendar = value as Partial<RealCalendar>
  const year = calendar.year
  if (typeof year !== 'number' || !Number.isInteger(year) || !Array.isArray(calendar.days)) {
    throw invalidCalendar(expectedSeason)
  }
  if (expectedSeason != null && year !== expectedSeason) {
    throw new Error(`Serie A calendar season mismatch: expected ${expectedSeason}, found ${year}`)
  }

  return {
    year,
    days: calendar.days.map((day, index) => decodeDay(day, year, index)),
  }
}

function decodeDay(value: unknown, calendarSeason: number, index: number): RealDay {
  if (!value || typeof value !== 'object') throw new Error(`Invalid Serie A day at index ${index}`)
  const day = value as Partial<RealDay>
  const year = day.year
  const serieADay = day.serieADay
  if (typeof year !== 'number' || !Number.isInteger(year) ||
      typeof serieADay !== 'number' || !Number.isInteger(serieADay) ||
      !Array.isArray(day.games)) {
    throw new Error(`Invalid Serie A day at index ${index}`)
  }
  if (year !== calendarSeason) {
    throw new Error(`Serie A day ${serieADay} belongs to season ${year}, expected ${calendarSeason}`)
  }
  return {
    year,
    serieADay,
    games: day.games.map((game, gameIndex) => decodeGame(game, serieADay, gameIndex)),
  }
}

function decodeGame(value: unknown, serieADay: number, index: number): RealGame {
  if (!value || typeof value !== 'object') throw new Error(`Invalid Serie A game ${serieADay}/${index}`)
  const game = value as Partial<RealGame>
  if (!isRealTeam(game.home) || !isRealTeam(game.away) ||
      !(game.date == null || typeof game.date === 'string') ||
      !(game.homeGoals == null || typeof game.homeGoals === 'number') ||
      !(game.awayGoals == null || typeof game.awayGoals === 'number') ||
      typeof game.delayed !== 'boolean') {
    throw new Error(`Invalid Serie A game ${serieADay}/${index}`)
  }
  return {
    home: { ...game.home },
    away: { ...game.away },
    date: game.date ?? null,
    homeGoals: game.homeGoals ?? null,
    awayGoals: game.awayGoals ?? null,
    delayed: game.delayed,
  }
}

function isRealTeam(value: unknown): value is RealTeam {
  if (!value || typeof value !== 'object') return false
  const team = value as Partial<RealTeam>
  return typeof team.name === 'string' && typeof team.abbreviation === 'string'
}

function invalidCalendar(expectedSeason?: number): Error {
  return new Error(`Unsupported Serie A calendar JSON schema${expectedSeason ? ` for season ${expectedSeason}` : ''}. Fantazone schema v2 requires readable property names.`)
}
