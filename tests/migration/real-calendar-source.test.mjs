import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeLegacyRealCalendarRecord } from '../../scripts/migration/real-calendar-source.mjs'

function calendarRecord(season, { payloadYear = season, dayYear = season, date = '2024-08-17T18:30:00Z' } = {}) {
  return {
    container: 'realcalendar',
    blobName: `${season}.json`,
    key: season,
    value: {
      y: payloadYear,
      d: [{
        y: dayYear,
        a: 1,
        g: [{ h: { n: 'Genoa', a: 'gen' }, a: { n: 'Inter', a: 'int' }, d: date, g: 2, y: 2, e: false }],
      }],
    },
  }
}

test('uses the Azure/Rystem key to repair zero RealCalendar year fields when dates match the season', () => {
  const normalized = normalizeLegacyRealCalendarRecord(calendarRecord(13, { payloadYear: 0, dayYear: 0 }))
  assert.equal(normalized.ok, true)
  assert.equal(normalized.repaired, true)
  assert.equal(normalized.record.migrationRepair, true)
  assert.equal(normalized.record.value.y, 13)
  assert.equal(normalized.record.value.d[0].y, 13)
})

test('leaves an already coherent calendar unmarked', () => {
  const normalized = normalizeLegacyRealCalendarRecord(calendarRecord(13))
  assert.equal(normalized.ok, true)
  assert.equal(normalized.repaired, false)
  assert.equal(normalized.record.migrationRepair, false)
})

test('quarantines a RealCalendar that was overwritten by the following season', () => {
  const normalized = normalizeLegacyRealCalendarRecord(calendarRecord(12, {
    payloadYear: 0,
    dayYear: 12,
    date: '2024-08-18T18:30:00Z',
  }))
  assert.equal(normalized.ok, false)
  assert.equal(normalized.issue.reason, 'invalid-realcalendar-season')
  assert.equal(normalized.issue.targetPath, 'data/serie-a/calendars/12.json')
  assert.match(normalized.issue.detail, /outside season 12 \(2023\/24\)/)
})

test('rejects a non-zero payload season that disagrees with the Azure/Rystem key', () => {
  const normalized = normalizeLegacyRealCalendarRecord(calendarRecord(13, { payloadYear: 12 }))
  assert.equal(normalized.ok, false)
  assert.match(normalized.issue.detail, /Payload year 12 does not match Azure\/Rystem key 13/)
})

test('keeps late pandemic matches inside the prior season until the historical August 10 switch', () => {
  const normalized = normalizeLegacyRealCalendarRecord(calendarRecord(8, {
    payloadYear: 8,
    dayYear: 8,
    date: '2020-08-02T20:45:00Z',
  }))
  assert.equal(normalized.ok, true)
  assert.equal(normalized.record.value.y, 8)
})
