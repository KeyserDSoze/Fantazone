import { type LeagueSetting, Role } from './group'
import type { Rank } from './rank'
import { getPlayerKey, type RealPlayer, type RealPlayers } from './realPlayer'

export enum PlayerInTeamStatus {
  Active = 0,
  SoldForOneHalf = 1,
  SoldWithNoReturnedPrice = 2,
  Sold = 3,
  Removed = 4,
}

export enum FantaSoccerRole {
  All = -2,
  Invasion = -1,
  GoalKeeper = 0,
  Defensor = 1,
  Midfielder = 2,
  Forward = 3,
  BackupGoalKeeper = 4,
  FirstBackupDefensor = 5,
  SecondBackupDefensor = 6,
  FirstBackupMidfielder = 7,
  SecondBackupMidfielder = 8,
  FirstBackupForward = 9,
  SecondBackupForward = 10,
  Tribune = 11,
}

/** Hydrated player used by domain reducers and immutable TeamDay snapshots. */
export interface Player extends RealPlayer {
  price: number
  revenue: number
  status: PlayerInTeamStatus
  position: FantaSoccerRole
}

/** The only player data persisted in a mutable season Team. */
export interface SeasonTeamPlayerReference {
  playerKey: string
  price: number
  revenue: number
  status: PlayerInTeamStatus
  position: FantaSoccerRole
}

/** Schema v3 for mutable season Team documents. TeamDay deliberately does not use it. */
export interface SeasonTeamDocument {
  version: 3
  name: string
  owner: string
  additionalOwners: string[]
  players: SeasonTeamPlayerReference[]
  moneyFromRank: number
  lastUpdate: string | null
}

export interface TeamKey {
  group: string
  year: number
  basketId: string
  email: string
}

export interface TeamDayKey extends TeamKey {
  day: number
}

/**
 * Hydrated Team used in memory. Mutable season Team JSON is encoded through
 * `encodeSeasonTeamDocument`; immutable TeamDay JSON keeps this full snapshot.
 */
export interface Team {
  name: string
  owner: string
  additionalOwners: string[]
  players: Player[]
  moneyFromRank: number
  /** ISO-8601 timestamp. */
  lastUpdate: string | null
}

export interface EnhancedTeam extends Team {
  totalPlayers: number
  activePlayers: Player[]
  totalCost: number
  revenueMoney: number
  moneyFromSoldWithNoReturnedPrice: number
  moneyFromSoldWithOneHalfReturnedPrice: number
  cost: number
  netCost: number
}

export const PlayerStatusHelper = {
  isActive: (status: PlayerInTeamStatus): boolean => status === PlayerInTeamStatus.Active,
  asLabel: (status: PlayerInTeamStatus): string => {
    switch (status) {
      case PlayerInTeamStatus.Active: return 'Attivo'
      case PlayerInTeamStatus.SoldForOneHalf: return 'Venduto metà prezzo'
      case PlayerInTeamStatus.SoldWithNoReturnedPrice: return 'Venduto senza ritorno'
      case PlayerInTeamStatus.Sold: return 'Venduto'
      case PlayerInTeamStatus.Removed: return 'Rimosso'
      default: return 'Sconosciuto'
    }
  },
}

export const FantaSoccerRoleHelper = {
  toMainRole: (role: FantaSoccerRole): Role => {
    switch (role) {
      case FantaSoccerRole.GoalKeeper:
      case FantaSoccerRole.BackupGoalKeeper:
        return Role.GoalKeeper
      case FantaSoccerRole.Defensor:
      case FantaSoccerRole.FirstBackupDefensor:
      case FantaSoccerRole.SecondBackupDefensor:
        return Role.Defensor
      case FantaSoccerRole.Midfielder:
      case FantaSoccerRole.FirstBackupMidfielder:
      case FantaSoccerRole.SecondBackupMidfielder:
        return Role.Midfielder
      case FantaSoccerRole.Forward:
      case FantaSoccerRole.FirstBackupForward:
      case FantaSoccerRole.SecondBackupForward:
        return Role.Forward
      default:
        return Role.Undefined
    }
  },
}

export class TeamKeyHelper {
  static create(group: string, year: number, basketId: string, email: string): TeamKey {
    return { group, year, basketId, email }
  }

  static createDayKey(group: string, year: number, basketId: string, day: number, email: string): TeamDayKey {
    return { group, year, basketId, day, email }
  }

  static toString(key: TeamKey): string {
    return `${key.group}-${key.year}-${key.basketId}-${key.email}`
  }

  static toDayString(key: TeamDayKey): string {
    return `${key.group}-${key.year}-${key.basketId}-${key.day}-${key.email}`
  }
}

export class PlayerHelper {
  static filterActive(players: Player[]): Player[] {
    return players.filter(player => PlayerStatusHelper.isActive(player.status))
  }

  static filterByMainRole(players: Player[], role: Role): Player[] {
    return players.filter(player => FantaSoccerRoleHelper.toMainRole(player.position) === role)
  }

  static sortByPriceDesc(players: Player[]): Player[] {
    return [...players].sort((a, b) => b.price - a.price)
  }
}

export class TeamHelper {
  static getActivePlayers(team: Team): Player[] {
    return PlayerHelper.filterActive(team.players)
  }

  static getPlayersByRole(team: Team, role: Role): Player[] {
    return PlayerHelper.filterByMainRole(team.players, role)
  }

  static getTotalCostForPlayers(team: Team): number {
    return team.players.reduce((sum, player) => sum + (player.price ?? 0), 0)
  }

  static getTotalCost(team: Team): number {
    return TeamHelper.getTotalCostForPlayers(team)
  }

  static getRevenueMoney(team: Team): number {
    return team.players
      .filter(player => player.status === PlayerInTeamStatus.Sold)
      .reduce((sum, player) => sum + ((player.revenue ?? 0) - player.price), 0)
  }

  static getMoneyFromSoldWithNoReturnedPrice(team: Team): number {
    return team.players
      .filter(player => player.status === PlayerInTeamStatus.SoldWithNoReturnedPrice)
      .reduce((sum, player) => sum + player.price, 0)
  }

  static getMoneyFromSoldWithOneHalfReturnedPrice(team: Team): number {
    return team.players
      .filter(player => player.status === PlayerInTeamStatus.SoldForOneHalf)
      .reduce((sum, player) => sum + Math.floor(player.price / 2), 0)
  }

  static getCost(team: Team): number {
    return TeamHelper.getTotalCostForPlayers(team)
      - TeamHelper.getRevenueMoney(team)
      - team.moneyFromRank
      - TeamHelper.getMoneyFromSoldWithOneHalfReturnedPrice(team)
  }

  static getNetCost(team: Team): number {
    return TeamHelper.getCost(team)
  }

  static getLastUpdateDate(team: Team): Date | null {
    return team.lastUpdate ? new Date(team.lastUpdate) : null
  }

  static calculateMoneyFromRank(team: Team, rank: Rank | null | undefined, settings?: LeagueSetting): number {
    if (!settings || !rank || (settings.moneyForGoal === 0 && settings.moneyForSufferedGoal === 0)) return 0
    for (const roundTeams of Object.values(rank.rounds)) {
      const ranked = roundTeams.find(item => item.owner === team.owner)
      if (ranked) return ranked.goal * settings.moneyForGoal + ranked.sufferedGoal * settings.moneyForSufferedGoal
    }
    return 0
  }

  static enhance(team: Team): EnhancedTeam {
    const totalCost = TeamHelper.getTotalCostForPlayers(team)
    const revenueMoney = TeamHelper.getRevenueMoney(team)
    const moneyNoReturn = TeamHelper.getMoneyFromSoldWithNoReturnedPrice(team)
    const moneyHalfReturn = TeamHelper.getMoneyFromSoldWithOneHalfReturnedPrice(team)
    const cost = TeamHelper.getCost(team)
    return {
      ...team,
      totalPlayers: team.players.length,
      activePlayers: TeamHelper.getActivePlayers(team),
      totalCost,
      revenueMoney,
      moneyFromSoldWithNoReturnedPrice: moneyNoReturn,
      moneyFromSoldWithOneHalfReturnedPrice: moneyHalfReturn,
      cost,
      netCost: cost,
    }
  }
}

/** Strip duplicated Serie A master fields before persisting the mutable season Team. */
export function encodeSeasonTeamDocument(team: Team): SeasonTeamDocument {
  return {
    version: 3,
    name: team.name,
    owner: team.owner,
    additionalOwners: [...team.additionalOwners],
    players: team.players.map(player => ({
      playerKey: requirePlayerKey(player.name),
      price: player.price,
      revenue: player.revenue,
      status: player.status,
      position: player.position,
    })),
    moneyFromRank: team.moneyFromRank,
    lastUpdate: team.lastUpdate,
  }
}

/**
 * Hydrate either a normalized v3 season Team or a legacy full Team document.
 * Legacy support lets existing group repositories migrate lazily on their next write.
 */
export function hydrateSeasonTeamDocument(value: unknown, master?: RealPlayers | null): Team {
  if (!value || typeof value !== 'object') throw new Error('Invalid season Team document')
  const document = value as Partial<SeasonTeamDocument> & Partial<Team>
  if (!Array.isArray(document.players)) throw new Error('Invalid season Team players')
  const base = decodeTeamBase(document)

  if (document.version !== 3) {
    return { ...base, players: document.players.map((player, index) => cloneLegacyPlayer(player, index)) }
  }
  if (!master) throw new Error('Serie A player master is required to hydrate a normalized season Team')

  const masterByKey = new Map(master.players.map(player => [requirePlayerKey(player.name), player] as const))
  return {
    ...base,
    players: document.players.map((raw, index) => {
      const reference = decodeSeasonTeamPlayerReference(raw, index)
      const realPlayer = masterByKey.get(reference.playerKey)
      if (!realPlayer) throw new Error(`Season Team player '${reference.playerKey}' is missing from Serie A master ${master.year}`)
      return {
        ...cloneRealPlayer(realPlayer),
        price: reference.price,
        revenue: reference.revenue,
        status: reference.status,
        position: reference.position,
      }
    }),
  }
}

export const enhanceTeam = (team: Team): EnhancedTeam => TeamHelper.enhance(team)

function decodeTeamBase(document: Partial<SeasonTeamDocument> & Partial<Team>): Omit<Team, 'players'> {
  if (
    typeof document.name !== 'string' ||
    typeof document.owner !== 'string' ||
    !Array.isArray(document.additionalOwners) ||
    !document.additionalOwners.every(value => typeof value === 'string') ||
    typeof document.moneyFromRank !== 'number' ||
    (document.lastUpdate !== null && typeof document.lastUpdate !== 'string')
  ) throw new Error('Invalid season Team document')
  return {
    name: document.name,
    owner: document.owner,
    additionalOwners: [...document.additionalOwners],
    moneyFromRank: document.moneyFromRank,
    lastUpdate: document.lastUpdate,
  }
}

function decodeSeasonTeamPlayerReference(value: unknown, index: number): SeasonTeamPlayerReference {
  if (!value || typeof value !== 'object') throw new Error(`Invalid season Team player reference at index ${index}`)
  const reference = value as Partial<SeasonTeamPlayerReference>
  const playerKey = reference.playerKey?.trim().toLowerCase() ?? ''
  if (
    !playerKey ||
    typeof reference.price !== 'number' ||
    typeof reference.revenue !== 'number' ||
    typeof reference.status !== 'number' ||
    typeof reference.position !== 'number'
  ) throw new Error(`Invalid season Team player reference at index ${index}`)
  return {
    playerKey,
    price: reference.price,
    revenue: reference.revenue,
    status: reference.status,
    position: reference.position,
  }
}

function cloneLegacyPlayer(value: unknown, index: number): Player {
  if (!value || typeof value !== 'object') throw new Error(`Invalid legacy Team player at index ${index}`)
  const player = value as Partial<Player>
  if (
    typeof player.name !== 'string' || !player.name.trim() ||
    !player.team || typeof player.team !== 'object' ||
    typeof player.role !== 'number' ||
    typeof player.isActive !== 'boolean' ||
    typeof player.visible !== 'boolean' ||
    typeof player.price !== 'number' ||
    typeof player.revenue !== 'number' ||
    typeof player.status !== 'number' ||
    typeof player.position !== 'number'
  ) throw new Error(`Invalid legacy Team player at index ${index}`)
  return { ...(player as Player), team: { ...(player.team as Player['team']) } }
}

function cloneRealPlayer(player: RealPlayer): RealPlayer {
  return { ...player, team: { ...player.team } }
}

function requirePlayerKey(name: string): string {
  const key = getPlayerKey(name)
  if (!key) throw new Error(`Player '${name}' does not produce a valid player key`)
  return key
}
