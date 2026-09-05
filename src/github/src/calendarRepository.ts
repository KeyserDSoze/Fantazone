import {
  CalendarHelper,
  enhanceCalendar,
  type Calendar,
  type CalendarDay,
  type CalendarGame,
  type EnhancedCalendar,
} from '@fantazone/domain'
import { GitHubJsonStore, type RepositoryJsonReadOptions } from './repositoryStore'
import type { GroupRepositoryTarget } from './repositoryTarget'

export class GitHubCalendarRepository {
  constructor(
    private readonly store: GitHubJsonStore,
    private readonly repository: GroupRepositoryTarget,
  ) {}

  async getCalendar(
    leagueId: string,
    season: number,
    options: RepositoryJsonReadOptions = {},
  ): Promise<Calendar | null> {
    const snapshot = await this.store.tryReadJson<Calendar>(this.location(leagueId, season), options)
    return snapshot?.value ?? null
  }

  async getEnhancedCalendar(
    leagueId: string,
    season: number,
    options: RepositoryJsonReadOptions = {},
  ): Promise<EnhancedCalendar | null> {
    const calendar = await this.getCalendar(leagueId, season, options)
    return calendar ? enhanceCalendar(calendar) : null
  }

  async getRoundKeys(leagueId: string, season: number): Promise<string[]> {
    const calendar = await this.getCalendar(leagueId, season)
    return calendar ? CalendarHelper.getAllRoundKeys(calendar) : []
  }

  async getRound(leagueId: string, season: number, roundKey: string): Promise<CalendarDay[]> {
    const calendar = await this.getCalendar(leagueId, season)
    return calendar ? CalendarHelper.getRound(calendar, roundKey) : []
  }

  async getDay(leagueId: string, season: number, dayNumber: number): Promise<CalendarDay | null> {
    const calendar = await this.getCalendar(leagueId, season)
    return calendar ? CalendarHelper.getDayByNumber(calendar, dayNumber) : null
  }

  async getAllDays(leagueId: string, season: number): Promise<CalendarDay[]> {
    const calendar = await this.getCalendar(leagueId, season)
    return calendar ? CalendarHelper.getAllDays(calendar) : []
  }

  async getAllGames(leagueId: string, season: number): Promise<CalendarGame[]> {
    const calendar = await this.getCalendar(leagueId, season)
    return calendar ? CalendarHelper.getAllGames(calendar) : []
  }

  async getGamesForTeam(leagueId: string, season: number, teamName: string): Promise<CalendarGame[]> {
    const calendar = await this.getCalendar(leagueId, season)
    return calendar ? CalendarHelper.getGamesForTeam(calendar, teamName) : []
  }

  async getPendingGames(leagueId: string, season: number): Promise<CalendarGame[]> {
    const calendar = await this.getCalendar(leagueId, season)
    return calendar ? CalendarHelper.getPendingGames(calendar) : []
  }

  private location(leagueId: string, season: number) {
    return {
      ...this.repository,
      path: calendarDocumentPath(leagueId, season),
    }
  }
}

export function calendarDocumentPath(leagueId: string, season: number): string {
  if (!Number.isInteger(season) || season < 1) throw new Error('Season must be a positive integer')
  const normalizedLeague = leagueId.trim()
  if (!normalizedLeague) throw new Error('League id is required')

  return `data/groups/seasons/${season}/leagues/${encodeURIComponent(normalizedLeague)}/calendar.json`
}
