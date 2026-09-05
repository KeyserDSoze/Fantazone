import assert from 'node:assert/strict'
import test from 'node:test'
import { RealCalendarHelper, RealGameHelper, type RealCalendar, type RealGame } from '../../src/domain/src/index'

const calendar: RealCalendar = {
  year: 2026,
  days: [
    {
      year: 2026,
      serieADay: 1,
      games: [
        game('Roma', 'Milan', '2026-08-22T16:30:00Z'),
        game('Inter', 'Napoli', '2026-08-22T18:45:00Z'),
      ],
    },
    {
      year: 2026,
      serieADay: 2,
      games: [
        game('Roma', 'Inter', '2026-08-29T16:30:00Z'),
        game('Milan', 'Napoli', '2026-08-29T18:45:00Z'),
      ],
    },
    {
      year: 2026,
      serieADay: 3,
      games: [game('Roma', 'Napoli', '2026-09-05T18:45:00Z')],
    },
  ],
}

test('projects the live Serie A day from first kickoff through the legacy day tail', () => {
  const duringFirstMatch = new Date('2026-08-29T17:00:00Z')
  const context = RealCalendarHelper.context(calendar, duringFirstMatch)
  assert.equal(context.liveDay?.serieADay, 2)
  assert.equal(context.liveSerieADay, 2)
  assert.equal(context.nextSerieADay, 3)
  assert.equal(context.isLive, true)
  assert.equal(context.liveGames.length, 1)
})

test('keeps the day active between matches but only reports games actually live', () => {
  const betweenMatches = new Date('2026-08-29T18:40:00Z')
  assert.equal(RealCalendarHelper.getLiveSerieADay(calendar, betweenMatches), 2)
  assert.equal(RealCalendarHelper.isDuringSerieADay(calendar, betweenMatches), true)
  assert.equal(RealCalendarHelper.getLiveGames(calendar, betweenMatches).length, 1)
})

test('uses last completed day when there is no live day and resolves the immediate next day', () => {
  const afterDayTwo = new Date('2026-08-30T12:00:00Z')
  assert.equal(RealCalendarHelper.getLiveDay(calendar, afterDayTwo), null)
  assert.equal(RealCalendarHelper.getLastDay(calendar, afterDayTwo)?.serieADay, 2)
  assert.equal(RealCalendarHelper.getNextDay(calendar, afterDayTwo)?.serieADay, 3)
})

test('excludes delayed games from live and completion calculations', () => {
  const changed = structuredClone(calendar)
  changed.days[2].games[0].delayed = true
  const now = new Date('2026-09-05T19:00:00Z')
  assert.equal(RealCalendarHelper.getLiveSerieADay(changed, now), 0)
  assert.equal(RealCalendarHelper.isLive(changed, now), false)
})

test('does not persist Date objects and still exposes the legacy played predicate', () => {
  const realGame = game('Roma', 'Milan', '2026-09-05T18:45:00Z')
  assert.equal(typeof realGame.date, 'string')
  assert.equal(RealGameHelper.isPlayed(realGame, new Date('2026-09-05T18:45:01Z')), true)
  realGame.delayed = true
  assert.equal(RealGameHelper.isPlayed(realGame, new Date('2026-09-05T20:00:00Z')), false)
})

function game(home: string, away: string, date: string): RealGame {
  return {
    home: { name: home, abbreviation: home.slice(0, 3).toUpperCase() },
    away: { name: away, abbreviation: away.slice(0, 3).toUpperCase() },
    date,
    homeGoals: null,
    awayGoals: null,
    delayed: false,
  }
}
