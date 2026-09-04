export enum Role {
  Undefined = -1,
  GoalKeeper = 0,
  Defensor = 1,
  Midfielder = 2,
  Forward = 3,
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
