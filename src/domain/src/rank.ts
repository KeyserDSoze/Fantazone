export interface RankedTeamRaw {
  n: string
  o: string
  p: number
  v: number
  d: number
  e: number
  g: number
  s: number
  x: number
  w: number
  z: number
  m: number
}

export interface RankRaw {
  d: number
  r: Record<string, RankedTeamRaw[]>
}

export interface RankedTeam {
  name: string
  owner: string
  point: number
  victories: number
  draws: number
  defeats: number
  goal: number
  sufferedGoal: number
  valuePoint: number
  sufferedValuePoint: number
  plusMoney: number
  money: number
  valueAssets: number
}

export interface Rank {
  serieADay: number
  rounds: Record<string, RankedTeam[]>
}

export interface EnhancedRank extends Rank {
  availableRounds: string[]
  totalTeamsCount: number
  roundTeamCounts: Record<string, number>
}

export interface EnhancedRankedTeam extends RankedTeam {
  goalDifference: number
  totalGamesPlayed: number
  pointsPerGame: number
  position?: number
}

export type LuckEventType =
  | 'win-vs-worst'
  | 'win-vs-second-worst'
  | 'win-narrow'
  | 'draw-wide-gap'
  | 'loss-narrow'
  | 'loss-as-best'
  | 'loss-as-top3'
  | 'win-as-worst'

export interface LuckEvent {
  type: LuckEventType
  points: number
  gameId: string
  gameDay: number
  opponent: string
  myScore: number
  opponentScore: number
  result: 'win' | 'draw' | 'loss'
  detail: string
}

export interface TeamLuck {
  owner: string
  name: string
  totalLuck: number
  gamesPlayed: number
  avgLuck: number
  events: LuckEvent[]
}

export interface EnhancedRankedTeamWithLuck extends EnhancedRankedTeam {
  luck?: TeamLuck
}

export function mapRawRankedTeamToRankedTeam(raw: RankedTeamRaw): RankedTeam {
  return {
    name: raw.n,
    owner: raw.o,
    point: raw.p,
    victories: raw.v,
    draws: raw.d,
    defeats: raw.e,
    goal: raw.g,
    sufferedGoal: raw.s,
    valuePoint: raw.x,
    sufferedValuePoint: raw.w,
    plusMoney: raw.z,
    money: raw.m,
    valueAssets: raw.m + raw.z,
  }
}

export function mapRankedTeamToRawRankedTeam(team: RankedTeam): RankedTeamRaw {
  return {
    n: team.name,
    o: team.owner,
    p: team.point,
    v: team.victories,
    d: team.draws,
    e: team.defeats,
    g: team.goal,
    s: team.sufferedGoal,
    x: team.valuePoint,
    w: team.sufferedValuePoint,
    z: team.plusMoney,
    m: team.money,
  }
}

export function mapRawRankToRank(raw: RankRaw): Rank {
  const rounds: Record<string, RankedTeam[]> = {}
  for (const [roundKey, teams] of Object.entries(raw.r ?? {})) {
    rounds[roundKey] = (teams ?? []).map(mapRawRankedTeamToRankedTeam)
  }

  return {
    serieADay: raw.d,
    rounds,
  }
}

export function mapRankToRawRank(rank: Rank): RankRaw {
  const rounds: Record<string, RankedTeamRaw[]> = {}
  for (const [roundKey, teams] of Object.entries(rank.rounds)) {
    rounds[roundKey] = teams.map(mapRankedTeamToRawRankedTeam)
  }

  return {
    d: rank.serieADay,
    r: rounds,
  }
}

export class RankHelper {
  static getRankedTeamByOwner(rank: Rank, roundId: string, owner: string): RankedTeam | null {
    return rank.rounds[roundId]?.find(team => team.owner === owner) ?? null
  }

  static getAvailableRounds(rank: Rank): string[] {
    return Object.keys(rank.rounds)
  }

  static getTeamCount(rank: Rank, roundId: string): number {
    return rank.rounds[roundId]?.length ?? 0
  }

  static getTeamsSortedByPoints(rank: Rank, roundId: string): RankedTeam[] {
    const teams = rank.rounds[roundId]
    return teams ? [...teams].sort((a, b) => b.point - a.point) : []
  }

  static getTeamsSortedByValueAssets(rank: Rank, roundId: string): RankedTeam[] {
    const teams = rank.rounds[roundId]
    return teams ? [...teams].sort((a, b) => b.valueAssets - a.valueAssets) : []
  }

  static getTeamPosition(rank: Rank, roundId: string, owner: string): number {
    const index = RankHelper.getTeamsSortedByPoints(rank, roundId).findIndex(team => team.owner === owner)
    return index >= 0 ? index + 1 : -1
  }

  static getGoalDifference(team: RankedTeam): number {
    return team.goal - team.sufferedGoal
  }

  static getTotalGamesPlayed(team: RankedTeam): number {
    return team.victories + team.draws + team.defeats
  }

  static getPointsPerGame(team: RankedTeam): number {
    const totalGames = RankHelper.getTotalGamesPlayed(team)
    return totalGames > 0 ? team.point / totalGames : 0
  }

  static addRankedTeams(a: RankedTeam, b: RankedTeam): RankedTeam {
    return {
      name: a.name,
      owner: a.owner,
      point: a.point + b.point,
      defeats: a.defeats + b.defeats,
      goal: a.goal + b.goal,
      draws: a.draws + b.draws,
      money: a.money + b.money,
      plusMoney: a.plusMoney + b.plusMoney,
      sufferedGoal: a.sufferedGoal + b.sufferedGoal,
      sufferedValuePoint: a.sufferedValuePoint + b.sufferedValuePoint,
      valuePoint: a.valuePoint + b.valuePoint,
      victories: a.victories + b.victories,
      valueAssets: (a.money + a.plusMoney) + (b.money + b.plusMoney),
    }
  }
}

export const enhanceRank = (rank: Rank): EnhancedRank => {
  const availableRounds = RankHelper.getAvailableRounds(rank)
  const roundTeamCounts: Record<string, number> = {}
  let totalTeamsCount = 0

  for (const roundId of availableRounds) {
    const count = RankHelper.getTeamCount(rank, roundId)
    roundTeamCounts[roundId] = count
    totalTeamsCount += count
  }

  return {
    ...rank,
    availableRounds,
    totalTeamsCount,
    roundTeamCounts,
  }
}

export const enhanceRankedTeam = (
  team: RankedTeam,
  position?: number,
): EnhancedRankedTeam => ({
  ...team,
  goalDifference: RankHelper.getGoalDifference(team),
  totalGamesPlayed: RankHelper.getTotalGamesPlayed(team),
  pointsPerGame: RankHelper.getPointsPerGame(team),
  position,
})

export const enhanceRankWithTeamPositions = (
  rank: Rank,
): Record<string, EnhancedRankedTeam[]> => {
  const enhancedRounds: Record<string, EnhancedRankedTeam[]> = {}
  for (const roundId of Object.keys(rank.rounds)) {
    enhancedRounds[roundId] = RankHelper.getTeamsSortedByPoints(rank, roundId)
      .map((team, index) => enhanceRankedTeam(team, index + 1))
  }
  return enhancedRounds
}

export const DefaultRankedTeam: RankedTeam = {
  name: '',
  owner: '',
  point: 0,
  victories: 0,
  draws: 0,
  defeats: 0,
  goal: 0,
  sufferedGoal: 0,
  valuePoint: 0,
  sufferedValuePoint: 0,
  plusMoney: 0,
  money: 0,
  valueAssets: 0,
}

export const DefaultRank: Rank = {
  serieADay: 0,
  rounds: {},
}
