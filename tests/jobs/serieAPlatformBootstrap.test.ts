import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { getCurrentSeasonYear } from '../../src/domain/src/index'
import {
  realCalendarDocumentPath,
  realPlayersDocumentPath,
  realTeamsDocumentPath,
  statPlayersDocumentPath,
} from '../../src/github/src/index'
import { bootstrapSerieAPlatformData } from '../../src/jobs/src/serieAPlatformBootstrap'

const NOW = new Date('2026-09-05T12:00:00Z')
const SEASON = getCurrentSeasonYear(NOW)
const TEAM_COUNT = 20

const teams = Array.from({ length: TEAM_COUNT }, (_, index) => ({
  name: `TEAM${String(index + 1).padStart(2, '0')}`,
  abbreviation: `t${String(index + 1).padStart(2, '0')}`,
}))

const playersHtml = `
<table>
<tr class="player-row"><span>Mario Rossi</span><td class="player-team">${teams[0].abbreviation}</td><span class="role" data-value="a"></span></tr>
<tr class="player-row"><span>Luca Bianchi</span><td class="player-team">${teams[1].abbreviation}</td><span class="role" data-value="p"></span></tr>
</table>`

test('bootstraps calendar, master data and initial stats in dependency order', async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), 'fantazone-platform-bootstrap-'))
  const events: string[] = []

  const result = await bootstrapSerieAPlatformData({
    repoRoot,
    now: NOW,
    fetchCalendarJson: async url => {
      const day = Number(new URL(url).searchParams.get('day'))
      events.push(`calendar:${day}`)
      return calendarResponse(day)
    },
    fetchPlayersText: async () => {
      events.push('players')
      return playersHtml
    },
  })

  assert.equal(result.calendar.calendar.year, SEASON)
  assert.equal(result.calendar.calendar.days.length, 38)
  assert.equal(result.master.teams.teams.length, TEAM_COUNT)
  assert.equal(result.master.players.players.length, 2)
  assert.ok(result.stats)
  assert.equal(events.length, 39)
  assert.deepEqual(events.slice(0, 38), Array.from({ length: 38 }, (_, index) => `calendar:${index + 1}`))
  assert.equal(events[38], 'players')

  const calendar = JSON.parse(await readFile(join(repoRoot, realCalendarDocumentPath(SEASON)), 'utf8'))
  const persistedTeams = JSON.parse(await readFile(join(repoRoot, realTeamsDocumentPath(SEASON)), 'utf8'))
  const players = JSON.parse(await readFile(join(repoRoot, realPlayersDocumentPath(SEASON)), 'utf8'))
  const stats = JSON.parse(await readFile(join(repoRoot, statPlayersDocumentPath(SEASON)), 'utf8'))
  assert.equal(calendar.days.length, 38)
  assert.equal(persistedTeams.teams.length, TEAM_COUNT)
  assert.equal(players.players.length, 2)
  assert.equal(stats.players.length, 2)
})

test('does not rebuild stats when a repeated bootstrap keeps the same player count', async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), 'fantazone-platform-bootstrap-repeat-'))
  const options = {
    repoRoot,
    now: NOW,
    fetchCalendarJson: async (url: string) => calendarResponse(Number(new URL(url).searchParams.get('day'))),
    fetchPlayersText: async () => playersHtml,
  }

  const first = await bootstrapSerieAPlatformData(options)
  const second = await bootstrapSerieAPlatformData(options)

  assert.ok(first.stats)
  assert.equal(first.master.reconciliation.playerCountChanged, true)
  assert.equal(second.master.reconciliation.playerCountChanged, false)
  assert.equal(second.stats, null)
})

function calendarResponse(day: number) {
  const matches = []
  for (let index = 0; index < TEAM_COUNT; index += 2) {
    matches.push({
      status: 'FULL',
      utcDate: `2026-08-${String(22 + (day % 7)).padStart(2, '0')}T18:45:00Z`,
      homeTeam: {
        teamName: teams[index].name,
        shortTeamName: teams[index].abbreviation,
        score: 1,
      },
      awayTeam: {
        teamName: teams[index + 1].name,
        shortTeamName: teams[index + 1].abbreviation,
        score: 0,
      },
    })
  }
  return { data: { games: [{ matches }] } }
}
