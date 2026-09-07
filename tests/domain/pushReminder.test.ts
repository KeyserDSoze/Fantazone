import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEPLOYMENT_REMINDER_WINDOW_MS,
  emptyDeploymentReminderMarker,
  getDeploymentReminderTarget,
  hasDeploymentReminderBeenSent,
  markDeploymentReminderSent,
  type RealCalendar,
  type RealDay,
} from '../../src/domain/src/index'

function calendar(kickoff: string, delayed = false): RealCalendar {
  return {
    year: 15,
    days: [
      completedDay(1, '2026-08-22T18:45:00.000Z'),
      completedDay(2, '2026-08-29T18:45:00.000Z'),
      {
        year: 15,
        serieADay: 3,
        games: [{
          home: { name: 'Roma', abbreviation: 'ROM' },
          away: { name: 'Milan', abbreviation: 'MIL' },
          date: kickoff,
          homeGoals: null,
          awayGoals: null,
          delayed,
        }],
      },
    ],
  }
}

function completedDay(serieADay: number, date: string): RealDay {
  return {
    year: 15,
    serieADay,
    games: [{
      home: { name: 'Inter', abbreviation: 'INT' },
      away: { name: 'Como', abbreviation: 'COM' },
      date,
      homeGoals: 1,
      awayGoals: 0,
      delayed: false,
    }],
  }
}

test('deployment reminder opens only inside the eight-hour pre-kickoff window', () => {
  const kickoff = new Date('2026-09-12T18:45:00.000Z')
  const inside = new Date(kickoff.getTime() - DEPLOYMENT_REMINDER_WINDOW_MS + 60_000)
  const boundary = new Date(kickoff.getTime() - DEPLOYMENT_REMINDER_WINDOW_MS)

  assert.deepEqual(getDeploymentReminderTarget(calendar(kickoff.toISOString()), inside), {
    year: 15,
    serieADay: 3,
    kickoffAt: kickoff.toISOString(),
  })
  assert.equal(getDeploymentReminderTarget(calendar(kickoff.toISOString()), boundary), null)
})

test('deployment reminder ignores delayed games and never fires after kickoff', () => {
  const kickoff = new Date('2026-09-12T18:45:00.000Z')
  assert.equal(getDeploymentReminderTarget(calendar(kickoff.toISOString(), true), new Date('2026-09-12T12:00:00.000Z')), null)
  assert.equal(getDeploymentReminderTarget(calendar(kickoff.toISOString()), new Date('2026-09-12T19:00:00.000Z')), null)
})

test('deployment reminder marker deduplicates recipients by normalized email', () => {
  const marker = emptyDeploymentReminderMarker({ year: 15, serieADay: 3 }, new Date('2026-09-12T10:00:00.000Z'))
  const once = markDeploymentReminderSent(marker, ' Ale@Example.com ', new Date('2026-09-12T10:01:00.000Z'))
  const twice = markDeploymentReminderSent(once, 'ale@example.com', new Date('2026-09-12T10:02:00.000Z'))
  assert.deepEqual(twice.sentEmails, ['ale@example.com'])
  assert.equal(hasDeploymentReminderBeenSent(twice, 'ALE@example.com'), true)
})
