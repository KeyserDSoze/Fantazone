import { GameResultHelper, type CalendarDay, type CalendarGame, type GameResult, type Point } from './calendar'
import { calculateEvolutionMatch, type EvolutionRuleTrace } from './evolution'
import type {
  EvolutionCardSelection,
  EvolutionPlayerMatchState,
  EvolutionPlayerSkillAssignment,
} from './evolutionModel'
import { type LeagueSetting, type LeagueType } from './group'
import { TeamHelper, type Team } from './team'
import { calculateTeamPoint, type TeamPointCalculation } from './teamCalculation'
import type { VotedRealPlayers } from './vote'

export type DefinitiveDayMode = 'force' | 'missing-only'
export type TeamsByOwner = ReadonlyMap<string, Team | null | undefined>

export interface DefinitiveDayEvolutionGameContext {
  homeSkillAssignments?: EvolutionPlayerSkillAssignment[]
  awaySkillAssignments?: EvolutionPlayerSkillAssignment[]
  homeCards?: EvolutionCardSelection | null
  awayCards?: EvolutionCardSelection | null
  homePlayerState?: Record<string, EvolutionPlayerMatchState | undefined>
  awayPlayerState?: Record<string, EvolutionPlayerMatchState | undefined>
  seed?: string
}

export interface DefinitiveDayCalculationInput {
  day: CalendarDay
  teamsByOwner: TeamsByOwner
  officialVotes: VotedRealPlayers | null
  leagueType: LeagueType
  settings: LeagueSetting
  mode?: DefinitiveDayMode
  /** Optional match-owned Evolution state. Families and league rules still work without it. */
  evolutionByGameId?: ReadonlyMap<string, DefinitiveDayEvolutionGameContext | undefined>
  onEvolutionTrace?: (gameId: string, trace: EvolutionRuleTrace[]) => void
}

/**
 * Pure definitive calculation. Real football votes remain immutable inputs; Evolution
 * adds explainable modifiers after normal fantasy scoring and before fantasy goals.
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
  const homeBase = homeTeam?.players ? calculatePoint(homeTeam, input) : zeroCalculation()
  const awayBase = awayTeam?.players ? calculatePoint(awayTeam, input) : zeroCalculation()
  const evolutionContext = input.evolutionByGameId?.get(game.id)
  const evolution = calculateEvolutionMatch({
    home: homeBase,
    away: awayBase,
    settings: input.settings,
    ...evolutionContext,
  })
  if (evolution.trace.length > 0) input.onEvolutionTrace?.(game.id, evolution.trace)

  // A missing immutable TeamDay is an authoritative zero exactly like the classic
  // calculator: neither home advantage nor an Evolution rule may manufacture points.
  const home = homeTeam?.players
    ? addHomeAdvantage(evolution.home.point, input.settings.pointInHome)
    : zeroPoint()
  const away = awayTeam?.players ? evolution.away.point : zeroPoint()
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

function calculatePoint(team: Team, input: DefinitiveDayCalculationInput): TeamPointCalculation {
  return calculateTeamPoint({
    players: TeamHelper.getActivePlayers(team),
    officialVotes: input.officialVotes,
    liveVotes: null,
    leagueType: input.leagueType,
    settings: input.settings,
  })
}

function zeroCalculation(): TeamPointCalculation {
  return { point: zeroPoint(), formation: [] }
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
