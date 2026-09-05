import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getFormationPropagationWindow,
  type RealCalendar,
} from '../../src/domain/src/index'

const NOW = new Date('2026-09-05T18:00:00Z')

test('formation propagation uses the last completed day when nothing is live', () => {
  const calendar = realCalendar([
    [7, '2026-09-04T18:00:00Z'],
    [8, '2026-09-10T18:00:00Z'],
  ])
  assert.deepEqual(getFormationPropagationWindow(calendar, NOW), {
    sourceSerieADay: 7,
    targetSerieADay: 8,
    source: 'last-completed',
  })
})

test('formation propagation prefers the live day over the previous completed day', () => {
  const calendar = realCalendar([
    [7, '2026-09-04T18:00:00Z'],
    [8, '2026-09-05T17:50:00Z'],
  ])
  assert.deepEqual(getFormationPropagationWindow(calendar, NOW), {
    sourceSerieADay: 8,
    targetSerieADay: 9,
    source: 'live',
  })
})

test('formation propagation never creates day 39', () => {
  const calendar = realCalendar([[38, '2026-09-04T18:00:00Z']])
  assert.equal(getFormationPropagationWindow(calendar, NOW), null)
})

test('formation propagation is a no-op when no day has started/completed', () => {
  const calendar = realCalendar([[1, '2026-09-10T18:00:00Z']])
  assert.equal(getFormationPropagationWindow(calendar, NOW), null)
})

function realCalendar(days: Array<[number, string]>): RealCalendar {
  return {
    year: 15,
    days: days.map(([serieADay, date]) => ({
      year: 15,
      serieADay,
      games: [{
        home: { name: 'Roma', abbreviation: 'ROM' },
        away: { name: 'Milan', abbreviation: 'MIL' },
        date,
        homeGoals: null,
        awayGoals: null,
        delayed: false,
      }],
    })),
  }
}
