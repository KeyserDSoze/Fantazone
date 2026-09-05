import { preserveRawLeagueSetting, serializeVoteSettings } from './groupAdmin'

export enum Role {
  Undefined = -1,
  GoalKeeper = 0,
  Defensor = 1,
  Midfielder = 2,
  Forward = 3,
}

export enum IdentityRole {
  None = 0,
  Reader = 1,
  Participant = 2,
  Admin = 4,
  SuperAdmin = 8,
}

export enum LeagueType {
  Null = 0,
  League = 1,
  Cup = 2,
  NewCup = 3,
  SuperLeague = 4,
  FutsalLeague = 5,
}

export enum MarketType {
  WithVote = 0,
  WithoutVote = 1,
  Denied = 2,
}

export enum FormationType {
  Normal = 0,
  Best = 1,
}

export enum LeagueCalendarType {
  Random = 0,
  Cup = 1,
}

export enum RoundType {
  Rank = 0,
  Elimination = 1,
}

// Compact contracts intentionally match the old Fantasoccer JSON exactly.
export interface VoteLeagueSettingRaw {
  g: number
  p: number
  s: number
  d: number
  w: number
  o: number
  a: number
  y: number
  r: number
  j: number
  m: number
}

export interface LeagueRoundRaw {
  n: string | null
  t: RoundType
  f: boolean
  s: number | null
  e: number | null
}

export interface FromPreviousYearSettingsRaw {
  l: string[]
  m: number
  t: RoundType
}

export interface CardTrainerSettingsRaw {
  c: Record<string, number>
}

export interface LeagueTypeNumberSettingsRaw {
  t: number
  g: number
  d: number
  m: number
  f: number
  mg: number
  md: number
  mb: number
  fb: number
}

export interface LeagueTypeSettingsRaw {
  t: LeagueCalendarType
  r: LeagueRoundRaw[]
  n: LeagueTypeNumberSettingsRaw
  fpy: FromPreviousYearSettingsRaw | null
  ct: CardTrainerSettingsRaw
}

export interface LeagueSettingRaw {
  v: Record<string, VoteLeagueSettingRaw>
  frm: FormationType
  lt: LeagueTypeSettingsRaw | null
  s: number
  d: number
  c: number
  g: number
  t: number
  o: number
  f: number
  p: number
  a: number
  b: number
  h: number
  '3': number
  '4': number
  '5': number
  gp: number
  l: number
  m: number
  n: number
  q: boolean
  vp: boolean
  mk: MarketType
}

export interface AnnualLeagueRaw {
  y: number
  t: LeagueType
  s: LeagueSettingRaw
}

export interface LeagueRaw {
  i: string
  n: string
  m: boolean
  t: LeagueType
  y: AnnualLeagueRaw[]
  b: string[]
}

export interface AnnualTeamRaw {
  n: string
  o: string
  a: string[]
}

export interface YearlyBasketRaw {
  y: number
  t: AnnualTeamRaw[]
}

export interface BasketRaw {
  i: string
  n: string
  y: YearlyBasketRaw[]
}

export interface UserOfAGroupRaw {
  u: string
  e: string
  r: IdentityRole
}

export interface GroupRaw {
  i: string
  n: string
  l: LeagueRaw[]
  u: UserOfAGroupRaw[]
  b: BasketRaw[]
}

export interface VoteLeagueSetting {
  goal: number
  penalty: number
  sufferedGoal: number
  stoppedPenalty: number
  wrongedPenalty: number
  ownGoal: number
  assist: number
  yellowCard: number
  redCard: number
  injury: number
  manOfTheMatch: number
}

export interface LeagueSetting {
  raw?: LeagueSettingRaw
  votes: Partial<Record<Role, VoteLeagueSetting>>
  formation: FormationType
  typeSettings: LeagueTypeSettingsRaw | null
  startingMoney: number
  delayedDay: number
  cancelledDay: number
  pointForFirstGoal: number
  pointForNextGoal: number
  pointForOwnGoal: number
  differencePointForOwnGoal: number
  pointInHome: number
  pointForVictory: number
  pointForDefeat: number
  pointForDraw: number
  pointForStrongDefense: number
  pointForStrongDefense4: number
  pointForStrongDefense5: number
  pointForGoodPeople: number
  pointForCleanSheet: number
  moneyForGoal: number
  moneyForSufferedGoal: number
  randomAuction: boolean
  rankWithValuePoints: boolean
  market: MarketType
}

export interface AnnualLeague {
  year: number
  type: LeagueType
  settings: LeagueSetting
}

export interface League {
  id: string
  name: string
  isMain: boolean
  type: LeagueType
  years: AnnualLeague[]
  basketsId: string[]
}

export interface AnnualTeam {
  name: string
  owner: string
  additionalOwners: string[]
}

export interface YearlyBasket {
  year: number
  teams: AnnualTeam[]
}

export interface Basket {
  id: string
  name: string
  years: YearlyBasket[]
}

export interface UserOfAGroup {
  username: string
  email: string
  role: IdentityRole
}

export interface Group {
  id: string
  name: string
  leagues: League[]
  users: UserOfAGroup[]
  baskets: Basket[]
}

export const DefaultVoteLeagueSetting: VoteLeagueSetting = {
  assist: 1,
  goal: 3,
  ownGoal: -3,
  penalty: 3,
  stoppedPenalty: 3,
  redCard: -1,
  yellowCard: -0.5,
  sufferedGoal: -1,
  wrongedPenalty: -3,
  injury: 0,
  manOfTheMatch: 2,
}

export function mapRawVoteLeagueSettingToVoteLeagueSetting(raw: VoteLeagueSettingRaw): VoteLeagueSetting {
  return {
    goal: raw.g,
    penalty: raw.p,
    sufferedGoal: raw.s,
    stoppedPenalty: raw.d,
    wrongedPenalty: raw.w,
    ownGoal: raw.o,
    assist: raw.a,
    yellowCard: raw.y,
    redCard: raw.r,
    injury: raw.j,
    manOfTheMatch: raw.m,
  }
}

export function mapRawLeagueSettingToLeagueSetting(raw: LeagueSettingRaw): LeagueSetting {
  const votes: Partial<Record<Role, VoteLeagueSetting>> = {}
  for (const [roleKey, voteRaw] of Object.entries(raw.v || {})) {
    const numericRole = Number(roleKey)
    const namedRole = Role[roleKey as keyof typeof Role]
    const role = Number.isNaN(numericRole) ? namedRole : numericRole
    if (typeof role === 'number') votes[role as Role] = mapRawVoteLeagueSettingToVoteLeagueSetting(voteRaw)
  }
  if (!votes[Role.Undefined]) votes[Role.Undefined] = { ...DefaultVoteLeagueSetting }

  return {
    raw,
    votes,
    formation: raw.frm ?? FormationType.Normal,
    typeSettings: raw.lt ?? null,
    startingMoney: raw.s,
    delayedDay: raw.d,
    cancelledDay: raw.c,
    pointForFirstGoal: raw.g,
    pointForNextGoal: raw.t,
    pointForOwnGoal: raw.o,
    differencePointForOwnGoal: raw.f,
    pointInHome: raw.p,
    pointForVictory: raw.a,
    pointForDefeat: raw.b,
    pointForDraw: raw.h,
    pointForStrongDefense: raw['3'],
    pointForStrongDefense4: raw['4'],
    pointForStrongDefense5: raw['5'],
    pointForGoodPeople: raw.gp,
    pointForCleanSheet: raw.l,
    moneyForGoal: raw.m,
    moneyForSufferedGoal: raw.n,
    randomAuction: raw.q,
    rankWithValuePoints: raw.vp,
    market: raw.mk,
  }
}

export const mapRawAnnualLeagueToAnnualLeague = (raw: AnnualLeagueRaw): AnnualLeague => ({
  year: raw.y,
  type: raw.t,
  settings: mapRawLeagueSettingToLeagueSetting(raw.s),
})

export const mapRawLeagueToLeague = (raw: LeagueRaw): League => ({
  id: raw.i,
  name: raw.n,
  isMain: raw.m,
  type: raw.t,
  years: (raw.y || []).map(mapRawAnnualLeagueToAnnualLeague),
  basketsId: raw.b || [],
})

export const mapRawAnnualTeamToAnnualTeam = (raw: AnnualTeamRaw): AnnualTeam => ({
  name: raw.n,
  owner: raw.o,
  additionalOwners: raw.a || [],
})

export const mapRawYearlyBasketToYearlyBasket = (raw: YearlyBasketRaw): YearlyBasket => ({
  year: raw.y,
  teams: (raw.t || []).map(mapRawAnnualTeamToAnnualTeam),
})

export const mapRawBasketToBasket = (raw: BasketRaw): Basket => ({
  id: raw.i,
  name: raw.n,
  years: (raw.y || []).map(mapRawYearlyBasketToYearlyBasket),
})

export const mapRawUserOfAGroupToUserOfAGroup = (raw: UserOfAGroupRaw): UserOfAGroup => ({
  username: raw.u,
  email: raw.e,
  role: raw.r,
})

export function mapRawGroupToGroup(raw: GroupRaw): Group {
  return {
    id: raw.i,
    name: raw.n,
    leagues: (raw.l || []).map(mapRawLeagueToLeague),
    users: (raw.u || []).map(mapRawUserOfAGroupToUserOfAGroup),
    baskets: (raw.b || []).map(mapRawBasketToBasket),
  }
}

export const mapUserOfAGroupToRaw = (user: UserOfAGroup): UserOfAGroupRaw => ({
  u: user.username,
  e: user.email,
  r: user.role,
})

export const mapAnnualTeamToRaw = (team: AnnualTeam): AnnualTeamRaw => ({
  n: team.name,
  o: team.owner,
  a: team.additionalOwners || [],
})

export const mapYearlyBasketToRaw = (basket: YearlyBasket): YearlyBasketRaw => ({
  y: basket.year,
  t: basket.teams.map(mapAnnualTeamToRaw),
})

export const mapBasketToRaw = (basket: Basket): BasketRaw => ({
  i: basket.id,
  n: basket.name,
  y: basket.years.map(mapYearlyBasketToRaw),
})

export const mapAnnualLeagueToRaw = (league: AnnualLeague): AnnualLeagueRaw => ({
  y: league.year,
  t: league.type,
  s: preserveRawLeagueSetting(league.settings, serializeVoteSettings(league.settings.votes)),
})

export const mapLeagueToRaw = (league: League): LeagueRaw => ({
  i: league.id,
  n: league.name,
  m: league.isMain,
  t: league.type,
  y: league.years.map(mapAnnualLeagueToRaw),
  b: league.basketsId || [],
})

export const mapGroupToRaw = (group: Group): GroupRaw => ({
  i: group.id,
  n: group.name,
  l: group.leagues.map(mapLeagueToRaw),
  u: group.users.map(mapUserOfAGroupToRaw),
  b: group.baskets.map(mapBasketToRaw),
})

export class GroupHelper {
  static isOwner(team: AnnualTeam, email: string): boolean {
    const target = normalizeEmail(email)
    return Boolean(target) && [team.owner, ...(team.additionalOwners || [])]
      .some(owner => normalizeEmail(owner) === target)
  }

  static findUserByEmail(group: Group, email: string): UserOfAGroup | null {
    const target = normalizeEmail(email)
    if (!target) return null
    return group.users.find(user => normalizeEmail(user.email) === target) ?? null
  }

  static hasRole(user: UserOfAGroup, role: IdentityRole): boolean {
    return (user.role & role) === role
  }

  static getAnnualType(league: League, year: number): LeagueType {
    const annualLeague = league.years?.find(item => item.year === year)
    return annualLeague && annualLeague.type !== LeagueType.Null ? annualLeague.type : league.type
  }

  static getActiveUsers(group: Group): UserOfAGroup[] {
    return group.users.filter(user => user.role !== IdentityRole.None)
  }

  static getRemovedUsers(group: Group): UserOfAGroup[] {
    return group.users.filter(user => user.role === IdentityRole.None)
  }

  static getAdminUsers(group: Group): UserOfAGroup[] {
    return group.users.filter(user => GroupHelper.hasRole(user, IdentityRole.Admin))
  }

  static getSuperAdminUsers(group: Group): UserOfAGroup[] {
    return group.users.filter(user => GroupHelper.hasRole(user, IdentityRole.SuperAdmin))
  }

  static getReaderUsers(group: Group): UserOfAGroup[] {
    return group.users.filter(user => GroupHelper.hasRole(user, IdentityRole.Reader))
  }

  static getParticipants(group: Group): UserOfAGroup[] {
    return group.users.filter(user => GroupHelper.hasRole(user, IdentityRole.Participant))
  }

  static getBasketId(group: Group, owner: string, year?: number): string | null {
    for (const basket of group.baskets) {
      for (const yearly of basket.years || []) {
        if ((year == null || yearly.year === year) && yearly.teams.some(team => GroupHelper.isOwner(team, owner))) {
          return basket.id
        }
      }
    }
    return null
  }

  static getAnnualLeague(group: Group, id: string, year: number): AnnualLeague | null {
    return group.leagues.find(league => league.id === id)?.years.find(item => item.year === year) ?? null
  }

  static getAnnualLeagues(group: Group, year: number): AnnualLeague[] {
    return group.leagues.flatMap(league => league.years).filter(item => item.year === year)
  }

  static getAvailableYears(group: Group): number[] {
    const years = new Set<number>()
    group.leagues.forEach(league => league.years.forEach(item => years.add(item.year)))
    group.baskets.forEach(basket => basket.years.forEach(item => years.add(item.year)))
    return [...years].sort((a, b) => b - a)
  }
}

export const DefaultLeagueSetting: LeagueSetting = {
  startingMoney: 1000,
  formation: FormationType.Normal,
  typeSettings: null,
  votes: { [Role.Undefined]: DefaultVoteLeagueSetting },
  delayedDay: 2,
  cancelledDay: 1,
  pointForFirstGoal: 66,
  pointForNextGoal: 6,
  pointForOwnGoal: 6,
  differencePointForOwnGoal: 6,
  pointInHome: 0,
  pointForVictory: 3,
  pointForDefeat: 0,
  pointForDraw: 1,
  pointForStrongDefense: 2,
  pointForStrongDefense4: 4,
  pointForStrongDefense5: 6,
  moneyForGoal: 5,
  moneyForSufferedGoal: 3,
  pointForCleanSheet: 1,
  pointForGoodPeople: 2,
  randomAuction: false,
  rankWithValuePoints: false,
  market: MarketType.WithVote,
}

export interface EnhancedGroup extends Group {
  activeUsers: UserOfAGroup[]
  removedUsers: UserOfAGroup[]
  adminUsers: UserOfAGroup[]
  superAdminUsers: UserOfAGroup[]
  readerUsers: UserOfAGroup[]
  participants: UserOfAGroup[]
}

export const enhanceGroup = (group: Group): EnhancedGroup => ({
  ...group,
  activeUsers: GroupHelper.getActiveUsers(group),
  removedUsers: GroupHelper.getRemovedUsers(group),
  adminUsers: GroupHelper.getAdminUsers(group),
  superAdminUsers: GroupHelper.getSuperAdminUsers(group),
  readerUsers: GroupHelper.getReaderUsers(group),
  participants: GroupHelper.getParticipants(group),
})

function normalizeEmail(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? ''
}
