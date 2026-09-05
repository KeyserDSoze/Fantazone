import { type LeagueSetting, Role } from './group'
import type { Rank } from './rank'
import {
  mapRawRealTeamToRealTeam,
  mapRealTeamToRawRealTeam,
  type RealTeam,
  type RealTeamRaw,
} from './realTeam'

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

export interface RealPlayerRaw {
  n: string
  t: RealTeamRaw
  r: Role
  a: boolean
  vh: boolean
}

export interface PlayerRaw extends RealPlayerRaw {
  p: number
  rv: number
  s: PlayerInTeamStatus
  k: FantaSoccerRole
}

export interface RealPlayer {
  name: string
  team: RealTeam
  role: Role
  isActive: boolean
  visible: boolean
}

export interface Player extends RealPlayer {
  price: number
  revenue: number
  status: PlayerInTeamStatus
  position: FantaSoccerRole
}

export interface TeamKeyRaw {
  g: string
  y: number
  b: string
  e: string
}

export interface TeamKey {
  group: string
  year: number
  basketId: string
  email: string
}

export interface TeamDayKeyRaw extends TeamKeyRaw {
  d: number
}

export interface TeamDayKey extends TeamKey {
  day: number
}

export interface TeamRaw {
  n: string
  o: string
  a?: string[] | null
  p: PlayerRaw[]
  m: number
  d?: string | null
}

export interface Team {
  /** Original compact payload retained so null/omitted optional fields survive rewrites. */
  raw?: TeamRaw
  name: string
  owner: string
  additionalOwners: string[]
  players: Player[]
  moneyFromRank: number
  lastUpdate: Date | null
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

export const mapRawRealPlayerToRealPlayer = (raw: RealPlayerRaw): RealPlayer => ({
  name: raw.n,
  team: mapRawRealTeamToRealTeam(raw.t),
  role: raw.r,
  isActive: raw.a,
  visible: raw.vh,
})

export const mapRawPlayerToPlayer = (raw: PlayerRaw): Player => ({
  ...mapRawRealPlayerToRealPlayer(raw),
  price: raw.p,
  revenue: raw.rv,
  status: raw.s,
  position: raw.k,
})

export const mapPlayerToRawPlayer = (player: Player): PlayerRaw => ({
  n: player.name,
  t: mapRealTeamToRawRealTeam(player.team),
  r: player.role,
  a: player.isActive,
  vh: player.visible,
  p: player.price,
  rv: player.revenue,
  s: player.status,
  k: player.position,
})

export const mapRawTeamKeyToTeamKey = (raw: TeamKeyRaw): TeamKey => ({
  group: raw.g,
  year: raw.y,
  basketId: raw.b,
  email: raw.e,
})

export const mapTeamKeyToRawTeamKey = (key: TeamKey): TeamKeyRaw => ({
  g: key.group,
  y: key.year,
  b: key.basketId,
  e: key.email,
})

export const mapRawTeamDayKeyToTeamDayKey = (raw: TeamDayKeyRaw): TeamDayKey => ({
  ...mapRawTeamKeyToTeamKey(raw),
  day: raw.d,
})

export const mapTeamDayKeyToRawTeamDayKey = (key: TeamDayKey): TeamDayKeyRaw => ({
  ...mapTeamKeyToRawTeamKey(key),
  d: key.day,
})

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

export const mapRawTeamToTeam = (raw: TeamRaw): Team => ({
  raw: cloneRaw(raw),
  name: raw?.n ?? '',
  owner: raw?.o ?? '',
  additionalOwners: raw?.a ?? [],
  players: raw?.p?.map(mapRawPlayerToPlayer) ?? [],
  moneyFromRank: raw?.m ?? 0,
  lastUpdate: raw?.d ? new Date(raw.d) : null,
})

export function mapTeamToRawTeam(team: Team): TeamRaw {
  const result: TeamRaw = {
    ...(team.raw ? cloneRaw(team.raw) : {}),
    n: team.name,
    o: team.owner,
    p: team.players.map(mapPlayerToRawPlayer),
    m: team.moneyFromRank,
  }

  if (team.additionalOwners.length > 0) {
    result.a = [...team.additionalOwners]
  } else if (team.raw && Object.prototype.hasOwnProperty.call(team.raw, 'a')) {
    result.a = team.raw.a === null ? null : []
  } else {
    result.a = []
  }

  if (team.lastUpdate) {
    result.d = team.lastUpdate.toISOString()
  } else if (team.raw && Object.prototype.hasOwnProperty.call(team.raw, 'd')) {
    result.d = team.raw.d ?? null
  } else {
    delete result.d
  }

  return result
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

  static calculateMoneyFromRank(team: Team, rank: Rank | null | undefined, settings?: LeagueSetting): number {
    if (!settings || !rank || (settings.moneyForGoal === 0 && settings.moneyForSufferedGoal === 0)) return 0
    for (const roundTeams of Object.values(rank.rounds)) {
      const ranked = roundTeams.find(item => item.owner === team.owner)
      if (ranked) {
        return ranked.goal * settings.moneyForGoal + ranked.sufferedGoal * settings.moneyForSufferedGoal
      }
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

export const enhanceTeam = (team: Team): EnhancedTeam => TeamHelper.enhance(team)

function cloneRaw<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
