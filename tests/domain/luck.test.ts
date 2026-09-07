import assert from 'node:assert/strict'
import test from 'node:test'
import { LuckCalculator, type Calendar, type GameResult } from '../../src/domain/src/index'

function result(homeValue: number, awayValue: number, homeGoals: number, awayGoals: number): GameResult {
  return {
    home: { value: homeValue, defensiveBonus: false, goodPeople: false, ownGoal: false },
    away: { value: awayValue, defensiveBonus: false, goodPeople: false, ownGoal: false },
    isCancelled: false,
    homeGoals,
    awayGoals,
  }
}

const calendar: Calendar = {
  year: 15,
  rounds: {
    '@': [{
      serieADay: 1,
      number: 1,
      games: [
        { id: 'g1', number: 1, home: 'Alpha', homeOwner: 'alpha@example.test', away: 'Beta', awayOwner: 'beta@example.test', result: result(65, 60, 1, 0) },
        { id: 'g2', number: 1, home: 'Delta', homeOwner: 'delta@example.test', away: 'Gamma', awayOwner: 'gamma@example.test', result: result(80, 75, 2, 1) },
      ],
    }],
  },
}

test('ports the legacy under-66 and bottom-three lucky-win events', () => {
  const luck = LuckCalculator.calculateTeamLuck(calendar, '@').get('alpha@example.test')
  assert.ok(luck)
  assert.equal(luck.gamesPlayed, 1)
  assert.ok(luck.events.some(event => event.type === 'win-vs-worst' && event.points === 5))
  assert.ok(luck.events.some(event => event.type === 'win-as-worst' && event.points === 3))
  assert.equal(luck.totalLuck, 8)
  assert.equal(luck.avgLuck, 8)
  assert.equal(LuckCalculator.formatLuck(luck.avgLuck), '+800%')
})

test('stacks narrow/top-three/opponent-strength unlucky events like the legacy calculator', () => {
  const luck = LuckCalculator.calculateTeamLuck(calendar, '@').get('gamma@example.test')
  assert.ok(luck)
  assert.ok(luck.events.some(event => event.type === 'loss-narrow' && event.points === -1))
  assert.ok(luck.events.some(event => event.type === 'loss-as-top3' && event.points === -4))
  assert.ok(luck.events.some(event => event.type === 'loss-as-top3' && event.points === -3))
  assert.equal(luck.totalLuck, -8)
})

test('ignores cancelled or completely unplayed games', () => {
  const ignored: Calendar = {
    year: 15,
    rounds: {
      '@': [{
        serieADay: 1,
        number: 1,
        games: [
          { id: 'cancelled', number: 1, home: 'A', homeOwner: 'a', away: 'B', awayOwner: 'b', result: { ...result(70, 65, 1, 0), isCancelled: true } },
          { id: 'empty', number: 1, home: 'C', homeOwner: 'c', away: 'D', awayOwner: 'd', result: result(0, 0, 0, 0) },
        ],
      }],
    },
  }
  assert.equal(LuckCalculator.calculateTeamLuck(ignored, '@').size, 0)
})
