import assert from 'node:assert/strict'
import test from 'node:test'
import {
  enhanceRank,
  enhanceRankWithTeamPositions,
  RankHelper,
  type Rank,
} from '../../src/domain/src/index'

const rank: Rank = {
  serieADay: 7,
  rounds: {
    '@': [
      { name: 'Alpha', owner: 'alpha@example.test', point: 10, victories: 3, draws: 1, defeats: 1, goal: 8, sufferedGoal: 4, valuePoint: 345, sufferedValuePoint: 321, plusMoney: 20, money: 100, valueAssets: 120 },
      { name: 'Beta', owner: 'beta@example.test', point: 13, victories: 4, draws: 1, defeats: 0, goal: 10, sufferedGoal: 3, valuePoint: 360, sufferedValuePoint: 300, plusMoney: 5, money: 90, valueAssets: 95 },
      { name: 'Gamma', owner: 'gamma@example.test', point: 5, victories: 1, draws: 2, defeats: 2, goal: 4, sufferedGoal: 7, valuePoint: 310, sufferedValuePoint: 335, plusMoney: 50, money: 80, valueAssets: 130 },
    ],
    cup: [
      { name: 'Alpha', owner: 'alpha@example.test', point: 3, victories: 1, draws: 0, defeats: 0, goal: 2, sufferedGoal: 0, valuePoint: 70, sufferedValuePoint: 60, plusMoney: 0, money: 100, valueAssets: 100 },
    ],
  },
}

test('ranking JSON persists readable fields and valueAssets directly', () => {
  const json = JSON.parse(JSON.stringify(rank))
  assert.equal(json.serieADay, 7)
  assert.equal(json.rounds['@'][0].name, 'Alpha')
  assert.equal(json.rounds['@'][0].valueAssets, 120)
  assert.equal('d' in json, false)
})

test('preserves point ordering, positions and value-assets ordering without mutating the source', () => {
  const originalOrder = rank.rounds['@'].map(team => team.name)
  assert.deepEqual(RankHelper.getTeamsSortedByPoints(rank, '@').map(team => team.name), ['Beta', 'Alpha', 'Gamma'])
  assert.equal(RankHelper.getTeamPosition(rank, '@', 'alpha@example.test'), 2)
  assert.equal(RankHelper.getTeamPosition(rank, '@', 'missing@example.test'), -1)
  assert.deepEqual(RankHelper.getTeamsSortedByValueAssets(rank, '@').map(team => team.name), ['Gamma', 'Alpha', 'Beta'])
  assert.deepEqual(rank.rounds['@'].map(team => team.name), originalOrder)
})

test('preserves computed ranking statistics and enhanced positions', () => {
  const alpha = rank.rounds['@'][0]
  assert.equal(RankHelper.getGoalDifference(alpha), 4)
  assert.equal(RankHelper.getTotalGamesPlayed(alpha), 5)
  assert.equal(RankHelper.getPointsPerGame(alpha), 2)

  const enhanced = enhanceRank(rank)
  assert.deepEqual(enhanced.availableRounds, ['@', 'cup'])
  assert.equal(enhanced.roundTeamCounts['@'], 3)
  assert.equal(enhanced.totalTeamsCount, 4)

  const positioned = enhanceRankWithTeamPositions(rank)['@']
  assert.deepEqual(positioned.map(team => [team.name, team.position]), [['Beta', 1], ['Alpha', 2], ['Gamma', 3]])
})

test('adds ranked teams with the same aggregate semantics used by Fantasoccer', () => {
  const total = RankHelper.addRankedTeams(rank.rounds['@'][0], rank.rounds.cup[0])
  assert.equal(total.name, 'Alpha')
  assert.equal(total.owner, 'alpha@example.test')
  assert.equal(total.point, 13)
  assert.equal(total.victories, 4)
  assert.equal(total.goal, 10)
  assert.equal(total.valueAssets, 220)
})
