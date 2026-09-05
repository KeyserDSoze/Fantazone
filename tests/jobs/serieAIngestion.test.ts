import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { getCurrentSeasonYear } from '../../src/domain/src/index'
import {
  DEFAULT_GAZZETTA_CALENDAR_BASE_URL,
  buildCalendarDayUrl,
  ingestSerieACalendar,
  mapGazzettaCalendarDay,
} from '../../src/jobs/src/serieAIngestion'

const NOW = new Date('2026-09-05T12:00:00Z')
const CURRENT_SEASON = getCurrentSeasonYear(NOW)

test('maps Gazzetta response to readable RealDay preserving legacy score/status semantics', () => {
  const day = mapGazzettaCalendarDay({
    data: {
      games: [{
        matches: [
          match('FULL', '2026-08-22T18:45:00Z', 2, 1),
          match('POSTPONED', '2026-08-23T16:30:00Z', 4, 4, ' MILAN ', ' NAPOLI '),
          { status: 'LIVE', utcDate: 'bad-date', homeTeam: { teamName: '' }, awayTeam: { teamName: 'Roma' } },
        ],
      }],
    },
  }, CURRENT_SEASON, 1)

  assert.ok(day)
  assert.equal(day.year, CURRENT_SEASON)
  assert.equal(day.serieADay, 1)
  assert.equal(day.games.length, 2)
  assert.deepEqual(day.games[0], {
    home: { name: 'Roma', abbreviation: 'rom' },
    away: { name: 'Inter', abbreviation: 'int' },
    date: '2026-08-22T18:45:00.000Z',
    homeGoals: 2,
    awayGoals: 1,
    delayed: false,
  })
  assert.equal(day.games[1].home.name, 'Milan')
  assert.equal(day.games[1].away.name, 'Napoli')
  assert.equal(day.games[1].homeGoals, null)
  assert.equal(day.games[1].awayGoals, null)
  assert.equal(day.games[1].delayed, true)
})

test('builds the legacy Gazzetta calendar request while allowing a configurable base URL', () => {
  const url = new URL(buildCalendarDayUrl(DEFAULT_GAZZETTA_CALENDAR_BASE_URL, 7))
  assert.equal(`${url.origin}${url.pathname}`, 'https://api2-mtc.gazzetta.it/api/v1/sports/calendar')
  assert.equal(url.searchParams.get('day'), '7')
  assert.equal(url.searchParams.get('sportId'), '1')
  assert.equal(url.searchParams.get('competitionId'), '21')

  const overridden = new URL(buildCalendarDayUrl('https://example.test/custom', 3))
  assert.equal(`${overridden.origin}${overridden.pathname}`, 'https://example.test/custom/v1/sports/calendar')
})

test('full ingestion writes the current internal season id and all returned days', async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), 'fantazone-serie-a-'))
  const requested: number[] = []
  const result = await ingestSerieACalendar({
    repoRoot,
    now: NOW,
    fetchJson: async url => {
      const day = Number(new URL(url).searchParams.get('day'))
      requested.push(day)
      return { data: { games: [{ matches: [match('SCHEDULED', `2026-09-${String(Math.min(day, 28)).padStart(2, '0')}T18:45:00Z')] }] } }
    },
  })

  assert.equal(result.calendar.year, CURRENT_SEASON)
  assert.equal(result.calendar.days.length, 38)
  assert.deepEqual(requested, Array.from({ length: 38 }, (_, index) => index + 1))
  assert.equal(result.path.endsWith(join('data', 'serie-a', 'calendars', `${CURRENT_SEASON}.json`)), true)
  const persisted = JSON.parse(await readFile(result.path, 'utf8'))
  assert.equal(persisted.year, CURRENT_SEASON)
  assert.equal(persisted.days[37].serieADay, 38)
})

test('single-day ingestion replaces one day but refuses to create an incomplete calendar', async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), 'fantazone-serie-a-day-'))
  await assert.rejects(
    ingestSerieACalendar({ repoRoot, now: NOW, day: 4, fetchJson: async () => ({ data: { games: [] } }) }),
    /non esiste ancora/,
  )

  const directory = join(repoRoot, 'data', 'serie-a', 'calendars')
  const path = join(directory, `${CURRENT_SEASON}.json`)
  await mkdir(directory, { recursive: true })
  await writeFile(path, JSON.stringify({
    year: CURRENT_SEASON,
    days: [
      { year: CURRENT_SEASON, serieADay: 3, games: [] },
      { year: CURRENT_SEASON, serieADay: 4, games: [] },
      { year: CURRENT_SEASON, serieADay: 5, games: [] },
    ],
  }))

  const result = await ingestSerieACalendar({
    repoRoot,
    now: NOW,
    day: 4,
    fetchJson: async () => ({ data: { games: [{ matches: [match('LIVE', '2026-09-05T18:45:00Z', 1, 0)] }] } }),
  })
  assert.deepEqual(result.calendar.days.map(day => day.serieADay), [3, 4, 5])
  assert.equal(result.calendar.days[1].games[0].homeGoals, 1)
})

test('current-season source cannot silently label current data as a historical season', async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), 'fantazone-serie-a-season-'))
  await assert.rejects(
    ingestSerieACalendar({
      repoRoot,
      now: NOW,
      season: CURRENT_SEASON - 1,
      fetchJson: async () => ({ data: { games: [] } }),
    }),
    /stagione corrente/,
  )
})

function match(
  status: string,
  utcDate: string,
  homeScore: number | null = 0,
  awayScore: number | null = 0,
  homeName = 'ROMA',
  awayName = 'INTER',
) {
  return {
    status,
    utcDate,
    homeTeam: { teamName: homeName, shortTeamName: homeName.trim().slice(0, 3), score: homeScore },
    awayTeam: { teamName: awayName, shortTeamName: awayName.trim().slice(0, 3), score: awayScore },
  }
}
