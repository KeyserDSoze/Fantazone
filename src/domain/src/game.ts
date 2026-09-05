import { GameResultHelper, type CalendarGame } from './calendar'
import type { FantaSoccerRole, Player } from './team'

export type GameSide = 'home' | 'away'
export type GameTeamSource = 'day' | 'season' | 'missing'
export type GameEditabilitySource = 'serie-a-context' | 'legacy-fallback'

/**
 * Base player view for a fantasy game. Votes/chances/real-match enrichment will
 * be added here when those repositories migrate; the persisted Player remains untouched.
 */
export interface GamePlayer {
  current: Player
  currentPosition: FantaSoccerRole
}

/** Ephemeral team projection composed from TeamDay/Team documents. Never persisted. */
export interface GameTeam {
  side: GameSide
  name: string
  owner: string
  additionalOwners: string[]
  players: GamePlayer[]
  lastUpdate: string | null
  source: GameTeamSource
}

/**
 * Replacement for the old backend GameWrapper response. This is a local read
 * model built from canonical documents and is intentionally not a JSON storage contract.
 */
export interface GameWrapper {
  leagueId: string
  season: number
  fantasyDay: number
  serieADay: number
  game: CalendarGame
  teams: GameTeam[]
  canEdit: boolean
  nextSerieADay: number
  editabilitySource: GameEditabilitySource
  /** Locked game with no canonical result: later TeamCalculator migration must calculate it. */
  requiresScoreCalculation: boolean
}

export class GameWrapperHelper {
  static getTeam(wrapper: GameWrapper, side: GameSide): GameTeam | null {
    return wrapper.teams.find(team => team.side === side) ?? null
  }

  static getHomeTeam(wrapper: GameWrapper): GameTeam | null {
    return this.getTeam(wrapper, 'home')
  }

  static getAwayTeam(wrapper: GameWrapper): GameTeam | null {
    return this.getTeam(wrapper, 'away')
  }

  static isOwner(wrapper: GameWrapper, email: string): boolean {
    const target = normalizeEmail(email)
    if (!target) return false
    return wrapper.teams.some(team =>
      [team.owner, ...team.additionalOwners].some(owner => normalizeEmail(owner) === target),
    )
  }

  static canUserEdit(wrapper: GameWrapper, email: string, asAdmin = false): boolean {
    return wrapper.canEdit && (asAdmin || this.isOwner(wrapper, email))
  }

  static hasStoredResult(wrapper: GameWrapper): boolean {
    return GameResultHelper.hasValue(wrapper.game.result)
  }
}

function normalizeEmail(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? ''
}
