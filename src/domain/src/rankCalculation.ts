import { GameResultHelper, type CalendarDay, type GameResult } from './calendar'
import type { LeagueSetting } from './group'
import type { Rank, RankedTeam } from './rank'

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

function cloneRank(rank: Rank): Rank {
  return {
    serieADay: rank.serieADay,
    rounds: Object.fromEntries(
      Object.entries(rank.rounds).map(([key, teams]) => [key, teams.map(team => ({ ...team }))]),
    ),
  }
}
