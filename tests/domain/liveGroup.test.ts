import assert from 'node:assert/strict'
import test from 'node:test'
import {
  LiveGroupHelper,
  LiveLeagueHelper,
  type LiveGroup,
} from '../../src/domain/src/index'

const group: LiveGroup = {
  name: 'Amici',
  leagues: [{
    id: 'league-a',
    name: 'Serie A',
    rounds: {
      '10': {
        serieADay: 10,
        number: 10,
        games: [{ id: 'g10', number: 1, home: 'Alpha', homeOwner: 'ale@example.com', away: 'Beta', awayOwner: 'beta@example.com', result: null }],
      },
      '2': {
        serieADay: 2,
        number: 2,
        games: [{ id: 'g2', number: 1, home: 'Alpha', homeOwner: 'ale@example.com', away: 'Beta', awayOwner: 'beta@example.com', result: null }],
      },
    },
    rank: { serieADay: 10, rounds: { '@': [] } },
  }],
}

test('LiveGroup schema v2 uses readable fields and one CalendarDay per round', () => {
  const json = JSON.parse(JSON.stringify(group))
  assert.equal(json.name, 'Amici')
  assert.equal(json.leagues[0].id, 'league-a')
  assert.equal(json.leagues[0].rounds['10'].serieADay, 10)
  assert.equal(json.leagues[0].rounds['10'].games[0].homeOwner, 'ale@example.com')
  assert.equal('n' in json, false)
  assert.equal(Array.isArray(json.leagues[0].rounds['10']), false)
})

test('sorts numeric round keys and finds the latest round', () => {
  const league = group.leagues[0]
  assert.deepEqual(LiveLeagueHelper.getRoundKeys(league), ['2', '10'])
  assert.equal(LiveLeagueHelper.getLatestRoundKey(league), '10')
  assert.equal(LiveLeagueHelper.getRound(league, '2')?.number, 2)
})

test('enhances live group using existing Calendar and Rank behavior', () => {
  const enhanced = LiveGroupHelper.enhance(group)
  assert.equal(enhanced.leaguesWithRounds[0].pendingGames.length, 2)
  assert.equal(enhanced.totalPendingGames, 2)
  assert.equal(enhanced.leaguesWithRounds[0].enhancedRank?.serieADay, 10)
})
