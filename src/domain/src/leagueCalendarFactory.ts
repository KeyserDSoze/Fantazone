import type { Calendar, CalendarDay, CalendarGame, GameResult } from './calendar'
import { LeagueType, type AnnualTeam, type LeagueSetting } from './group'

export type CreateInitialLeagueCalendarInput = {
  year: number
  leagueType: LeagueType
  settings: LeagueSetting
  teams: readonly AnnualTeam[]
  /** Stable seed used instead of crypto randomness so retries rebuild the same schedule. */
  seed?: string
}

/**
 * Deterministic replacement for legacy ILeagueCalculator.GetRandomCalendar.
 *
 * The legacy backend randomized on every invocation. In a GitHub/Action workflow a
 * retry must be idempotent, so Fantazone derives the shuffle from stable inputs.
 */
export function createInitialLeagueCalendar(input: CreateInitialLeagueCalendarInput): Calendar {
  assertInput(input)
  const seed = input.seed?.trim() || defaultSeed(input)
  const teams = deterministicShuffle(input.teams.map(cloneAnnualTeam), `${seed}|teams`)

  switch (input.leagueType) {
    case LeagueType.Cup:
      return createClassicCup(input.year, input.settings, teams, seed)
    case LeagueType.NewCup:
      return createNewCup(input.year, input.settings, teams, seed)
    case LeagueType.League:
    case LeagueType.SuperLeague:
    case LeagueType.FutsalLeague:
      return createRoundRobinLeague(input.year, input.settings, teams, seed)
    default:
      throw new Error('Il tipo di lega non supporta la creazione del calendario.')
  }
}

function createRoundRobinLeague(year: number, settings: LeagueSetting, teams: AnnualTeam[], seed: string): Calendar {
  const base = circleSchedule(deterministicShuffle(teams, `${seed}|round-robin`))
  const baseDays = Math.max(0, ...base.map(game => game.day))
  if (baseDays < 1) throw new Error('Non è possibile generare un calendario senza giornate.')
  const cycles = Math.floor((38 - settings.delayedDay) / baseDays)
  if (cycles < 1) throw new Error('Le impostazioni di ritardo non lasciano spazio ad alcuna giornata di campionato.')

  const days: CalendarDay[] = []
  let actualDay = 1
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    for (let baseDay = 1; baseDay <= baseDays; baseDay += 1) {
      const pairings = base.filter(game => game.day === baseDay)
      days.push(createDay(year, '@', actualDay, settings, pairings, cycle % 2 === 1, seed))
      actualDay += 1
    }
  }
  return { year, rounds: { '@': days } }
}

function createClassicCup(year: number, settings: LeagueSetting, teams: AnnualTeam[], seed: string): Calendar {
  if (teams.length !== 16) throw new Error('La Coppa classica richiede esattamente 16 squadre.')
  const rounds: Calendar['rounds'] = {}
  for (let groupIndex = 0; groupIndex < 4; groupIndex += 1) {
    const key = String.fromCharCode(65 + groupIndex)
    const group = deterministicShuffle(teams.slice(groupIndex * 4, groupIndex * 4 + 4), `${seed}|cup|${key}`)
    const base = circleSchedule(group)
    const baseDays = 3
    const cycles = 4 // Legacy ClassicCup fills twelve group-stage fantasy days.
    const days: CalendarDay[] = []
    let actualDay = 1
    for (let cycle = 0; cycle < cycles; cycle += 1) {
      for (let baseDay = 1; baseDay <= baseDays; baseDay += 1) {
        const pairings = base.filter(game => game.day === baseDay)
        days.push(createDay(year, key, actualDay, settings, pairings, cycle % 2 === 1, seed))
        actualDay += 1
      }
    }
    rounds[key] = days
  }
  return { year, rounds }
}

function createNewCup(year: number, settings: LeagueSetting, teams: AnnualTeam[], seed: string): Calendar {
  if (teams.length < 16) throw new Error('La NewCup richiede almeno 16 squadre per alimentare Champions ed Europa League.')
  const scheduled = deterministicShuffle(teams, `${seed}|new-cup`)
  const base = circleSchedule(scheduled)
  const baseDays = Math.max(...base.map(game => game.day))
  const days: CalendarDay[] = []
  for (let day = 1; day <= baseDays; day += 1) {
    days.push(createDay(year, '@', day, settings, base.filter(game => game.day === day), false, seed))
  }
  return { year, rounds: { '@': days } }
}

type ScheduledPair = { day: number; a: AnnualTeam; b: AnnualTeam }

/** Circle-method round robin. A bye is represented internally and omitted from games. */
function circleSchedule(input: AnnualTeam[]): ScheduledPair[] {
  if (input.length < 2) return []
  const teams: Array<AnnualTeam | null> = [...input]
  if (teams.length % 2 === 1) teams.push(null)
  const count = teams.length
  const days = count - 1
  const matchesPerDay = count / 2
  const result: ScheduledPair[] = []

  for (let day = 1; day <= days; day += 1) {
    for (let index = 0; index < matchesPerDay; index += 1) {
      const left = teams[index]
      const right = teams[count - 1 - index]
      if (!left || !right) continue
      result.push(day % 2 === 0
        ? { day, a: left, b: right }
        : { day, a: right, b: left })
    }
    const last = teams.pop()!
    teams.splice(1, 0, last)
  }
  return result
}

function createDay(
  year: number,
  roundKey: string,
  actualDay: number,
  settings: LeagueSetting,
  pairings: ScheduledPair[],
  reverse: boolean,
  seed: string,
): CalendarDay {
  const serieADay = actualDay + settings.delayedDay
  if (serieADay > 38) throw new Error(`Il calendario eccede la 38ª giornata di Serie A (${serieADay}).`)
  const cancelled = actualDay <= settings.cancelledDay
  return {
    number: actualDay,
    serieADay,
    games: pairings.map((pair, index) => {
      const home = reverse ? pair.b : pair.a
      const away = reverse ? pair.a : pair.b
      return createGame(year, roundKey, actualDay, index + 1, home, away, cancelled, seed)
    }),
  }
}

function createGame(
  year: number,
  roundKey: string,
  day: number,
  number: number,
  home: AnnualTeam,
  away: AnnualTeam,
  cancelled: boolean,
  seed: string,
): CalendarGame {
  const idSeed = `${seed}|${year}|${roundKey}|${day}|${number}|${normalize(home.owner)}|${normalize(away.owner)}`
  return {
    id: `initial:${year}:${encodeURIComponent(roundKey)}:${day}:${number}:${stableHash(idSeed).toString(36)}`,
    number,
    home: home.name,
    homeOwner: home.owner,
    away: away.name,
    awayOwner: away.owner,
    result: cancelled ? cancelledResult() : null,
  }
}

function cancelledResult(): GameResult {
  return {
    home: { value: 0, defensiveBonus: false, goodPeople: false, ownGoal: false },
    away: { value: 0, defensiveBonus: false, goodPeople: false, ownGoal: false },
    isCancelled: true,
    homeGoals: 0,
    awayGoals: 0,
  }
}

function assertInput(input: CreateInitialLeagueCalendarInput): void {
  if (!Number.isInteger(input.year) || input.year < 1) throw new Error('Stagione non valida.')
  if (input.teams.length < 2) throw new Error('Servono almeno due squadre per creare un calendario.')
  if (!Number.isInteger(input.settings.delayedDay) || input.settings.delayedDay < 0 || input.settings.delayedDay > 37) {
    throw new Error('Giornate di ritardo non valide.')
  }
  if (!Number.isInteger(input.settings.cancelledDay) || input.settings.cancelledDay < 0 || input.settings.cancelledDay > 38) {
    throw new Error('Giornate annullate non valide.')
  }
  const identities = new Set<string>()
  for (const team of input.teams) {
    if (!team.name.trim() || !team.owner.trim()) throw new Error('Ogni squadra deve avere nome e owner.')
    const owner = normalize(team.owner)
    if (identities.has(owner)) throw new Error(`Owner duplicato nel calendario: ${team.owner}`)
    identities.add(owner)
  }
}

function deterministicShuffle<T>(values: readonly T[], seed: string): T[] {
  const result = [...values]
  const random = seededRandom(seed)
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1))
    ;[result[index], result[target]] = [result[target], result[index]]
  }
  return result
}

function seededRandom(seed: string): () => number {
  let state = stableHash(seed) || 0x9e3779b9
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function stableHash(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function defaultSeed(input: CreateInitialLeagueCalendarInput): string {
  return `${input.year}|${input.leagueType}|${input.teams.map(team => normalize(team.owner)).sort().join('|')}`
}

function cloneAnnualTeam(team: AnnualTeam): AnnualTeam {
  return { ...team, additionalOwners: [...team.additionalOwners] }
}

function normalize(value: string): string { return value.trim().toLowerCase() }
