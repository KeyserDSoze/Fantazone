import { Role } from './group'
import {
  FantaSoccerRole,
  PlayerInTeamStatus,
  type Player,
  type Team,
} from './team'

export type FormationPositionUpdate = {
  /** Deterministic non-persisted key, mirroring legacy KeyUtils.GetPlayerKey(Name). */
  playerKey: string
  position: FantaSoccerRole
}

export type FormationValidationResult =
  | { valid: true; errors: [] }
  | { valid: false; errors: string[] }

/** Legacy-compatible computed player identity. It deliberately remains derived, not stored in JSON. */
export function getPlayerKey(name?: string | null): string {
  return name?.toLowerCase().replace(/[^a-z]/g, '') ?? ''
}

/**
 * Apply only formation positions to a fresh persisted Team.
 * Prices, ownership, player status, revenue and all other fields always come
 * from the repository copy, never from an editable client payload.
 */
export function applyFormationPositions(team: Team, updates: readonly FormationPositionUpdate[]): Team {
  const byKey = new Map(updates.map(update => [normalizeKey(update.playerKey), update.position] as const))
  return {
    ...team,
    players: team.players.map(player => {
      if (player.status !== PlayerInTeamStatus.Active) return player
      const position = byKey.get(getPlayerKey(player.name))
      return position == null ? player : { ...player, position }
    }),
  }
}

/** Port of Fantasoccer.Business TeamChecker.Validate. */
export function validateFormation(team: Team): FormationValidationResult {
  const active = team.players.filter(player => player.status === PlayerInTeamStatus.Active)
  const byPosition = groupByPosition(active)
  const starters = active.filter(player => isStarterPosition(player.position))

  if (starters.length < 11) return invalid('Meno di 11 giocatori titolari schierati.')
  if (starters.length > 11) return invalid('Più di 11 giocatori titolari schierati.')

  for (const [position, players] of byPosition) {
    const roles = new Set(players.map(player => player.role))
    if (position !== FantaSoccerRole.Tribune && roles.size > 1) {
      return invalid('Giocatore fuori ruolo.')
    }

    const role = players[0]?.role ?? Role.Undefined
    const count = players.length
    switch (position) {
      case FantaSoccerRole.GoalKeeper:
      case FantaSoccerRole.BackupGoalKeeper:
        if (role !== Role.GoalKeeper) return invalid('Portiere errato.')
        if (count !== 1) {
          return invalid(`Portiere ${position === FantaSoccerRole.GoalKeeper ? 'titolare' : 'di riserva'} manacante o troppi.`)
        }
        break

      case FantaSoccerRole.Defensor:
      case FantaSoccerRole.FirstBackupDefensor:
      case FantaSoccerRole.SecondBackupDefensor:
        if (role !== Role.Defensor) return invalid('Giocatore schierato erroneamente come difensore.')
        if (position === FantaSoccerRole.Defensor && (count <= 2 || count > 5)) {
          return invalid(`Difensori titolari in numero sbagliato ${count}. Puoi mettere da un minimo di 3 ad un massimo di 5 difensori.`)
        }
        if (position !== FantaSoccerRole.Defensor && count !== 1) {
          return invalid(`${position === FantaSoccerRole.FirstBackupDefensor ? 'Primo difensore di riserva' : 'Secondo difensore di riserva'} manacante o troppi.`)
        }
        break

      case FantaSoccerRole.Midfielder:
      case FantaSoccerRole.FirstBackupMidfielder:
      case FantaSoccerRole.SecondBackupMidfielder:
        if (role !== Role.Midfielder) return invalid('Giocatore schierato erroneamente come centrocampista.')
        if (position === FantaSoccerRole.Midfielder && (count <= 2 || count > 5)) {
          return invalid(`Centrocampisti titolari in numero sbagliato ${count}. Puoi mettere da un minimo di 3 ad un massimo di 5 centrocampisti.`)
        }
        if (position !== FantaSoccerRole.Midfielder && count !== 1) {
          return invalid(`${position === FantaSoccerRole.FirstBackupMidfielder ? 'Primo centrocampista di riserva' : 'Secondo centrocampista di riserva'} manacante o troppi.`)
        }
        break

      case FantaSoccerRole.Forward:
      case FantaSoccerRole.FirstBackupForward:
      case FantaSoccerRole.SecondBackupForward:
        if (role !== Role.Forward) return invalid('Giocatore schierato erroneamente come attaccante.')
        if (position === FantaSoccerRole.Forward && (count < 1 || count > 3)) {
          return invalid(`Attaccanti titolari in numero sbagliato ${count}. Puoi mettere da un minimo di 1 ad un massimo di 3 attaccanti.`)
        }
        if (position !== FantaSoccerRole.Forward && count !== 1) {
          return invalid(`${position === FantaSoccerRole.FirstBackupForward ? 'Primo attaccante di riserva' : 'Secondo attaccante di riserva'} manacante o troppi.`)
        }
        break

      case FantaSoccerRole.Tribune:
        if (count !== 7) return invalid('Devono esserci sette giocatori in tribuna.')
        break

      case FantaSoccerRole.All:
      case FantaSoccerRole.Invasion:
      default:
        return invalid('Giocatore in ruolo errato.')
    }
  }

  return { valid: true, errors: [] }
}

export function isStarterPosition(position: FantaSoccerRole): boolean {
  return position >= FantaSoccerRole.GoalKeeper && position <= FantaSoccerRole.Forward
}

function groupByPosition(players: Player[]): Map<FantaSoccerRole, Player[]> {
  const values = new Map<FantaSoccerRole, Player[]>()
  for (const player of players) {
    const current = values.get(player.position) ?? []
    current.push(player)
    values.set(player.position, current)
  }
  return values
}

function invalid(message: string): FormationValidationResult {
  return { valid: false, errors: [message] }
}

function normalizeKey(key: string): string {
  return key.trim().toLowerCase()
}
