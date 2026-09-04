import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CalendarHelper,
  GameResultHelper,
  GameResultType,
  mapRawCalendarToCalendar,
  type CalendarRaw,
  type GameResult,
  type LeagueSetting,
} from '../../src/domain/src/index'

const rawCalendar: CalendarRaw = {
  y: 15,
  r: {
    '2-return': [
      {
        a: 4,
        n: 2,
        g: [
          { i: 'game-2', n: 2, h: 'Alpha', o: 'a@example.test', a: 'Gamma', u: 'c@example.test', r: null },
        ],
      },
    ],
    '1-first': [
      {
        a: 3,
        n: 1,
        g: [
          {
            i: 'game-1',
            n: 1,
            h: 'Alpha',
            o: 'a@example.test',
            a: 'Beta',
            u: 'b@example.test',
            r: {
              h: { v: 72, d: false, g: false, o: false },
              a: { v: 65.5, d: true, g: false, o: false },
              i: false,
              g: 2,
              l: 0,
            },
          },
        ],
      },
    ],
  },
}

test('maps the compact Fantasoccer calendar shape without changing semantics', () => {
  const calendar = mapRawCalendarToCalendar(rawCalendar)

  assert.equal(calendar.year, 15)
  assert.equal(calendar.rounds['1-first'][0].serieADay, 3)
  assert.equal(calendar.rounds['1-first'][0].games[0].homeOwner, 'a@example.test')
  assert.equal(calendar.rounds['1-first'][0].games[0].result?.home.value, 72)
  assert.equal(calendar.rounds['1-first'][0].games[0].result?.away.defensiveBonus, true)
})

test('preserves round/day/game helpers including case-insensitive team lookup', () => {
  const calendar = mapRawCalendarToCalendar(rawCalendar)

  assert.deepEqual(CalendarHelper.getAllRoundKeys(calendar), ['1-first', '2-return'])
  assert.deepEqual(CalendarHelper.getAllDays(calendar).map(day => day.number), [1, 2])
  assert.equal(CalendarHelper.getDayByNumber(calendar, 2)?.serieADay, 4)
  assert.deepEqual(CalendarHelper.getGamesForTeam(calendar, 'ALPHA').map(game => game.id), ['game-1', 'game-2'])
  assert.deepEqual(CalendarHelper.getPendingGames(calendar).map(game => game.id), ['game-2'])
})

test('preserves result-type and has-value behavior', () => {
  const result = mapRawCalendarToCalendar(rawCalendar).rounds['1-first'][0].games[0].result

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
