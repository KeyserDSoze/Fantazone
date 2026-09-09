import test from 'node:test'
import assert from 'node:assert/strict'
import {
  historicalCalendarUrl,
  historicalSeasonSlug,
  mapHistoricalSerieACalendar,
  recoverHistoricalSerieACalendar,
} from '../../scripts/migration/historical-calendar-source.mjs'

function dateForDay(day, start = '2023-08-19T12:00:00Z') {
  const value = new Date(new Date(start).getTime() + (day - 1) * 7 * 24 * 60 * 60 * 1000)
  return value.toISOString().slice(0, 10)
}

function completeDocument(season = 12) {
  const start = season === 14 ? '2025-08-23T12:00:00Z' : '2023-08-19T12:00:00Z'
  const matches = []
  for (let day = 1; day <= 38; day++) {
    for (let game = 0; game < 10; game++) {
      matches.push({
        round: `Matchday ${day}`,
        date: dateForDay(day, start),
        time: game % 2 === 0 ? '18:30' : '20:45',
        team1: game % 2 === 0 ? 'Bologna FC 1909' : 'FC Internazionale Milano',
        team2: game % 2 === 0 ? 'Udinese Calcio' : 'AC Milan',
        score: game % 3 === 0 ? [1, 1] : { ft: [2, 0], ht: [1, 0] },
      })
    }
  }
  return { name: `Italian Serie A ${historicalSeasonSlug(season).replace('-', '/')}`, matches }
}

test('maps Fantazone season ids to OpenFootball season slugs', () => {
  assert.equal(historicalSeasonSlug(12), '2023-24')
  assert.equal(historicalSeasonSlug(14), '2025-26')
  assert.match(historicalCalendarUrl(12), /2023-24\/it\.1\.json$/)
})

test('maps a complete historical Serie A document into a validated legacy RealCalendar repair', () => {
  const record = mapHistoricalSerieACalendar(completeDocument(12), 12)
  assert.equal(record.key, 12)
  assert.equal(record.value.y, 12)
  assert.equal(record.value.d.length, 38)
  assert.equal(record.value.d[0].y, 12)
  assert.equal(record.value.d[0].g.length, 10)
  assert.equal(record.value.d[0].g[0].h.n, 'Bologna')
  assert.equal(record.value.d[0].g[0].a.n, 'Udinese')
  assert.equal(record.value.d[0].g[0].g, 1)
  assert.equal(record.value.d[0].g[0].y, 1)
  assert.equal(record.value.d[0].g[0].d, '2023-08-19T18:30:00')
  assert.equal(record.migrationRepair, true)
})

test('refuses incomplete historical fixture sources', () => {
  const document = completeDocument(12)
  document.matches.pop()
  assert.throws(() => mapHistoricalSerieACalendar(document, 12), /expected 380 games \/ 38 matchdays/)
})

test('refuses unknown team aliases instead of silently changing identities', () => {
  const document = completeDocument(12)
  document.matches[0].team1 = 'Unknown FC'
  assert.throws(() => mapHistoricalSerieACalendar(document, 12), /Unsupported OpenFootball Serie A team/)
})

test('fetches and marks a verified historical fallback as an imported-calendar repair', async () => {
  let requestedUrl = null
  const fetchImpl = async url => {
    requestedUrl = url
    return { ok: true, status: 200, json: async () => completeDocument(14) }
  }
  const result = await recoverHistoricalSerieACalendar(14, { fetchImpl })
  assert.equal(requestedUrl, historicalCalendarUrl(14))
  assert.equal(result.error, null)
  assert.equal(result.record.key, 14)
  assert.equal(result.record.migrationRepair, true)
  assert.equal(result.record.sourceHistoricalProvider, 'openfootball/football.json')
  assert.equal(result.record.sourceHistoricalUrl, result.url)
})
