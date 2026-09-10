import { getEvolutionLockedPlayerKeys, resolveFantazoneEvolutionSettings } from './evolution'
import { Role, type LeagueSetting } from './group'
import { getPlayerKey } from './realPlayer'
import type { RealCalendar, RealDay } from './realCalendar'
import { FantaSoccerRole, PlayerInTeamStatus, type Team } from './team'

const LIVE_TAIL_MS = 4 * 60 * 60 * 1000

type LiveWindowSettings = Pick<LeagueSetting, 'liveFormationChanges'> & Partial<Pick<LeagueSetting, 'evolution'>>
type LiveValidationSettings = Pick<LeagueSetting, 'liveFormationChanges' | 'allowLiveModuleChange'> & Partial<Pick<LeagueSetting, 'evolution'>>

export type LiveFormationWindow = {
  serieADay: number
  day: RealDay
  deadline: string
  progressiveLineupLock: boolean
  limitedChanges: boolean
}

export type LiveFormationValidation =
  | { valid: true; changedPlayers: number; nextFormationChanges: number }
  | { valid: false; error: string }

export type LiveFormationValidationContext = {
  realDay?: RealDay | null
  now?: Date
}

/**
 * A live formation window exists either for the legacy N-change rule or for
 * Evolution progressive locking. The two switches are deliberately independent.
 */
export function getLiveFormationWindow(
  calendar: RealCalendar | null | undefined,
  settings: LiveWindowSettings,
  now = new Date(),
): LiveFormationWindow | null {
  if (!calendar) return null
  const evolution = resolveFantazoneEvolutionSettings(settings as LeagueSetting)
  const limitedChanges = (settings.liveFormationChanges ?? 0) > 0
  const progressiveLineupLock = evolution.enabled && evolution.progressiveLineupLock.enabled
  if (!limitedChanges && !progressiveLineupLock) return null

  const nowMs = now.getTime()
  const candidates = calendar.days
    .map(day => ({
      day,
      times: day.games
        .filter(game => !game.delayed && Boolean(game.date))
        .map(game => Date.parse(game.date!))
        .filter(Number.isFinite)
        .sort((a, b) => a - b),
    }))
    .filter(entry => entry.times.length > 0)
    .filter(entry => nowMs >= entry.times[0] && nowMs <= entry.times[entry.times.length - 1] + LIVE_TAIL_MS)
    .sort((a, b) => b.day.serieADay - a.day.serieADay)
  const current = candidates[0]
  if (!current) return null
  return {
    serieADay: current.day.serieADay,
    day: current.day,
    deadline: new Date(current.times[current.times.length - 1] + LIVE_TAIL_MS).toISOString(),
    progressiveLineupLock,
    limitedChanges,
  }
}

/**
 * Validates a live update against the repository copy, never client metadata.
 * Legacy limited changes and Evolution progressive locks can be enabled together
 * or independently.
 */
export function validateLiveFormationChange(
  before: Team,
  after: Team,
  settings: LiveValidationSettings,
  context: LiveFormationValidationContext = {},
): LiveFormationValidation {
  const limit = settings.liveFormationChanges ?? 0
  const used = before.formationChanges ?? 0
  const evolution = resolveFantazoneEvolutionSettings(settings as LeagueSetting)
  const progressive = evolution.enabled && evolution.progressiveLineupLock.enabled
  const beforeByKey = new Map(before.players
    .filter(player => player.status === PlayerInTeamStatus.Active)
    .map(player => [getPlayerKey(player.name), player] as const))
  const changed = after.players
    .filter(player => player.status === PlayerInTeamStatus.Active)
    .map(player => ({ player, key: getPlayerKey(player.name), previous: beforeByKey.get(getPlayerKey(player.name)) }))
    .filter(entry => entry.previous && entry.previous.position !== entry.player.position)

  if (changed.length === 0) return { valid: true, changedPlayers: 0, nextFormationChanges: used }

  if (progressive) {
    if (!context.realDay) {
      return { valid: false, error: 'Il calendario reale della giornata è necessario per verificare il lock progressivo.' }
    }
    const locked = getEvolutionLockedPlayerKeys(
      before.players,
      context.realDay,
      settings as LeagueSetting,
      context.now ?? new Date(),
    )
    const lockedChange = changed.find(entry => locked.has(entry.key))
    if (lockedChange) {
      return {
        valid: false,
        error: `${lockedChange.player.name} non può più essere spostato: la sua partita di Serie A è già iniziata.`,
      }
    }
  }

  if (limit > 0) {
    if (used >= limit) return { valid: false, error: 'Hai raggiunto il numero massimo di modifiche per questa giornata.' }
    if (changed.length !== 2) return { valid: false, error: 'Durante la giornata puoi invertire solo due giocatori per ogni modifica.' }

    const oldPositions = changed.map(entry => entry.previous!.position).sort((a, b) => a - b)
    const newPositions = changed.map(entry => entry.player.position).sort((a, b) => a - b)
    if (oldPositions.some((position, index) => position !== newPositions[index])) {
      return { valid: false, error: 'La modifica deve essere uno scambio tra due giocatori.' }
    }
  } else if (!progressive) {
    return { valid: false, error: 'Le modifiche durante la giornata non sono abilitate per questa lega.' }
  }

  if (!(settings.allowLiveModuleChange ?? false)) {
    const oldModule = moduleOf(before)
    const newModule = moduleOf(after)
    if (oldModule !== newModule) {
      return { valid: false, error: 'Il modulo non può essere modificato durante la giornata.' }
    }
  }

  return {
    valid: true,
    changedPlayers: changed.length,
    nextFormationChanges: limit > 0 ? used + 1 : used,
  }
}

export function getLiveFormationChangesRemaining(team: Team | null | undefined, settings: Pick<LeagueSetting, 'liveFormationChanges'>): number {
  return Math.max(0, (settings.liveFormationChanges ?? 0) - (team?.formationChanges ?? 0))
}

function moduleOf(team: Team): string {
  const counts = new Map<Role, number>()
  for (const player of team.players) {
    if (player.status !== PlayerInTeamStatus.Active) continue
    if (player.position < FantaSoccerRole.GoalKeeper || player.position > FantaSoccerRole.Forward) continue
    counts.set(player.role, (counts.get(player.role) ?? 0) + 1)
  }
  return [
    counts.get(Role.GoalKeeper) ?? 0,
    counts.get(Role.Defensor) ?? 0,
    counts.get(Role.Midfielder) ?? 0,
    counts.get(Role.Forward) ?? 0,
  ].join('-')
}
