import type { LeagueSetting } from './group'
import { getPlayerKey } from './realPlayer'
import type { RealCalendar, RealDay } from './realCalendar'
import { FantaSoccerRole, PlayerInTeamStatus, type Team } from './team'

const LIVE_TAIL_MS = 4 * 60 * 60 * 1000

export type LiveFormationWindow = {
  serieADay: number
  day: RealDay
  deadline: string
}

export type LiveFormationValidation =
  | { valid: true; changedPlayers: number; nextFormationChanges: number }
  | { valid: false; error: string }

/** Backend 2.0.9 parity: first non-delayed kickoff through four hours after the last kickoff. */
export function getLiveFormationWindow(
  calendar: RealCalendar | null | undefined,
  settings: Pick<LeagueSetting, 'liveFormationChanges'>,
  now = new Date(),
): LiveFormationWindow | null {
  if (!calendar || (settings.liveFormationChanges ?? 0) <= 0) return null
  const nowMs = now.getTime()
  const candidates = calendar.days
    .map(day => ({ day, times: day.games
      .filter(game => !game.delayed && Boolean(game.date))
      .map(game => Date.parse(game.date!))
      .filter(Number.isFinite)
      .sort((a, b) => a - b) }))
    .filter(entry => entry.times.length > 0)
    .filter(entry => nowMs >= entry.times[0] && nowMs <= entry.times[entry.times.length - 1] + LIVE_TAIL_MS)
    .sort((a, b) => b.day.serieADay - a.day.serieADay)
  const current = candidates[0]
  if (!current) return null
  return {
    serieADay: current.day.serieADay,
    day: current.day,
    deadline: new Date(current.times[current.times.length - 1] + LIVE_TAIL_MS).toISOString(),
  }
}

/**
 * Validate a live update against the repository copy, never against client-owned metadata.
 * Mirrors the 2.0.9 backend rules: max changes, exactly one two-player position swap,
 * optional module lock and the day-scoped FormationChanges counter.
 */
export function validateLiveFormationChange(
  before: Team,
  after: Team,
  settings: Pick<LeagueSetting, 'liveFormationChanges' | 'allowLiveModuleChange'>,
): LiveFormationValidation {
  const limit = settings.liveFormationChanges ?? 0
  const used = before.formationChanges ?? 0
  const beforeByKey = new Map(before.players
    .filter(player => player.status === PlayerInTeamStatus.Active)
    .map(player => [getPlayerKey(player.name), player] as const))
  const changed = after.players
    .filter(player => player.status === PlayerInTeamStatus.Active)
    .map(player => ({ player, previous: beforeByKey.get(getPlayerKey(player.name)) }))
    .filter(entry => entry.previous && entry.previous.position !== entry.player.position)

  if (changed.length === 0) return { valid: true, changedPlayers: 0, nextFormationChanges: used }
  if (used >= limit) return { valid: false, error: 'Hai raggiunto il numero massimo di modifiche per questa giornata.' }
  if (changed.length !== 2) return { valid: false, error: 'Durante la giornata puoi invertire solo due giocatori.' }

  const oldPositions = changed.map(entry => entry.previous!.position).sort((a, b) => a - b)
  const newPositions = changed.map(entry => entry.player.position).sort((a, b) => a - b)
  if (oldPositions.some((position, index) => position !== newPositions[index])) {
    return { valid: false, error: 'La modifica deve essere uno scambio tra due giocatori.' }
  }

  if (!(settings.allowLiveModuleChange ?? false)) {
    const oldModule = moduleOf(before)
    const newModule = moduleOf(after)
    if (oldModule !== newModule) {
      return { valid: false, error: 'Il modulo non può essere modificato durante la giornata.' }
    }
  }

  return { valid: true, changedPlayers: changed.length, nextFormationChanges: used + 1 }
}

export function getLiveFormationChangesRemaining(team: Team | null | undefined, settings: Pick<LeagueSetting, 'liveFormationChanges'>): number {
  return Math.max(0, (settings.liveFormationChanges ?? 0) - (team?.formationChanges ?? 0))
}

function moduleOf(team: Team): string {
  const counts = new Map<FantaSoccerRole, number>()
  for (const player of team.players) {
    if (player.status !== PlayerInTeamStatus.Active) continue
    if (player.position < FantaSoccerRole.GoalKeeper || player.position > FantaSoccerRole.Forward) continue
    counts.set(player.position, (counts.get(player.position) ?? 0) + 1)
  }
  return [
    counts.get(FantaSoccerRole.GoalKeeper) ?? 0,
    counts.get(FantaSoccerRole.Defensor) ?? 0,
    counts.get(FantaSoccerRole.Midfielder) ?? 0,
    counts.get(FantaSoccerRole.Forward) ?? 0,
  ].join('-')
}
