import type { LeagueSetting } from './group'

export enum GameResultType {
  HomeWon = 0,
  AwayWon = 1,
  Tie = 2,
}

export interface Point {
  value: number
  defensiveBonus: boolean
  goodPeople: boolean
  ownGoal: boolean
}

export interface GameResult {
  home: Point
  away: Point
  isCancelled: boolean
  homeGoals: number
  awayGoals: number
}

export interface EnhancedGameResult extends GameResult {
  hasValue: boolean
  resultType: GameResultType
}

export interface CalendarGame {
  id: string
  number: number
  home: string
  homeOwner: string
  away: string
  awayOwner: string
  result: GameResult | null
}

export interface CalendarDay {
  serieADay: number
  number: number
  games: CalendarGame[]
}

export type CalendarRounds = Record<string, CalendarDay[]>

/** Persisted directly as calendar.json in schema v2. */
export interface Calendar {
  year: number
  rounds: CalendarRounds
}

export interface EnhancedCalendar extends Calendar {
  roundKeys: string[]
  allDays: CalendarDay[]
  allGames: CalendarGame[]
  pendingGames: CalendarGame[]
}

export class GameResultHelper {
  static hasValue(result: GameResult | null | undefined): boolean {
    if (!result) return false
    return (result.home?.value ?? 0) > 0 || (result.away?.value ?? 0) > 0
  }

  static getResultType(result: GameResult | null | undefined): GameResultType {
    if (!result) return GameResultType.Tie
    const { homeGoals, awayGoals } = result
    if (homeGoals > awayGoals) return GameResultType.HomeWon
    if (homeGoals < awayGoals) return GameResultType.AwayWon
    return GameResultType.Tie
  }

  static calculateGoals(result: GameResult, settings: LeagueSetting): { home: number; away: number } {
    const home = GameResultHelper.calculateTeamGoals(result.home.value, result.away.value, settings)
    const away = GameResultHelper.calculateTeamGoals(result.away.value, result.home.value, settings)
    return { home, away }
  }

  private static calculateTeamGoals(value: number, opponentValue: number, settings: LeagueSetting): number {
    let goals = 0

    if (value - settings.pointForFirstGoal >= 0) {
      goals = 1 + Math.floor((value - settings.pointForFirstGoal) / settings.pointForNextGoal)
    }

    const diff = settings.differencePointForOwnGoal
    if (diff > 0 && value < 66 && opponentValue <= (65.5 - diff) && value - opponentValue >= diff) {
      goals += 1
    }

    return goals
  }

  static enhance(result: GameResult | null | undefined): EnhancedGameResult | null {
    if (!result) return null
    return {
      ...result,
      hasValue: GameResultHelper.hasValue(result),
      resultType: GameResultHelper.getResultType(result),
    }
  }
}

export class CalendarHelper {
  static getRound(calendar: Calendar, roundKey: string): CalendarDay[] {
    return calendar.rounds[roundKey] ?? []
  }

  static getAllRoundKeys(calendar: Calendar): string[] {
    return Object.keys(calendar.rounds).sort()
  }

  static getAllDays(calendar: Calendar): CalendarDay[] {
    return CalendarHelper.getAllRoundKeys(calendar).flatMap(key => CalendarHelper.getRound(calendar, key))
  }

  static getDayByNumber(calendar: Calendar, dayNumber: number): CalendarDay | null {
    return CalendarHelper.getAllDays(calendar).find(day => day.number === dayNumber) ?? null
  }

  static getAllGames(calendar: Calendar): CalendarGame[] {
    return CalendarHelper.getAllDays(calendar).flatMap(day => day.games ?? [])
  }

  static getGamesForTeam(calendar: Calendar, teamName: string): CalendarGame[] {
    const teamNameLower = teamName.toLowerCase()
    return CalendarHelper.getAllGames(calendar).filter(
      game => game.home.toLowerCase() === teamNameLower || game.away.toLowerCase() === teamNameLower,
    )
  }

  static getPendingGames(calendar: Calendar): CalendarGame[] {
    return CalendarHelper.getAllGames(calendar).filter(game => !GameResultHelper.hasValue(game.result))
  }

  static enhanceCalendar(calendar: Calendar): EnhancedCalendar {
    const roundKeys = CalendarHelper.getAllRoundKeys(calendar)
    const allDays = CalendarHelper.getAllDays(calendar)
    const allGames = CalendarHelper.getAllGames(calendar)
    const pendingGames = allGames.filter(game => !GameResultHelper.hasValue(game.result))

    return {
      ...calendar,
      roundKeys,
      allDays,
      allGames,
      pendingGames,
    }
  }
}

export const enhanceCalendar = (calendar: Calendar): EnhancedCalendar => CalendarHelper.enhanceCalendar(calendar)
