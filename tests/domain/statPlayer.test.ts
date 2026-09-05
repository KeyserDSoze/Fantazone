import assert from 'node:assert/strict'
import test from 'node:test'
import {
  Behaviour,
  Role,
  StatPlayerHelper,
  calculateVoteValue,
  createEmptyVote,
  generatePlayerStatistics,
  type RealPlayer,
  type RealPlayers,
  type Vote,
  type VotedRealPlayer,
  type VotedRealPlayers,
} from '../../src/domain/src/index'

test('TeamCalculator FinalValue parity uses default bonuses and goalkeeper clean-sheet special', () => {
  const forward = vote(Role.Forward, { value: 6, goal: 1, assist: 1, status: Behaviour.YellowCard })
  assert.deepEqual(calculateVoteValue(Role.Forward, forward), { value: 9.5, special: false })

  const goalkeeper = vote(Role.GoalKeeper, { value: 6, sufferedGoal: 0 })
  assert.deepEqual(calculateVoteValue(Role.GoalKeeper, goalkeeper), { value: 7, special: true })
})

test('statistics reducer mirrors missing/no-vote/voted counters, fantasy totals and positivity', () => {
  const realPlayers: RealPlayers = {
    year: 15,
    players: [realPlayer('Goal Keeper', Role.GoalKeeper, 'Roma'), realPlayer('Goal Getter', Role.Forward, 'Inter')],
  }
  const votes = new Map<number, VotedRealPlayers | null>([
    [1, voteDocument(15, 1, [
      votedPlayer(realPlayers.players[0], vote(Role.GoalKeeper, { value: 6, manOfTheMatch: true })),
      votedPlayer(realPlayers.players[1], vote(Role.Forward, { value: 5.5, goal: 1, status: Behaviour.YellowCard })),
    ])],
    [2, voteDocument(15, 2, [
      votedPlayer(realPlayers.players[0], vote(Role.GoalKeeper, { value: 55, hasVote: false })),
    ])],
    [3, null],
  ])

  const result = generatePlayerStatistics({ realPlayers, officialVotesByDay: votes, untilSerieADay: 3 })
  const goalkeeper = result.players[0]
  const forward = result.players[1]

  assert.deepEqual(goalkeeper.games.map(game => game.serieADay), [3, 2, 1])
  assert.deepEqual(goalkeeper.games.map(game => game.positiveness), [-2, -2, 4])
  assert.equal(goalkeeper.noPlayed, 1)
  assert.equal(goalkeeper.withoutVote, 1)
  assert.equal(goalkeeper.withVote, 1)
  assert.equal(goalkeeper.enoughVotes, 1)
  assert.equal(goalkeeper.manOfTheMatch, 1)
  assert.equal(goalkeeper.withSpecial, 1)
  assert.equal(goalkeeper.summatory, 6)
  assert.equal(goalkeeper.fantaSummatory, 9)
  assert.equal(StatPlayerHelper.average(goalkeeper), 6)
  assert.equal(StatPlayerHelper.fantaAverage(goalkeeper), 9)

  assert.equal(forward.noPlayed, 2)
  assert.equal(forward.withVote, 1)
  assert.equal(forward.goals, 1)
  assert.equal(forward.yellowCards, 1)
  assert.equal(forward.games[2].positiveness, 1)
  assert.equal(forward.fantaSummatory, 8)
})

test('statistics reducer rejects mismatched and duplicate official vote documents', () => {
  const realPlayers: RealPlayers = { year: 15, players: [realPlayer('Same Name', Role.Forward, 'Roma')] }
  assert.throws(
    () => generatePlayerStatistics({
      realPlayers,
      untilSerieADay: 1,
      officialVotesByDay: new Map([[1, voteDocument(16, 1, [])]]),
    }),
    /mismatch/,
  )

  const duplicate = votedPlayer(realPlayers.players[0], vote(Role.Forward))
  assert.throws(
    () => generatePlayerStatistics({
      realPlayers,
      untilSerieADay: 1,
      officialVotesByDay: new Map([[1, voteDocument(15, 1, [duplicate, duplicate])]]),
    }),
    /Duplicate official vote player key/,
  )
})

function realPlayer(name: string, role: Role, team: string): RealPlayer {
  return {
    name,
    team: { name: team, abbreviation: team.slice(0, 3).toLowerCase() },
    role,
    isActive: true,
    visible: true,
  }
}

function votedPlayer(player: RealPlayer, playerVote: Vote | null): VotedRealPlayer {
  return { ...player, team: { ...player.team }, vote: playerVote }
}

function voteDocument(year: number, serieADay: number, players: VotedRealPlayer[]): VotedRealPlayers {
  return { year, serieADay, players }
}

function vote(role: Role, overrides: Partial<Vote> = {}): Vote {
  return {
    ...createEmptyVote(role),
    hasVote: true,
    isFinal: true,
    ...overrides,
    role,
  }
}
