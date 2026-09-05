import { GameResultHelper, type CalendarDay, type CalendarGame, type GameResult, type Point } from './calendar'
import { type LeagueSetting, type LeagueType } from './group'
import { TeamHelper, type Team } from './team'
import { calculateTeamPoint } from './teamCalculation'
import type { VotedRealPlayers } from './vote'

export type DefinitiveDayMode = 'force' | 'missing-only'
export type TeamsByOwner = ReadonlyMap<string, Team | null | undefined>

export interface DefinitiveDayCalculationInput {
  day: CalendarDay
  teamsByOwner: TeamsByOwner
  officialVotes: VotedRealPlayers | null
  leagueType: LeagueType
  settings: LeagueSetting
  mode?: DefinitiveDayMode
}

/**
 * Pure port of GroupsManagerJob.CalculateDayAsync.
 * Definitive results use official votes only: live votes are intentionally not an input.
 */
export function calculateDefinitiveDay(input: DefinitiveDayCalculationInput): CalendarDay {
  const mode = input.mode ?? 'force'
  const games = input.day.games.map(source => calculateGame(source, input, mode))
  return { ...input.day, games }
}

function calculateGame(
  source: CalendarGame,
  input: DefinitiveDayCalculationInput,
  mode: DefinitiveDayMode,
): CalendarGame {
  const game = cloneGame(source)
  if (game.result?.isCancelled === true) return game
  if (mode === 'missing-only' && game.result != null) return game

  const homeTeam = input.teamsByOwner.get(game.homeOwner) ?? null
  const awayTeam = input.teamsByOwner.get(game.awayOwner) ?? null
  const home = homeTeam?.players
    ? addHomeAdvantage(calculatePoint(homeTeam, input), input.settings.pointInHome)
    : zeroPoint()
  const away = awayTeam?.players ? calculatePoint(awayTeam, input) : zeroPoint()

  const result: GameResult = {
    home,
    away,
    isCancelled: false,
    homeGoals: 0,
    awayGoals: 0,
  }
  const goals = GameResultHelper.calculateGoals(result, input.settings)
  result.homeGoals = goals.home
  result.awayGoals = goals.away
  game.result = result
  return game
}

function calculatePoint(team: Team, input: DefinitiveDayCalculationInput): Point {
  return calculateTeamPoint({
    players: TeamHelper.getActivePlayers(team),
    officialVotes: input.officialVotes,
    liveVotes: null,
    leagueType: input.leagueType,
    settings: input.settings,
  }).point
}

function addHomeAdvantage(point: Point, advantage: number): Point {
  return { ...point, value: point.value + advantage }
}

function zeroPoint(): Point {
  return { value: 0, defensiveBonus: false, goodPeople: false, ownGoal: false }
}

function cloneGame(game: CalendarGame): CalendarGame {
  return {
    ...game,
    result: game.result ? {
      ...game.result,
      home: { ...game.result.home },
      away: { ...game.result.away },
    } : null,
  }
}
