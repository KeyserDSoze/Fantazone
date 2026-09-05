import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CalendarHelper,
  GameResultHelper,
  GameResultType,
  type Calendar,
  type GameResult,
  type LeagueSetting,
} from '../../src/domain/src/index'

const calendar: Calendar = {
  year: 15,
  rounds: {
    '2-return': [{
      serieADay: 4,
      number: 2,
      games: [{ id: 'game-2', number: 2, home: 'Alpha', homeOwner: 'a@example.test', away: 'Gamma', awayOwner: 'c@example.test', result: null }],
    }],
    '1-first': [{
      serieADay: 3,
      number: 1,
      games: [{
        id: 'game-1',
        number: 1,
        home: 'Alpha',
        homeOwner: 'a@example.test',
        away: 'Beta',
        awayOwner: 'b@example.test',
        result: {
          home: { value: 72, defensiveBonus: false, goodPeople: false, ownGoal: false },
          away: { value: 65.5, defensiveBonus: true, goodPeople: false, ownGoal: false },
          isCancelled: false,
          homeGoals: 2,
          awayGoals: 0,
        },
      }],
    }],
  },
}

test('calendar JSON exposes readable day, game and result properties directly', () => {
  const json = JSON.parse(JSON.stringify(calendar))
  assert.equal(json.year, 15)
  assert.equal(json.rounds['1-first'][0].serieADay, 3)
  assert.equal(json.rounds['1-first'][0].games[0].homeOwner, 'a@example.test')
  assert.equal(json.rounds['1-first'][0].games[0].result.home.value, 72)
  assert.equal(json.rounds['1-first'][0].games[0].result.away.defensiveBonus, true)
  assert.equal('y' in json, false)
})

test('preserves round/day/game helpers including case-insensitive team lookup', () => {
  assert.deepEqual(CalendarHelper.getAllRoundKeys(calendar), ['1-first', '2-return'])
  assert.deepEqual(CalendarHelper.getAllDays(calendar).map(day => day.number), [1, 2])
  assert.equal(CalendarHelper.getDayByNumber(calendar, 2)?.serieADay, 4)
  assert.deepEqual(CalendarHelper.getGamesForTeam(calendar, 'ALPHA').map(game => game.id), ['game-1', 'game-2'])
  assert.deepEqual(CalendarHelper.getPendingGames(calendar).map(game => game.id), ['game-2'])
})

test('preserves result-type and has-value behavior', () => {
  const result = calendar.rounds['1-first'][0].games[0].result
  assert.equal(GameResultHelper.hasValue(result), true)
  assert.equal(GameResultHelper.getResultType(result), GameResultType.HomeWon)
  assert.equal(GameResultHelper.getResultType(null), GameResultType.Tie)
})

test('preserves Fantasoccer goal thresholds and own-goal difference rule', () => {
  const settings = {
    pointForFirstGoal: 66,
    pointForNextGoal: 6,
    differencePointForOwnGoal: 6,
  } as LeagueSetting

  const standard: GameResult = {
    home: { value: 72, defensiveBonus: false, goodPeople: false, ownGoal: false },
    away: { value: 65.5, defensiveBonus: false, goodPeople: false, ownGoal: false },
    isCancelled: false,
    homeGoals: 0,
    awayGoals: 0,
  }
  assert.deepEqual(GameResultHelper.calculateGoals(standard, settings), { home: 2, away: 0 })

  const differenceGoal: GameResult = {
    ...standard,
    home: { ...standard.home, value: 65 },
    away: { ...standard.away, value: 58 },
  }
  assert.deepEqual(GameResultHelper.calculateGoals(differenceGoal, settings), { home: 1, away: 0 })
})
