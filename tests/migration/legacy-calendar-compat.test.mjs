import test from 'node:test'
import assert from 'node:assert/strict'
import { mapLegacyCalendarCompatible } from '../../scripts/migration/legacy-calendar-compat.mjs'

function calendarWithPoints(homePoint, awayPoint) {
  return {
    y: 12,
    r: {
      '@': [{
        a: 1,
        n: 1,
        g: [{
          i: 'game-1', n: 1, h: 'Home', o: 'home@example.com', a: 'Away', u: 'away@example.com',
          r: { h: homePoint, a: awayPoint, i: false, g: 0, l: 0 },
        }],
      }],
    },
  }
}

test('legacy Calendar null points are mapped to readable Point.Zero', () => {
  const result = mapLegacyCalendarCompatible(calendarWithPoints(null, null))
  const gameResult = result.rounds['@'][0].games[0].result
  assert.deepEqual(gameResult.home, { value: 0, defensiveBonus: false, goodPeople: false, ownGoal: false })
  assert.deepEqual(gameResult.away, { value: 0, defensiveBonus: false, goodPeople: false, ownGoal: false })
})

test('legacy Calendar keeps a real point when only the other side is null', () => {
  const result = mapLegacyCalendarCompatible(calendarWithPoints({ v: 71.5, d: true, g: false, o: false }, null))
  const gameResult = result.rounds['@'][0].games[0].result
  assert.equal(gameResult.home.value, 71.5)
  assert.equal(gameResult.home.defensiveBonus, true)
  assert.equal(gameResult.away.value, 0)
})

test('legacy Calendar rejects unknown non-null point shapes with a diagnostic value', () => {
  assert.throws(
    () => mapLegacyCalendarCompatible(calendarWithPoints(72.5, null)),
    /Unsupported legacy home point shape: number 72\.5/,
  )
})
