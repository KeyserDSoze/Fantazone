import { ChanceType, type Chance, type ChancedRealPlayers } from './chance'
import type { FormationPositionUpdate } from './formation'
import { Role } from './group'
import type { RealDay, RealGame } from './realCalendar'
import { getPlayerKey } from './realPlayer'
import type { StatPlayer, StatPlayers } from './statPlayer'
import {
  FantaSoccerRole,
  PlayerInTeamStatus,
  type Player,
  type Team,
} from './team'

const TOP_SERIE_A_TEAMS = ['INTER', 'MILAN', 'JUVENTUS', 'NAPOLI', 'ATALANTA', 'ROMA'] as const
const MAX_STARTERS: Partial<Record<Role, number>> = {
  [Role.Defensor]: 5,
  [Role.Midfielder]: 5,
  [Role.Forward]: 3,
}

type ScoredPlayer = {
  player: Player
  key: string
  score: number
  role: Role
}

export type AutomaticFormationScoreInput = {
  player: Player
  chance: Chance | null
  stats: StatPlayer | null
  realGame: RealGame | null
}

export type AutomaticFormationResult = {
  updates: FormationPositionUpdate[]
  scores: Map<string, number>
}

/** Pure port of the legacy pre-match automatic-formation ranking score. */
export function calculateAutomaticPlayerScore(input: AutomaticFormationScoreInput): number {
  const { player, chance, stats, realGame } = input
  if (!chance) return 0
  let score = chance.fantagazzetta ? 5 : -5

  switch (chance.status) {
    case ChanceType.Normal:
      score += 1
      break
    case ChanceType.Injury:
    case ChanceType.Disqualified:
      score -= 99
      break
    case ChanceType.Warned:
    case ChanceType.Maybe:
      score -= 5
      break
  }

  const lastGame = latestStatGame(stats)
  score += lastGame != null && lastGame.vote !== null
    ? lastGame.positiveness
    : recentTrendSum(stats)
  score += calculateHomeAwayBonus(realGame, player.team.name)
  return score
}

/**
 * Builds the same local proposal as the legacy formationService: one GK, minimum 3-3-1,
 * then the best remaining players up to 10 outfield starters and 1+2+2+2 bench slots.
 * It never persists anything; callers decide whether to save the returned positions.
 */
export function calculateAutomaticFormation(input: {
  team: Team
  chances: ChancedRealPlayers | null
  stats: StatPlayers | null
  realDay: RealDay | null
}): AutomaticFormationResult {
  const active = input.team.players.filter(player => player.status === PlayerInTeamStatus.Active)
  const chanceByKey = new Map((input.chances?.players ?? []).map(player => [getPlayerKey(player.name), player.chance]))
  const statByKey = new Map((input.stats?.players ?? []).map(player => [getPlayerKey(player.name), player]))
  const originalIndex = new Map(active.map((player, index) => [getPlayerKey(player.name), index]))
  const scores = new Map<string, number>()

  const scored: ScoredPlayer[] = active.map(player => {
    const key = getPlayerKey(player.name)
    const score = calculateAutomaticPlayerScore({
      player,
      chance: chanceByKey.get(key) ?? null,
      stats: statByKey.get(key) ?? null,
      realGame: findRealGame(input.realDay, player.team.name),
    })
    scores.set(key, score)
    return { player, key, score, role: player.role }
  })

  const sortedRole = (role: Role): ScoredPlayer[] => scored
    .filter(item => item.role === role)
    .sort((left, right) => right.score - left.score || (originalIndex.get(left.key) ?? 0) - (originalIndex.get(right.key) ?? 0))

  const goalkeepers = sortedRole(Role.GoalKeeper)
  const defenders = sortedRole(Role.Defensor)
  const midfielders = sortedRole(Role.Midfielder)
  const forwards = sortedRole(Role.Forward)
  const updates = new Map<string, FantaSoccerRole>()

  goalkeepers.forEach((item, index) => {
    updates.set(item.key, index === 0
      ? FantaSoccerRole.GoalKeeper
      : index === 1
        ? FantaSoccerRole.BackupGoalKeeper
        : FantaSoccerRole.Tribune)
  })

  const starters = new Map<Role, ScoredPlayer[]>([
    [Role.Defensor, defenders.slice(0, 3)],
    [Role.Midfielder, midfielders.slice(0, 3)],
    [Role.Forward, forwards.slice(0, 1)],
  ])
  const remaining = [
    ...defenders.slice(3),
    ...midfielders.slice(3),
    ...forwards.slice(1),
  ].sort((left, right) => right.score - left.score || (originalIndex.get(left.key) ?? 0) - (originalIndex.get(right.key) ?? 0))

  for (const item of remaining) {
    const selected = starters.get(item.role) ?? []
    const max = MAX_STARTERS[item.role] ?? 0
    if (selected.length < max) starters.set(item.role, [...selected, item])
    if ([Role.Defensor, Role.Midfielder, Role.Forward]
      .reduce((total, role) => total + (starters.get(role)?.length ?? 0), 0) >= 10) break
  }

  assignStarters(starters.get(Role.Defensor) ?? [], FantaSoccerRole.Defensor, updates)
  assignStarters(starters.get(Role.Midfielder) ?? [], FantaSoccerRole.Midfielder, updates)
  assignStarters(starters.get(Role.Forward) ?? [], FantaSoccerRole.Forward, updates)

  assignBench(defenders, starters.get(Role.Defensor) ?? [], FantaSoccerRole.FirstBackupDefensor, FantaSoccerRole.SecondBackupDefensor, updates)
  assignBench(midfielders, starters.get(Role.Midfielder) ?? [], FantaSoccerRole.FirstBackupMidfielder, FantaSoccerRole.SecondBackupMidfielder, updates)
  assignBench(forwards, starters.get(Role.Forward) ?? [], FantaSoccerRole.FirstBackupForward, FantaSoccerRole.SecondBackupForward, updates)

  for (const item of scored) if (!updates.has(item.key)) updates.set(item.key, FantaSoccerRole.Tribune)
  return {
    updates: active.map(player => ({
      playerKey: getPlayerKey(player.name),
      position: updates.get(getPlayerKey(player.name)) ?? FantaSoccerRole.Tribune,
    })),
    scores,
  }
}

function assignStarters(items: ScoredPlayer[], position: FantaSoccerRole, updates: Map<string, FantaSoccerRole>): void {
  for (const item of items) updates.set(item.key, position)
}

function assignBench(
  all: ScoredPlayer[],
  starters: ScoredPlayer[],
  first: FantaSoccerRole,
  second: FantaSoccerRole,
  updates: Map<string, FantaSoccerRole>,
): void {
  const starterKeys = new Set(starters.map(item => item.key))
  all.filter(item => !starterKeys.has(item.key)).slice(0, 2).forEach((item, index) => {
    updates.set(item.key, index === 0 ? first : second)
  })
}

function latestStatGame(stats: StatPlayer | null): StatPlayer['games'][number] | null {
  if (!stats?.games.length) return null
  return [...stats.games].sort((left, right) => right.serieADay - left.serieADay)[0] ?? null
}

function recentTrendSum(stats: StatPlayer | null): number {
  if (!stats?.games.length) return 0
  return [...stats.games]
    .sort((left, right) => right.serieADay - left.serieADay)
    .slice(0, 5)
    .reduce((total, game) => total + (game.vote !== null ? game.positiveness : -2), 0)
}

function findRealGame(day: RealDay | null, teamName: string): RealGame | null {
  if (!day) return null
  return day.games.find(game => sameTeam(game.home.name, teamName) || sameTeam(game.away.name, teamName)) ?? null
}

function calculateHomeAwayBonus(realGame: RealGame | null, playerTeamName: string): number {
  if (!realGame) return 0
  const home = sameTeam(realGame.home.name, playerTeamName)
  const away = sameTeam(realGame.away.name, playerTeamName)
  if (!home && !away) return 0
  const opponent = home ? realGame.away.name : realGame.home.name
  const topOpponent = isTopTeam(opponent)
  if (home) return topOpponent ? -1 : 2
  return topOpponent ? -2 : 0
}

function isTopTeam(name: string): boolean {
  const normalized = name.toUpperCase().trim()
  return TOP_SERIE_A_TEAMS.some(top => normalized.includes(top) || top.includes(normalized))
}

function sameTeam(left: string, right: string): boolean {
  const a = left.toUpperCase().trim()
  const b = right.toUpperCase().trim()
  return Boolean(a && b && (a.includes(b) || b.includes(a)))
}
