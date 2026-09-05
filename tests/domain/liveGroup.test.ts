import assert from 'node:assert/strict'
import test from 'node:test'
import {
  LiveGroupHelper,
  LiveLeagueHelper,
  mapRawLiveGroupToLiveGroup,
  type LiveGroupRaw,
} from '../../src/domain/src/index'

const raw: LiveGroupRaw = {
  n: 'Amici',
  l: [{
    i: 'league-a',
    l: 'Serie A',
    d: {
      '10': [{ a: 10, n: 10, g: [{ i: 'g10', n: 1, h: 'Alpha', o: 'ale@example.com', a: 'Beta', u: 'beta@example.com', r: null }] }],
      '2': { a: 2, n: 2, g: [{ i: 'g2', n: 1, h: 'Alpha', o: 'ale@example.com', a: 'Beta', u: 'beta@example.com', r: null }] },
      ignored: null,
    },
    r: { d: 10, r: { '@': [] } },
  }],
}

test('maps legacy DayRaw or DayRaw[] rounds without changing the raw contract', () => {
  const group = mapRawLiveGroupToLiveGroup(raw)
  const league = group.leagues[0]
  assert.equal(league.rounds['10'].number, 10)
  assert.equal(league.rounds['2'].number, 2)
  assert.equal(league.rounds.ignored, undefined)
  assert.deepEqual(LiveLeagueHelper.getRoundKeys(league), ['2', '10'])
  assert.equal(LiveLeagueHelper.getLatestRoundKey(league), '10')
})

test('enhances live group using existing calendar/rank behavior', () => {
  const group = mapRawLiveGroupToLiveGroup(raw)
  const enhanced = LiveGroupHelper.enhance(group)
  assert.equal(enhanced.leaguesWithRounds[0].pendingGames.length, 2)
  assert.equal(enhanced.totalPendingGames, 2)
  assert.equal(enhanced.leaguesWithRounds[0].enhancedRank?.serieADay, 10)
})
