import assert from 'node:assert/strict'
import test from 'node:test'
import {
  enhanceRank,
  enhanceRankWithTeamPositions,
  mapRankToRawRank,
  mapRawRankToRank,
  RankHelper,
  type RankRaw,
} from '../../src/domain/src/index'

const raw: RankRaw = {
  d: 7,
  r: {
    '@': [
      { n: 'Alpha', o: 'alpha@example.test', p: 10, v: 3, d: 1, e: 1, g: 8, s: 4, x: 345, w: 321, z: 20, m: 100 },
      { n: 'Beta', o: 'beta@example.test', p: 13, v: 4, d: 1, e: 0, g: 10, s: 3, x: 360, w: 300, z: 5, m: 90 },
      { n: 'Gamma', o: 'gamma@example.test', p: 5, v: 1, d: 2, e: 2, g: 4, s: 7, x: 310, w: 335, z: 50, m: 80 },
    ],
    cup: [
      { n: 'Alpha', o: 'alpha@example.test', p: 3, v: 1, d: 0, e: 0, g: 2, s: 0, x: 70, w: 60, z: 0, m: 100 },
    ],
  },
}

test('maps compact ranking data and computes valueAssets exactly like Fantasoccer', () => {
  const rank = mapRawRankToRank(raw)
  const alpha = rank.rounds['@'][0]

  assert.equal(rank.serieADay, 7)
  assert.equal(alpha.name, 'Alpha')
  assert.equal(alpha.valueAssets, 120)
  assert.deepEqual(mapRankToRawRank(rank), raw)
})

test('preserves point ordering, positions and value-assets ordering without mutating the source', () => {
  const rank = mapRawRankToRank(raw)
  const originalOrder = rank.rounds['@'].map(team => team.name)

  assert.deepEqual(RankHelper.getTeamsSortedByPoints(rank, '@').map(team => team.name), ['Beta', 'Alpha', 'Gamma'])
  assert.equal(RankHelper.getTeamPosition(rank, '@', 'alpha@example.test'), 2)
  assert.equal(RankHelper.getTeamPosition(rank, '@', 'missing@example.test'), -1)
  assert.deepEqual(RankHelper.getTeamsSortedByValueAssets(rank, '@').map(team => team.name), ['Gamma', 'Alpha', 'Beta'])
  assert.deepEqual(rank.rounds['@'].map(team => team.name), originalOrder)
})

test('preserves computed ranking statistics and enhanced positions', () => {
  const rank = mapRawRankToRank(raw)
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
  const rank = mapRawRankToRank(raw)
  const alpha = rank.rounds['@'][0]
  const cupAlpha = rank.rounds.cup[0]
  const total = RankHelper.addRankedTeams(alpha, cupAlpha)

  assert.equal(total.name, 'Alpha')
  assert.equal(total.owner, 'alpha@example.test')
  assert.equal(total.point, 13)
  assert.equal(total.victories, 4)
  assert.equal(total.goal, 10)
  assert.equal(total.valueAssets, 220)
})
