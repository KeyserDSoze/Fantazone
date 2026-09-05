import { DefaultLeagueSetting, Role, type LeagueSetting } from './group'
import { cloneRealPlayer, getPlayerKey, type RealPlayer, type RealPlayers } from './realPlayer'
import { Behaviour, calculateVoteValue, type VotedRealPlayer, type VotedRealPlayers } from './vote'

export interface StatPlayerGame {
  serieADay: number
  vote: number | null
  positiveness: number
}

/** Persisted counters/history only. Averages remain computed helpers. */
export interface StatPlayer extends RealPlayer {
  summatory: number
  fantaSummatory: number
  withVote: number
  withoutVote: number
  noPlayed: number
  withSpecial: number
  goals: number
  penalties: number
  assists: number
  stoppedPenalties: number
  sufferedGoals: number
  wrongedPenalties: number
  ownGoals: number
  yellowCards: number
  redCards: number
  enoughVotes: number
  manOfTheMatch: number
  injured: number
  games: StatPlayerGame[]
}

export interface StatPlayers {
  year: number
  untilSerieADay: number
  players: StatPlayer[]
}

export type OfficialVotesByDay = ReadonlyMap<number, VotedRealPlayers | null | undefined>

/** Pure port of legacy StatsPlayerGenerator. Network/storage stays outside this reducer. */
export function generatePlayerStatistics(input: {
  realPlayers: RealPlayers
  officialVotesByDay: OfficialVotesByDay
  untilSerieADay: number
  settings?: LeagueSetting
}): StatPlayers {
  const { realPlayers, officialVotesByDay, untilSerieADay } = input
  const settings = input.settings ?? DefaultLeagueSetting
  validateDay(untilSerieADay)

  const players = realPlayers.players.map(createStatPlayer)
  for (let serieADay = untilSerieADay; serieADay > 0; serieADay -= 1) {
    const votes = officialVotesByDay.get(serieADay)
    if (votes && (votes.year !== realPlayers.year || votes.serieADay !== serieADay)) {
      throw new Error(
        `Official vote document mismatch for day ${serieADay}: found ${votes.year}/${votes.serieADay}, expected ${realPlayers.year}/${serieADay}`,
      )
    }
    const votesByKey = indexVotes(votes?.players ?? [], serieADay)
    for (const player of players) {
      const votedPlayer = votesByKey.get(getPlayerKey(player.name))
      player.games.push(applyVoteToStats(player, votedPlayer, serieADay, settings))
    }
  }

  return { year: realPlayers.year, untilSerieADay, players }
}

export const StatPlayerHelper = {
  average(player: StatPlayer): number {
    return player.withVote > 0 ? player.summatory / player.withVote : 0
  },
  fantaAverage(player: StatPlayer): number {
    return player.withVote > 0 ? player.fantaSummatory / player.withVote : 0
  },
  sortByAverage(players: StatPlayer[]): StatPlayer[] {
    return [...players].sort((a, b) =>
      this.average(b) - this.average(a) || a.name.localeCompare(b.name, 'it-IT', { sensitivity: 'base' }))
  },
  sortByFantaAverage(players: StatPlayer[]): StatPlayer[] {
    return [...players].sort((a, b) =>
      this.fantaAverage(b) - this.fantaAverage(a) || a.name.localeCompare(b.name, 'it-IT', { sensitivity: 'base' }))
  },
  groupByRole(players: StatPlayer[]): Partial<Record<Role, StatPlayer[]>> {
    const result: Partial<Record<Role, StatPlayer[]>> = {}
    for (const player of players) {
      const current = result[player.role] ?? []
      result[player.role] = [...current, player]
    }
    return result
  },
}

function createStatPlayer(realPlayer: RealPlayer): StatPlayer {
  return {
    ...cloneRealPlayer(realPlayer),
    summatory: 0,
    fantaSummatory: 0,
    withVote: 0,
    withoutVote: 0,
    noPlayed: 0,
    withSpecial: 0,
    goals: 0,
    penalties: 0,
    assists: 0,
    stoppedPenalties: 0,
    sufferedGoals: 0,
    wrongedPenalties: 0,
    ownGoals: 0,
    yellowCards: 0,
    redCards: 0,
    enoughVotes: 0,
    manOfTheMatch: 0,
    injured: 0,
    games: [],
  }
}

function applyVoteToStats(
  player: StatPlayer,
  votedPlayer: VotedRealPlayer | undefined,
  serieADay: number,
  settings: LeagueSetting,
): StatPlayerGame {
  if (!votedPlayer) {
    player.noPlayed += 1
    return { serieADay, vote: null, positiveness: -2 }
  }

  const vote = votedPlayer.vote
  const game: StatPlayerGame = {
    serieADay,
    vote: vote?.hasVote === true ? vote.value : null,
    positiveness: 0,
  }
  if (!vote) {
    player.noPlayed += 1
    game.positiveness -= 2
    return game
  }
  if (!vote.hasVote) {
    player.withoutVote += 1
    game.positiveness -= 2
    return game
  }

  player.withVote += 1
  player.penalties += vote.penalty
  if (vote.penalty > 0) game.positiveness += 2

  player.sufferedGoals += vote.sufferedGoal
  if (vote.sufferedGoal > 0) game.positiveness -= 1
  if (player.role === Role.GoalKeeper && vote.sufferedGoal === 0) game.positiveness += 1

  player.stoppedPenalties += vote.stoppedPenalty
  if (vote.stoppedPenalty > 0) game.positiveness += 2

  player.assists += vote.assist
  if (vote.assist > 0) game.positiveness += 1

  player.ownGoals += vote.ownGoal
  if (vote.ownGoal > 0) game.positiveness -= 2

  player.goals += vote.goal
  if (vote.goal > 0) game.positiveness += 2

  player.wrongedPenalties += vote.wrongedPenalty
  if (vote.wrongedPenalty > 0) game.positiveness -= 2

  if (vote.status === Behaviour.RedCard) {
    player.redCards += 1
    game.positiveness -= 2
  }
  if (vote.status === Behaviour.YellowCard) {
    player.yellowCards += 1
    game.positiveness -= 1
  }
  if (vote.value >= 6) {
    player.enoughVotes += 1
    if (player.role === Role.GoalKeeper || player.role === Role.Defensor) game.positiveness += 1
  }
  if (vote.manOfTheMatch) {
    player.manOfTheMatch += 1
    game.positiveness += 1
  }
  if (vote.injured) {
    player.injured += 1
    game.positiveness -= 2
  }

  player.summatory += vote.value
  const finalValue = calculateVoteValue(player.role, vote, settings)
  player.fantaSummatory += finalValue.value
  if (finalValue.special) {
    player.withSpecial += 1
    game.positiveness += 1
  }
  return game
}

function indexVotes(players: VotedRealPlayer[], serieADay: number): Map<string, VotedRealPlayer> {
  const result = new Map<string, VotedRealPlayer>()
  for (const player of players) {
    const key = getPlayerKey(player.name)
    if (!key) throw new Error(`Invalid vote player key on Serie A day ${serieADay}`)
    if (result.has(key)) throw new Error(`Duplicate official vote player key '${key}' on Serie A day ${serieADay}`)
    result.set(key, player)
  }
  return result
}

function validateDay(day: number): void {
  if (!Number.isInteger(day) || day < 1 || day > 38) throw new Error('Serie A day must be between 1 and 38')
}
