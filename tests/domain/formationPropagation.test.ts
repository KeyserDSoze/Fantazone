import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getFormationPropagationWindow,
  getFormationSnapshotTargetSerieADay,
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

test('formation snapshot targets the current day strictly before its first kickoff', () => {
  const calendar = realCalendar([
    [8, '2026-09-05T18:00:00Z'],
    [9, '2026-09-12T18:00:00Z'],
  ])
  assert.equal(
    getFormationSnapshotTargetSerieADay(calendar, new Date('2026-09-05T17:59:59Z')),
    8,
  )
})

test('formation snapshot rolls to the next day at the exact first kickoff', () => {
  const calendar = realCalendar([
    [8, '2026-09-05T18:00:00Z'],
    [9, '2026-09-12T18:00:00Z'],
  ])
  assert.equal(
    getFormationSnapshotTargetSerieADay(calendar, new Date('2026-09-05T18:00:00Z')),
    9,
  )
})

test('formation snapshot never creates a day after 38', () => {
  const calendar = realCalendar([[38, '2026-09-05T18:00:00Z']])
  assert.equal(
    getFormationSnapshotTargetSerieADay(calendar, new Date('2026-09-05T18:00:00Z')),
    null,
  )
})

test('formation snapshot uses the first non-delayed kickoff of each day', () => {
  const calendar = realCalendar([[8, '2026-09-05T20:45:00Z']])
  calendar.days[0].games.unshift({
    home: { name: 'Napoli', abbreviation: 'NAP' },
    away: { name: 'Inter', abbreviation: 'INT' },
    date: '2026-09-05T18:00:00Z',
    homeGoals: null,
    awayGoals: null,
    delayed: true,
  })
  assert.equal(
    getFormationSnapshotTargetSerieADay(calendar, new Date('2026-09-05T19:00:00Z')),
    8,
  )
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
