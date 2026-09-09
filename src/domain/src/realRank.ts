import type { RealCalendar } from './realCalendar'

export interface RealRankedTeam {
  name: string
  points: number
  victories: number
  draws: number
  defeats: number
  goalsFor: number
  goalsAgainst: number
  played: number
  goalDifference: number
}

export interface RealRank {
  teams: RealRankedTeam[]
}

/**
 * Pure Serie A standings projection derived from the canonical RealCalendar.
 *
 * This intentionally replaces the legacy persisted RealRank cache: every team is
 * seeded from the calendar, only started/non-delayed games with a complete score
 * contribute, and live scores are reflected immediately when the provider exposes
 * them. Sorting mirrors the legacy backend order.
 */
export function buildRealRank(calendar: RealCalendar, now = new Date()): RealRank {
  const nowMs = now.getTime()
  if (!Number.isFinite(nowMs)) throw new Error('Invalid current time for Serie A standings')

  const teams = new Map<string, RealRankedTeam>()

  for (const day of calendar.days) {
    for (const game of day.games) {
      const home = teamEntry(teams, game.home.name)
      const away = teamEntry(teams, game.away.name)
      if (!home || !away) continue

      const kickoff = game.date ? Date.parse(game.date) : Number.NaN
      if (
        game.delayed ||
        !Number.isFinite(kickoff) ||
        kickoff > nowMs ||
        game.homeGoals == null ||
        game.awayGoals == null
      ) continue

      const homeGoals = game.homeGoals
      const awayGoals = game.awayGoals
      home.played += 1
      away.played += 1
      home.goalsFor += homeGoals
      home.goalsAgainst += awayGoals
      away.goalsFor += awayGoals
      away.goalsAgainst += homeGoals

      if (homeGoals > awayGoals) {
        home.victories += 1
        away.defeats += 1
        home.points += 3
      } else if (homeGoals < awayGoals) {
        away.victories += 1
        home.defeats += 1
        away.points += 3
      } else {
        home.draws += 1
        away.draws += 1
        home.points += 1
        away.points += 1
      }
    }
  }

  const ranked = [...teams.values()]
    .map(team => ({ ...team, goalDifference: team.goalsFor - team.goalsAgainst }))
    .sort((a, b) =>
      b.points - a.points ||
      b.goalDifference - a.goalDifference ||
      b.goalsFor - a.goalsFor ||
      a.goalsAgainst - b.goalsAgainst ||
      a.name.localeCompare(b.name, 'it', { sensitivity: 'base' }),
    )

  return { teams: ranked }
}

function teamEntry(teams: Map<string, RealRankedTeam>, rawName: string): RealRankedTeam | null {
  const name = rawName.trim()
  if (!name) return null
  const key = name.toLocaleLowerCase('it-IT')
  const existing = teams.get(key)
  if (existing) return existing

  const created: RealRankedTeam = {
    name,
    points: 0,
    victories: 0,
    draws: 0,
    defeats: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    played: 0,
    goalDifference: 0,
  }
  teams.set(key, created)
  return created
}
