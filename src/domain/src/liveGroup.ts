import {
  GameResultHelper,
  type CalendarDay,
  type CalendarGame,
} from './calendar'
import {
  enhanceRank,
  type EnhancedRank,
  type Rank,
} from './rank'

/** Persisted directly in data/groups/live-group.json. */
export interface LiveLeague {
  id: string
  name: string
  rounds: Record<string, CalendarDay>
  rank: Rank | null
}

/** Persisted directly in data/groups/live-group.json. */
export interface LiveGroup {
  name: string
  leagues: LiveLeague[]
}

export interface LiveLeagueRound {
  key: string
  day: CalendarDay
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

export class LiveLeagueHelper {
  static getRoundKeys(league: LiveLeague): string[] {
    return Object.keys(league.rounds ?? {})
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  }

  static getRoundsList(league: LiveLeague): LiveLeagueRound[] {
    return this.getRoundKeys(league).map(key => ({ key, day: league.rounds[key] }))
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
      .flatMap(day => day.games ?? [])
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
