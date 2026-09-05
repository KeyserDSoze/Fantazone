import { GameResultHelper, type Calendar, type CalendarDay, type GameResult } from './calendar'
import type { LeagueSetting } from './group'
import { DefaultRankedTeam, type Rank, type RankedTeam } from './rank'

export type LiveRounds = Record<string, CalendarDay>

/** Mirrors legacy LiveJob.CanCalculateRank guard. */
export function canApplyLiveRoundsToRank(rank: Rank, rounds: LiveRounds): boolean {
  return Object.entries(rounds).every(([roundKey, day]) => {
    const teams = rank.rounds[roundKey]
    if (!teams || !day.games) return false
    return day.games
      .filter(game => game.result?.isCancelled !== true)
      .every(game =>
        teams.some(team => team.owner === game.homeOwner) &&
        teams.some(team => team.owner === game.awayOwner),
      )
  })
}

/**
 * Pure RankCalculator.AddDay projection used by live read models.
 * The persisted rank is cloned and never mutated.
 */
export function applyLiveRoundsToRank(rank: Rank, rounds: LiveRounds, settings: LeagueSetting): Rank {
  const projected = cloneRank(rank)
  if (!canApplyLiveRoundsToRank(projected, rounds)) return projected

  for (const [roundKey, day] of Object.entries(rounds)) {
    const teams = projected.rounds[roundKey]
    if (!teams) continue
    for (const game of day.games) {
      const home = teams.find(team => team.owner === game.homeOwner)
      const away = teams.find(team => team.owner === game.awayOwner)
      if (!home || !away) continue
      applyGameToRankedTeam(home, true, game.result, settings)
      applyGameToRankedTeam(away, false, game.result, settings)
    }
  }
  return projected
}

/**
 * Pure port of DefaultLeague.GetRank.
 * Used for canonical season/daily ranks after definitive Calendar results are persisted.
 */
export function calculateRankFromCalendar(
  calendar: Calendar,
  settings: LeagueSetting,
  excludedRounds: ReadonlySet<string> | readonly string[] = [],
): Rank {
  const excluded = excludedRounds instanceof Set ? excludedRounds : new Set(excludedRounds)
  const rank: Rank = { serieADay: 0, rounds: {} }

  for (const [roundKey, days] of Object.entries(calendar.rounds)) {
    if (excluded.has(roundKey) || days.length === 0) continue
    const teams = createRoundTeams(days)
    rank.rounds[roundKey] = teams

    for (const day of days) {
      for (const game of day.games) {
        const home = teams.find(team => team.owner === game.homeOwner)
        const away = teams.find(team => team.owner === game.awayOwner)
        if (!home || !away) {
          throw new Error(`Rank round '${roundKey}' cannot resolve game owners '${game.homeOwner}'/'${game.awayOwner}'`)
        }
        const homeApplied = applyGameToRankedTeam(home, true, game.result, settings)
        const awayApplied = applyGameToRankedTeam(away, false, game.result, settings)
        if ((homeApplied || awayApplied) && rank.serieADay < day.serieADay) rank.serieADay = day.serieADay
      }
    }

    rank.rounds[roundKey] = [...teams].sort((a, b) =>
      b.point - a.point || b.valuePoint - a.valuePoint,
    )
  }
  return rank
}

export function applyGameToRankedTeam(
  team: RankedTeam,
  isHome: boolean,
  result: GameResult | null | undefined,
  settings: LeagueSetting,
): boolean {
  if (result?.isCancelled === true) return true
  if (!result || !GameResultHelper.hasValue(result)) return false

  const pointTeam = isHome ? result.home.value : result.away.value
  const pointOpponent = isHome ? result.away.value : result.home.value
  const goalTeam = isHome ? result.homeGoals : result.awayGoals
  const goalOpponent = isHome ? result.awayGoals : result.homeGoals

  team.goal += goalTeam
  team.sufferedGoal += goalOpponent
  team.valuePoint += pointTeam
  team.sufferedValuePoint += pointOpponent

  if (goalTeam > goalOpponent) {
    team.victories += 1
    team.point += settings.rankWithValuePoints ? pointTeam + settings.pointForVictory : settings.pointForVictory
  } else if (goalOpponent > goalTeam) {
    team.defeats += 1
    team.point += settings.rankWithValuePoints ? pointTeam + settings.pointForDefeat : settings.pointForDefeat
  } else {
    team.draws += 1
    team.point += settings.rankWithValuePoints ? pointTeam + settings.pointForDraw : settings.pointForDraw
  }

  team.plusMoney += settings.moneyForGoal * goalTeam
  team.plusMoney += settings.moneyForSufferedGoal * goalOpponent
  return true
}

function createRoundTeams(days: CalendarDay[]): RankedTeam[] {
  const firstDay = days[0]
  const teams = new Map<string, RankedTeam>()
  for (const game of firstDay.games) {
    add(game.homeOwner, game.home)
    add(game.awayOwner, game.away)
  }
  return [...teams.values()]

  function add(owner: string, name: string): void {
    if (!owner?.trim()) throw new Error('Rank team owner is required')
    if (!teams.has(owner)) teams.set(owner, { ...DefaultRankedTeam, owner, name })
  }
}

function cloneRank(rank: Rank): Rank {
  return {
    serieADay: rank.serieADay,
    rounds: Object.fromEntries(
      Object.entries(rank.rounds).map(([key, teams]) => [key, teams.map(team => ({ ...team }))]),
    ),
  }
}
