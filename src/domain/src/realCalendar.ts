import type { RealTeam } from './realTeam'

const MATCH_LIVE_WINDOW_MS = (2 * 60 + 15) * 60 * 1000
const DAY_LIVE_TAIL_MS = (10 * 60 + 15) * 60 * 1000

export interface RealGame {
  home: RealTeam
  away: RealTeam
  /** ISO-8601 instant. Keep persistence JSON-native; helpers parse it when needed. */
  date: string | null
  homeGoals: number | null
  awayGoals: number | null
  delayed: boolean
}

export interface RealDay {
  /** Internal Fantazone season id, e.g. 15 = 2026/27. */
  year: number
  serieADay: number
  games: RealGame[]
}

export interface RealCalendar {
  /** Internal Fantazone season id, matching Calendar/Team/Rank year keys. */
  year: number
  days: RealDay[]
}

export type RealCalendarContext = {
  liveDay: RealDay | null
  lastDay: RealDay | null
  nextDay: RealDay | null
  liveGames: RealGame[]
  liveSerieADay: number
  nextSerieADay: number | null
  isLive: boolean
  isDuringSerieADay: boolean
}

/**
 * Pure projection of the legacy C# RealCalendar timing rules.
 * Nothing in this helper is persisted; callers inject `now` so behavior is deterministic in tests.
 */
export class RealCalendarHelper {
  static getLiveDay(calendar: RealCalendar, now = new Date()): RealDay | null {
    const nowMs = now.getTime()
    return calendar.days.find(day => {
      const games = timedGames(day)
      if (games.length === 0) return false
      const first = games[0].time
      const last = games[games.length - 1].time
      return nowMs >= first && nowMs <= last + DAY_LIVE_TAIL_MS
    }) ?? null
  }

  static getLastDay(calendar: RealCalendar, now = new Date()): RealDay | null {
    const nowMs = now.getTime()
    return [...calendar.days]
      .sort((a, b) => b.serieADay - a.serieADay)
      .find(day => {
        const games = timedGames(day)
        if (games.length === 0) return false
        return nowMs >= games[games.length - 1].time + MATCH_LIVE_WINDOW_MS
      }) ?? null
  }

  static getNextDay(calendar: RealCalendar, now = new Date()): RealDay | null {
    const live = this.getLiveDay(calendar, now)
    const last = live ? null : this.getLastDay(calendar, now)
    const nextNumber = (live?.serieADay ?? last?.serieADay ?? 0) + 1
    return calendar.days.find(day => day.serieADay === nextNumber) ?? null
  }

  static getLiveGames(calendar: RealCalendar, now = new Date()): RealGame[] {
    const day = this.getLiveDay(calendar, now)
    if (!day) return []
    const nowMs = now.getTime()
    return day.games.filter(game => {
      if (game.delayed) return false
      const time = gameTime(game)
      return time != null && nowMs >= time && nowMs <= time + MATCH_LIVE_WINDOW_MS
    })
  }

  static getLiveSerieADay(calendar: RealCalendar, now = new Date()): number {
    return this.getLiveDay(calendar, now)?.serieADay ?? 0
  }

  static getNextSerieADay(calendar: RealCalendar, now = new Date()): number | null {
    return this.getNextDay(calendar, now)?.serieADay ?? null
  }

  static isLive(calendar: RealCalendar, now = new Date()): boolean {
    return this.getLiveGames(calendar, now).length > 0
  }

  static isDuringSerieADay(calendar: RealCalendar, now = new Date()): boolean {
    return this.getLiveSerieADay(calendar, now) > 0
  }

  static context(calendar: RealCalendar, now = new Date()): RealCalendarContext {
    const liveDay = this.getLiveDay(calendar, now)
    const lastDay = liveDay ? null : this.getLastDay(calendar, now)
    const nextNumber = (liveDay?.serieADay ?? lastDay?.serieADay ?? 0) + 1
    const nextDay = calendar.days.find(day => day.serieADay === nextNumber) ?? null
    const liveGames = liveDay ? this.getLiveGames(calendar, now) : []
    return {
      liveDay,
      lastDay,
      nextDay,
      liveGames,
      liveSerieADay: liveDay?.serieADay ?? 0,
      nextSerieADay: nextDay?.serieADay ?? null,
      isLive: liveGames.length > 0,
      isDuringSerieADay: liveDay != null,
    }
  }
}

export class RealGameHelper {
  static isPlayed(game: RealGame, now = new Date()): boolean {
    const time = gameTime(game)
    return !game.delayed && time != null && now.getTime() > time
  }
}

function timedGames(day: RealDay): Array<{ game: RealGame; time: number }> {
  return day.games
    .filter(game => !game.delayed)
    .map(game => ({ game, time: gameTime(game) }))
    .filter((entry): entry is { game: RealGame; time: number } => entry.time != null)
    .sort((a, b) => a.time - b.time)
}

function gameTime(game: RealGame): number | null {
  if (!game.date) return null
  const value = Date.parse(game.date)
  return Number.isFinite(value) ? value : null
}
