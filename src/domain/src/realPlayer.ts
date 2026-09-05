import { Role } from './group'
import type { RealTeam } from './realTeam'

/** Canonical readable Serie A player document entry. */
export interface RealPlayer {
  name: string
  team: RealTeam
  role: Role
  isActive: boolean
  visible: boolean
}

/** Self-describing global player master-data document for one Fantasoccer season id. */
export interface RealPlayers {
  year: number
  players: RealPlayer[]
}

export interface RealPlayersReconciliation {
  value: RealPlayers
  addedKeys: string[]
  inactiveKeys: string[]
  reactivatedKeys: string[]
  transferredKeys: string[]
  playerCountChanged: boolean
}

/** Mirrors legacy KeyUtils.GetPlayerKey exactly: lowercase ASCII letters only. */
export function getPlayerKey(name?: string | null): string {
  if (!name) return ''
  return name.toLowerCase().replace(/[^a-z]/g, '')
}

/**
 * Mirrors the useful behavior of legacy AllPlayersAndAllTeamsJob without its unrelated side effects.
 * Fresh source players are authoritative; historical players missing from the source are appended as inactive.
 */
export function reconcileRealPlayers(
  existing: RealPlayers | null | undefined,
  currentPlayers: RealPlayer[],
  year: number,
): RealPlayersReconciliation {
  assertSeason(year)
  const existingPlayers = existing?.players ?? []
  if (existing && existing.year !== year) {
    throw new Error(`RealPlayers year mismatch: expected ${year}, found ${existing.year}`)
  }

  const existingByKey = indexUnique(existingPlayers, 'existing')
  const currentByKey = indexUnique(currentPlayers, 'current')
  const addedKeys: string[] = []
  const reactivatedKeys: string[] = []
  const transferredKeys: string[] = []

  const reconciled = currentPlayers.map(player => {
    const key = requirePlayerKey(player)
    const previous = existingByKey.get(key)
    if (!previous) {
      addedKeys.push(key)
    } else {
      if (!previous.isActive) reactivatedKeys.push(key)
      if (normalizeTeamName(previous.team.name) !== normalizeTeamName(player.team.name)) {
        transferredKeys.push(key)
      }
    }
    return clonePlayer({ ...player, isActive: true })
  })

  const inactiveKeys: string[] = []
  for (const previous of existingPlayers) {
    const key = requirePlayerKey(previous)
    if (currentByKey.has(key)) continue
    inactiveKeys.push(key)
    reconciled.push(clonePlayer({ ...previous, isActive: false }))
  }

  return {
    value: { year, players: reconciled },
    addedKeys,
    inactiveKeys,
    reactivatedKeys,
    transferredKeys,
    playerCountChanged: existingPlayers.length !== reconciled.length,
  }
}

export function cloneRealPlayer(player: RealPlayer): RealPlayer {
  return clonePlayer(player)
}

function indexUnique(players: RealPlayer[], label: string): Map<string, RealPlayer> {
  const result = new Map<string, RealPlayer>()
  for (const player of players) {
    const key = requirePlayerKey(player)
    if (result.has(key)) {
      throw new Error(`Duplicate ${label} player key '${key}' generated from '${player.name}'`)
    }
    result.set(key, player)
  }
  return result
}

function requirePlayerKey(player: RealPlayer): string {
  const key = getPlayerKey(player.name)
  if (!key) throw new Error(`Player '${player.name}' does not produce a valid legacy player key`)
  return key
}

function normalizeTeamName(name: string): string {
  return name.trim().toLocaleLowerCase('it-IT')
}

function clonePlayer(player: RealPlayer): RealPlayer {
  return {
    ...player,
    team: { ...player.team },
  }
}

function assertSeason(year: number): void {
  if (!Number.isInteger(year) || year < 1) throw new Error('Season id must be a positive integer')
}
