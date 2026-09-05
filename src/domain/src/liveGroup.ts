import {
  GameResultHelper,
  mapRawDayToDay,
  type CalendarDay,
  type CalendarGame,
  type DayRaw,
} from './calendar'
import {
  enhanceRank,
  mapRawRankToRank,
  type EnhancedRank,
  type Rank,
  type RankRaw,
} from './rank'

export type LiveLeagueRoundsRaw = Record<string, DayRaw | DayRaw[] | null | undefined>

export interface LiveLeagueRaw {
  i: string
  l: string
  d?: LiveLeagueRoundsRaw
  r?: RankRaw | null
}

export interface LiveGroupRaw {
  n: string
  l: LiveLeagueRaw[]
}

export interface LiveLeagueRound {
  key: string
  day: CalendarDay
}

export interface LiveLeague {
  id: string
  name: string
  rounds: Record<string, CalendarDay>
  rank: Rank | null
}

export interface LiveGroup {
  name: string
  leagues: LiveLeague[]
}

export interface EnhancedLiveLeague extends LiveLeague {
  roundKeys: string[]
  roundsList: LiveLeagueRound[]
  latestRoundKey: string | null
  pendingGames: CalendarGame[]
  enhancedRank: EnhancedRank | null
}

export interface EnhancedLiveGroup extends LiveGroup {
  leaguesWithRounds: EnhancedLiveLeague[]
  totalPendingGames: number
}

function mapRawRoundsToCalendarDays(rawRounds?: LiveLeagueRoundsRaw): Record<string, CalendarDay> {
  const rounds: Record<string, CalendarDay> = {}
  if (!rawRounds) return rounds

  for (const [key, value] of Object.entries(rawRounds)) {
    if (!value) continue
    const dayRaw = Array.isArray(value) ? value.find(day => Boolean(day)) : value
    if (dayRaw) rounds[key] = mapRawDayToDay(dayRaw)
  }
  return rounds
}

export const mapRawLiveLeagueToLiveLeague = (raw: LiveLeagueRaw): LiveLeague => ({
  id: raw?.i ?? '',
  name: raw?.l ?? '',
  rounds: mapRawRoundsToCalendarDays(raw?.d),
  rank: raw?.r ? mapRawRankToRank(raw.r) : null,
})

export const mapRawLiveGroupToLiveGroup = (raw: LiveGroupRaw): LiveGroup => ({
  name: raw?.n ?? '',
  leagues: raw?.l?.map(mapRawLiveLeagueToLiveLeague) ?? [],
})

export class LiveLeagueHelper {
  static getRoundKeys(league: LiveLeague): string[] {
    return Object.keys(league.rounds ?? {}).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  }

  static getRoundsList(league: LiveLeague): LiveLeagueRound[] {
    return this.getRoundKeys(league)
      .map(key => ({ key, day: league.rounds[key] }))
      .filter(round => round.day != null)
  }

  static getRound(league: LiveLeague, roundKey: string): CalendarDay | null {
    return league.rounds[roundKey] ?? null
  }

  static getLatestRoundKey(league: LiveLeague): string | null {
    const keys = this.getRoundKeys(league)
    return keys.length ? keys[keys.length - 1] : null
  }

  static getPendingGames(league: LiveLeague): CalendarGame[] {
    return Object.values(league.rounds)
      .flatMap(day => day?.games ?? [])
      .filter(game => !GameResultHelper.hasValue(game.result))
  }

  static enhance(league: LiveLeague): EnhancedLiveLeague {
    const roundKeys = this.getRoundKeys(league)
    const roundsList = this.getRoundsList(league)
    const latestRoundKey = this.getLatestRoundKey(league)
    const pendingGames = this.getPendingGames(league)
    const enhancedRank = league.rank ? enhanceRank(league.rank) : null
    return { ...league, roundKeys, roundsList, latestRoundKey, pendingGames, enhancedRank }
  }
}

export class LiveGroupHelper {
  static getLeagueById(group: LiveGroup, leagueId: string): LiveLeague | null {
    return group.leagues.find(league => league.id === leagueId) ?? null
  }

  static getLeaguesWithRounds(group: LiveGroup): LiveLeague[] {
    return group.leagues.filter(league => Object.keys(league.rounds).length > 0)
  }

  static enhance(group: LiveGroup): EnhancedLiveGroup {
    const leaguesWithRounds = group.leagues.map(league => LiveLeagueHelper.enhance(league))
    const totalPendingGames = leaguesWithRounds.reduce((sum, league) => sum + league.pendingGames.length, 0)
    return { ...group, leaguesWithRounds, totalPendingGames }
  }
}

export const enhanceLiveLeague = (league: LiveLeague): EnhancedLiveLeague => LiveLeagueHelper.enhance(league)
export const enhanceLiveGroup = (group: LiveGroup): EnhancedLiveGroup => LiveGroupHelper.enhance(group)
