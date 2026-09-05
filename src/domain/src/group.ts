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

/**
 * Schema v2 deliberately persists these readable domain names directly to JSON.
 * There is no compact/raw mirror model anymore.
 */
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

export interface LeagueRound {
  name: string | null
  type: RoundType
  fromStart: boolean
  fromRankingStartTeam: number | null
  fromRankingEndTeam: number | null
}

export interface FromPreviousYearSettings {
  leaguesId: string[]
  maxTeamsPerLeague: number
  roundType: RoundType
}

export interface CardTrainerSettings {
  maxCardsPerType: Record<string, number>
}

export interface LeagueTypeNumberSettings {
  maxPlayersInTeam: number
  maxGoalKeepersInTeam: number
  maxDefendersInTeam: number
  maxMidfieldersInTeam: number
  maxForwardsInTeam: number
  maxGoalKeepersInBench: number
  maxDefendersInBench: number
  maxMidfieldersInBench: number
  maxForwardsInBench: number
}

export interface LeagueTypeSettings {
  calendarType: LeagueCalendarType
  rounds: LeagueRound[]
  numbers: LeagueTypeNumberSettings
  fromPreviousYear: FromPreviousYearSettings | null
  cardTrainer: CardTrainerSettings
}

export interface LeagueSetting {
  votes: Partial<Record<Role, VoteLeagueSetting>>
  formation: FormationType
  typeSettings: LeagueTypeSettings | null
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

export const DefaultLeagueTypeNumberSettings: LeagueTypeNumberSettings = {
  maxPlayersInTeam: 25,
  maxGoalKeepersInTeam: 1,
  maxDefendersInTeam: 5,
  maxMidfieldersInTeam: 4,
  maxForwardsInTeam: 2,
  maxGoalKeepersInBench: 1,
  maxDefendersInBench: 1,
  maxMidfieldersInBench: 1,
  maxForwardsInBench: 1,
}

export const DefaultLeagueTypeSettings: LeagueTypeSettings = {
  calendarType: LeagueCalendarType.Random,
  rounds: [{
    name: '@',
    type: RoundType.Rank,
    fromStart: true,
    fromRankingStartTeam: null,
    fromRankingEndTeam: null,
  }],
  numbers: { ...DefaultLeagueTypeNumberSettings },
  fromPreviousYear: null,
  cardTrainer: { maxCardsPerType: {} },
}

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
