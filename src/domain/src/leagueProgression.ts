import { GameResultHelper, type Calendar, type CalendarDay, type CalendarGame, type GameResult } from './calendar'
import { LeagueType } from './group'
import type { Rank, RankedTeam } from './rank'

export const CUP_FINALS_ROUND = 'Finals'
export const EUROPA_LEAGUE_ROUND = 'Europa League'
export const SUPER_CUP_ROUND = 'Supercoppa'

export interface LeagueProgressionInput {
  calendar: Calendar
  rank: Rank
  leagueType: LeagueType
}

export interface LeagueProgressionResult {
  calendar: Calendar
  changed: boolean
}

type QualifiedTeam = { name: string; owner: string }

/**
 * Pure replacement for legacy ILeagueCalculator.AddDaysInLeague.
 * League/SuperLeague remain no-ops; Cup/NewCup knockout rounds are appended only
 * after every currently scheduled game is complete or cancelled.
 *
 * Legacy used cryptographic randomness for perfect ties. Fantazone replaces that
 * last-resort branch with a stable seeded choice so rebuilds are deterministic.
 */
export function progressLeagueCalendar(input: LeagueProgressionInput): LeagueProgressionResult {
  const calendar = cloneCalendar(input.calendar)
  switch (input.leagueType) {
    case LeagueType.Cup:
      return progressClassicCup(calendar, input.rank)
    case LeagueType.NewCup:
      return progressNewCup(calendar, input.rank)
    default:
      return { calendar, changed: false }
  }
}

function progressClassicCup(calendar: Calendar, rank: Rank): LeagueProgressionResult {
  if (!hasDays(calendar) || !allScheduledGamesComplete(calendar)) return { calendar, changed: false }

  const finals = calendar.rounds[CUP_FINALS_ROUND]
  if (finals?.slice().sort((a, b) => b.number - a.number)[0]?.games.length === 1) {
    return { calendar, changed: false }
  }

  let nextTeams: QualifiedTeam[] = []
  if (!finals) {
    nextTeams = Object.values(rank.rounds)
      .flatMap(teams => teams.slice(0, 2))
      .map(toQualifiedTeam)
    calendar.rounds[CUP_FINALS_ROUND] = []
  } else if (finals.length > 1) {
    nextTeams = resolveLatestTwoLegRound(calendar, CUP_FINALS_ROUND, rank, 3)
  }

  if (nextTeams.length === 0) return { calendar, changed: false }
  appendKnockoutStage(calendar, CUP_FINALS_ROUND, nextTeams, 3)
  return { calendar, changed: true }
}

function progressNewCup(calendar: Calendar, rank: Rank): LeagueProgressionResult {
  if (calendar.rounds[SUPER_CUP_ROUND]) return { calendar, changed: false }
  if (!hasDays(calendar) || !allScheduledGamesComplete(calendar)) return { calendar, changed: false }

  let changed = false
  const winners: QualifiedTeam[] = []
  for (const [index, roundName] of [CUP_FINALS_ROUND, EUROPA_LEAGUE_ROUND].entries()) {
    const round = calendar.rounds[roundName]
    let nextTeams: QualifiedTeam[] = []

    if (!round) {
      nextTeams = Object.values(rank.rounds)
        .flatMap(teams => teams.slice(index * 8, index * 8 + 8))
        .map(toQualifiedTeam)
      calendar.rounds[roundName] = []
    } else {
      const latestFinal = round
        .filter(day => day.games.length === 1 && GameResultHelper.hasValue(day.games[0]?.result))
        .sort((a, b) => b.number - a.number)[0]
      if (latestFinal) {
        winners.push(resolveSingleGameWinner(latestFinal.games[0], `${calendar.year}|${roundName}|winner`))
        continue
      }
      if (round.length > 1) nextTeams = resolveLatestTwoLegRound(calendar, roundName, rank, 1)
    }

    if (nextTeams.length > 0) {
      appendKnockoutStage(calendar, roundName, nextTeams, 1)
      changed = true
    }
  }

  if (winners.length === 2 && !calendar.rounds[SUPER_CUP_ROUND]) {
    calendar.rounds[SUPER_CUP_ROUND] = [{
      number: 38,
      serieADay: 38,
      games: [createGame(calendar, SUPER_CUP_ROUND, 38, 1, winners[0], winners[1])],
    }]
    changed = true
  }

  return { calendar, changed }
}

function resolveLatestTwoLegRound(
  calendar: Calendar,
  roundName: string,
  rank: Rank,
  dayMultiplier: number,
): QualifiedTeam[] {
  const round = calendar.rounds[roundName]
  if (!round || round.length < 2) return []
  const latestSerieADay = maxSerieADay(calendar)
  const first = round.find(day => day.serieADay === latestSerieADay - dayMultiplier)
  const second = round.find(day => day.serieADay === latestSerieADay)
  if (!first || !second) return []

  const nextTeams: QualifiedTeam[] = []
  for (const firstLeg of first.games) {
    const secondLeg = second.games.find(game => game.homeOwner === firstLeg.awayOwner)
    if (!secondLeg || !firstLeg.result || !secondLeg.result) continue
    nextTeams.push(resolveTwoLegWinner(
      firstLeg,
      secondLeg,
      rank,
      `${calendar.year}|${roundName}|${first.number}|${firstLeg.homeOwner}|${firstLeg.awayOwner}`,
    ))
  }
  return nextTeams
}

function resolveTwoLegWinner(
  first: CalendarGame,
  second: CalendarGame,
  rank: Rank,
  seed: string,
): QualifiedTeam {
  const firstResult = requireResult(first)
  const secondResult = requireResult(second)
  let homeAggregate = firstResult.homeGoals + secondResult.awayGoals
  let awayAggregate = firstResult.awayGoals + secondResult.homeGoals

  if (homeAggregate === awayAggregate) {
    homeAggregate = firstResult.homeGoals + 2 * secondResult.awayGoals
    awayAggregate = 2 * firstResult.awayGoals + secondResult.homeGoals
  }
  if (homeAggregate > awayAggregate) return { owner: first.homeOwner, name: first.home }
  if (awayAggregate > homeAggregate) return { owner: first.awayOwner, name: first.away }

  const homePoints = firstResult.home.value + secondResult.away.value
  const awayPoints = firstResult.away.value + secondResult.home.value
  if (homePoints > awayPoints) return { owner: first.homeOwner, name: first.home }
  if (awayPoints > homePoints) return { owner: first.awayOwner, name: first.away }

  const homeRank = findRankedTeam(rank, first.homeOwner)?.valuePoint ?? 0
  const awayRank = findRankedTeam(rank, first.awayOwner)?.valuePoint ?? 0
  if (homeRank > awayRank) return { owner: first.homeOwner, name: first.home }
  if (awayRank > homeRank) return { owner: first.awayOwner, name: first.away }

  return deterministicPick(
    { owner: first.homeOwner, name: first.home },
    { owner: first.awayOwner, name: first.away },
    seed,
  )
}

function resolveSingleGameWinner(game: CalendarGame, seed: string): QualifiedTeam {
  const result = requireResult(game)
  if (result.homeGoals > result.awayGoals) return { owner: game.homeOwner, name: game.home }
  if (result.awayGoals > result.homeGoals) return { owner: game.awayOwner, name: game.away }
  if (result.home.value > result.away.value) return { owner: game.homeOwner, name: game.home }
  if (result.away.value > result.home.value) return { owner: game.awayOwner, name: game.away }
  return deterministicPick(
    { owner: game.homeOwner, name: game.home },
    { owner: game.awayOwner, name: game.away },
    seed,
  )
}

function appendKnockoutStage(
  calendar: Calendar,
  roundName: string,
  teams: QualifiedTeam[],
  dayMultiplier: number,
): void {
  if (teams.length < 2 || teams.length % 2 !== 0) return
  const round = calendar.rounds[roundName] ?? (calendar.rounds[roundName] = [])
  const currentSerieADay = maxSerieADay(calendar)
  const currentNumber = maxDayNumber(calendar)
  const legs = teams.length === 2 ? 1 : 2

  for (let adder = 1; adder <= legs; adder += 1) {
    const day: CalendarDay = {
      number: currentNumber + adder,
      serieADay: currentSerieADay + adder * dayMultiplier,
      games: [],
    }
    for (let index = 0; index < teams.length / 2; index += 1) {
      const home = adder === 1 ? teams[index] : teams[teams.length - 1 - index]
      const away = adder === 1 ? teams[teams.length - 1 - index] : teams[index]
      day.games.push(createGame(calendar, roundName, day.number, index + 1, home, away))
    }
    round.push(day)
  }
}

function createGame(
  calendar: Calendar,
  roundName: string,
  dayNumber: number,
  gameNumber: number,
  home: QualifiedTeam,
  away: QualifiedTeam,
): CalendarGame {
  return {
    id: [
      'progression',
      calendar.year,
      encodeURIComponent(roundName),
      dayNumber,
      gameNumber,
      encodeURIComponent(home.owner),
      encodeURIComponent(away.owner),
    ].join(':'),
    number: gameNumber,
    home: home.name,
    homeOwner: home.owner,
    away: away.name,
    awayOwner: away.owner,
    result: null,
  }
}

function allScheduledGamesComplete(calendar: Calendar): boolean {
  return Object.values(calendar.rounds)
    .flatMap(days => days)
    .flatMap(day => day.games)
    .every(game => game.result?.isCancelled === true || GameResultHelper.hasValue(game.result))
}

function findRankedTeam(rank: Rank, owner: string): RankedTeam | null {
  return Object.values(rank.rounds).flat().find(team => team.owner === owner) ?? null
}

function deterministicPick(a: QualifiedTeam, b: QualifiedTeam, seed: string): QualifiedTeam {
  const hash = stableHash(`${seed}|${a.owner}|${b.owner}`)
  return hash % 2 === 0 ? a : b
}

function stableHash(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function requireResult(game: CalendarGame): GameResult {
  if (!game.result) throw new Error(`Knockout game ${game.id} has no result`)
  return game.result
}

function toQualifiedTeam(team: RankedTeam): QualifiedTeam {
  return { owner: team.owner, name: team.name }
}

function hasDays(calendar: Calendar): boolean {
  return Object.values(calendar.rounds).some(days => days.length > 0)
}

function maxSerieADay(calendar: Calendar): number {
  return Math.max(...Object.values(calendar.rounds).flatMap(days => days.map(day => day.serieADay)))
}

function maxDayNumber(calendar: Calendar): number {
  return Math.max(...Object.values(calendar.rounds).flatMap(days => days.map(day => day.number)))
}

function cloneCalendar(calendar: Calendar): Calendar {
  return {
    year: calendar.year,
    rounds: Object.fromEntries(
      Object.entries(calendar.rounds).map(([key, days]) => [
        key,
        days.map(day => ({
          ...day,
          games: day.games.map(game => ({
            ...game,
            result: game.result ? {
              ...game.result,
              home: { ...game.result.home },
              away: { ...game.result.away },
            } : null,
          })),
        })),
      ]),
    ),
  }
}
