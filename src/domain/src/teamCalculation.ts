import { FormationType, LeagueType, Role, type LeagueSetting } from './group'
import { type Point } from './calendar'
import { getPlayerKey } from './realPlayer'
import { FantaSoccerRole, type Player } from './team'
import { Behaviour, calculateVoteValue, type Vote, type VoteValue, type VotedRealPlayers } from './vote'

export interface EnrichedTeamPlayer {
  current: Player
  currentPosition: FantaSoccerRole
  vote: Vote | null
  finalValue: VoteValue | null
}

export interface TeamPointCalculation {
  point: Point
  formation: EnrichedTeamPlayer[]
}

export interface TeamPointCalculationInput {
  players: Player[]
  officialVotes?: VotedRealPlayers | null
  liveVotes?: VotedRealPlayers | null
  leagueType: LeagueType
  settings: LeagueSetting
}

/**
 * Pure TeamCalculator.CalculatePoint port.
 * Official votes have precedence over live votes exactly as in legacy TeamCalculator.GetVote.
 */
export function calculateTeamPoint(input: TeamPointCalculationInput): TeamPointCalculation {
  if (input.players.length === 0) {
    return {
      point: { value: 0, defensiveBonus: false, goodPeople: false, ownGoal: false },
      formation: [],
    }
  }

  const official = indexVotes(input.officialVotes)
  const live = indexVotes(input.liveVotes)
  const enriched = input.players.map(player => enrichPlayer(player, official, live, input.settings))
  const useBestFormation = input.settings.formation === FormationType.Best || input.leagueType === LeagueType.SuperLeague
  const formation = useBestFormation ? selectBestFormation(enriched) : selectNormalFormation(enriched)
  const playersInField = formation.filter(player => player.currentPosition <= FantaSoccerRole.Forward)

  let value = 0
  let defensiveBonus = true
  let defensorCount = 0
  let goodPeople = true

  for (const player of playersInField) {
    if (player.vote?.hasVote) {
      value += player.finalValue?.value ?? 0
      if (player.current.role === Role.Defensor) defensorCount += 1
    }
    if (
      player.current.role === Role.Defensor &&
      (!player.vote || !player.vote.hasVote || player.vote.value < 6)
    ) {
      defensiveBonus = false
    }
    if (!player.vote || !player.vote.hasVote || player.vote.status !== Behaviour.Nothing) {
      goodPeople = false
    }
  }

  if (goodPeople) value += input.settings.pointForGoodPeople
  if (defensiveBonus) {
    if (defensorCount === 3) value += input.settings.pointForStrongDefense
    else if (defensorCount === 4) value += input.settings.pointForStrongDefense4
    else if (defensorCount === 5) value += input.settings.pointForStrongDefense5
  }

  return {
    point: {
      value,
      defensiveBonus,
      goodPeople,
      ownGoal: input.settings.pointForOwnGoal > 0 &&
        value < input.settings.pointForFirstGoal - input.settings.pointForOwnGoal,
    },
    formation,
  }
}

function enrichPlayer(
  player: Player,
  official: Map<string, Vote | null>,
  live: Map<string, Vote | null>,
  settings: LeagueSetting,
): EnrichedTeamPlayer {
  const key = getPlayerKey(player.name)
  const vote = official.has(key) ? (official.get(key) ?? null) : (live.get(key) ?? null)
  return {
    current: clonePlayer(player),
    currentPosition: player.position,
    vote,
    finalValue: vote ? calculateVoteValue(player.role, vote, settings) : null,
  }
}

/** Legacy DefaultLeague substitutions. Persisted Player.position is never mutated. */
function selectNormalFormation(players: EnrichedTeamPlayer[]): EnrichedTeamPlayer[] {
  const all = players.map(cloneEnriched)
  const field = all
    .filter(player => player.current.position >= FantaSoccerRole.GoalKeeper && player.current.position <= FantaSoccerRole.Forward)
    .sort((a, b) => a.current.position - b.current.position)
  const substitutes = all
    .filter(player => player.current.position > FantaSoccerRole.Forward && player.current.position <= FantaSoccerRole.SecondBackupForward)
    .sort((a, b) => a.current.position - b.current.position)

  for (const starter of field) {
    if (starter.vote?.hasVote) continue
    const replacement = substitutes.find(candidate =>
      candidate.current.position > FantaSoccerRole.Forward &&
      candidate.currentPosition > FantaSoccerRole.Forward &&
      candidate.current.role === starter.current.role &&
      candidate.vote?.hasVote === true,
    )
    if (!replacement) continue
    const previous = starter.currentPosition
    starter.currentPosition = replacement.currentPosition
    replacement.currentPosition = previous
  }

  const tribune = all.filter(player => player.current.position === FantaSoccerRole.Tribune)
  return [...field, ...substitutes, ...tribune]
}

/** Legacy SuperLeague.GetRightFormation, kept deterministic and non-mutating. */
function selectBestFormation(players: EnrichedTeamPlayer[]): EnrichedTeamPlayer[] {
  let remaining = players.map(cloneEnriched).sort(compareBestPlayer)
  const goalkeepers = remaining.filter(player => player.current.role === Role.GoalKeeper)
  if (goalkeepers[0]) goalkeepers[0].currentPosition = FantaSoccerRole.GoalKeeper
  if (goalkeepers[1]) goalkeepers[1].currentPosition = FantaSoccerRole.BackupGoalKeeper
  for (const player of goalkeepers.slice(2)) player.currentPosition = FantaSoccerRole.Tribune

  const selected: EnrichedTeamPlayer[] = [...goalkeepers]
  remaining = without(remaining, selected)

  change(remaining.filter(player => player.current.role === Role.Defensor).slice(0, 3), FantaSoccerRole.Defensor)
  change(remaining.filter(player => player.current.role === Role.Midfielder).slice(0, 3), FantaSoccerRole.Midfielder)
  change(remaining.filter(player => player.current.role === Role.Forward).slice(0, 1), FantaSoccerRole.Forward)
  remaining = without(remaining, selected)

  let maxInField = 3
  let maxDefenders = 2
  let maxMidfielders = 2
  let maxForwards = 2
  addPlayers(remaining.filter(player => (player.vote?.value ?? -Infinity) >= 6))
  if (maxInField > 0) {
    addPlayers([...remaining].sort((a, b) =>
      finalValue(b) - finalValue(a) ||
      b.current.role - a.current.role ||
      voteValue(b) - voteValue(a),
    ))
  }

  addBackups(Role.Defensor, FantaSoccerRole.FirstBackupDefensor, FantaSoccerRole.SecondBackupDefensor)
  addBackups(Role.Midfielder, FantaSoccerRole.FirstBackupMidfielder, FantaSoccerRole.SecondBackupMidfielder)
  addBackups(Role.Forward, FantaSoccerRole.FirstBackupForward, FantaSoccerRole.SecondBackupForward)
  remaining = without(remaining, selected)

  for (const player of remaining) {
    player.currentPosition = FantaSoccerRole.Tribune
    selected.push(player)
  }
  return selected

  function change(items: EnrichedTeamPlayer[], position: FantaSoccerRole): void {
    for (const player of items) {
      player.currentPosition = position
      selected.push(player)
    }
  }

  function addPlayers(items: EnrichedTeamPlayer[]): void {
    for (const player of items) {
      if (!remaining.includes(player)) continue
      if (player.current.role === Role.Defensor && maxDefenders > 0) {
        player.currentPosition = FantaSoccerRole.Defensor
        maxDefenders -= 1
      } else if (player.current.role === Role.Midfielder && maxMidfielders > 0) {
        player.currentPosition = FantaSoccerRole.Midfielder
        maxMidfielders -= 1
      } else if (player.current.role === Role.Forward && maxForwards > 0) {
        player.currentPosition = FantaSoccerRole.Forward
        maxForwards -= 1
      } else {
        continue
      }
      selected.push(player)
      maxInField -= 1
      if (maxInField === 0) break
    }
    remaining = without(remaining, selected)
  }

  function addBackups(role: Role, first: FantaSoccerRole, second: FantaSoccerRole): void {
    const backups = remaining.filter(player => player.current.role === role).slice(0, 2)
    if (backups[0]) {
      backups[0].currentPosition = first
      selected.push(backups[0])
    }
    if (backups[1]) {
      backups[1].currentPosition = second
      selected.push(backups[1])
    }
  }
}

function indexVotes(document: VotedRealPlayers | null | undefined): Map<string, Vote | null> {
  const result = new Map<string, Vote | null>()
  for (const player of document?.players ?? []) {
    const key = getPlayerKey(player.name)
    if (key && !result.has(key)) result.set(key, player.vote)
  }
  return result
}

function compareBestPlayer(a: EnrichedTeamPlayer, b: EnrichedTeamPlayer): number {
  return finalValue(b) - finalValue(a) || voteValue(b) - voteValue(a)
}

function finalValue(player: EnrichedTeamPlayer): number {
  return player.finalValue?.value ?? -1000
}

function voteValue(player: EnrichedTeamPlayer): number {
  return player.vote?.value ?? -1000
}

function without(source: EnrichedTeamPlayer[], removed: EnrichedTeamPlayer[]): EnrichedTeamPlayer[] {
  const set = new Set(removed)
  return source.filter(item => !set.has(item))
}

function cloneEnriched(player: EnrichedTeamPlayer): EnrichedTeamPlayer {
  return {
    ...player,
    current: clonePlayer(player.current),
    vote: player.vote ? { ...player.vote } : null,
    finalValue: player.finalValue ? { ...player.finalValue } : null,
  }
}

function clonePlayer(player: Player): Player {
  return { ...player, team: { ...player.team } }
}
