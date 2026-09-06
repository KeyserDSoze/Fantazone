import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import {
  Role,
  getCurrentSeasonYear,
  type RealCalendar,
  type RealPlayers,
} from '../../src/domain/src/index'
import {
  realCalendarDocumentPath,
  realPlayersDocumentPath,
  realTeamsDocumentPath,
} from '../../src/github/src/index'
import {
  DEFAULT_FANTACALCIO_PLAYERS_URL,
  deriveRealTeamsFromCalendar,
  ingestMasterData,
  parseFantacalcioPlayers,
} from '../../src/jobs/src/masterDataIngestion'

const NOW = new Date('2026-09-05T12:00:00Z')
const SEASON = getCurrentSeasonYear(NOW)

const calendar: RealCalendar = {
  year: SEASON,
  days: [{
    year: SEASON,
    serieADay: 1,
    games: [{
      home: { name: 'Roma', abbreviation: 'rom' },
      away: { name: 'Milan', abbreviation: 'mil' },
      date: '2026-08-22T18:45:00Z',
      homeGoals: null,
      awayGoals: null,
      delayed: false,
    }],
  }],
}

const playersHtml = `
<table>
<tr class="player-row"><span>Mario Rossi</span><td class="player-team">rom</td><span class="role" data-value="a"></span></tr>
<tr class="player-row"><span>Luca Bianchi</span><td class="player-team">mil</td><span class="role" data-value="p"></span></tr>
<tr class="player-row out-of-game"><span>Inactive Source</span><td class="player-team">rom</td><span class="role" data-value="d"></span></tr>
</table>`

test('derives canonical teams from RealCalendar instead of official-vote bootstrap', () => {
  const teams = deriveRealTeamsFromCalendar(calendar)
  assert.equal(teams.year, SEASON)
  assert.deepEqual(teams.teams, [
    { name: 'Milan', abbreviation: 'mil' },
    { name: 'Roma', abbreviation: 'rom' },
  ])
})

test('parses current Fantacalcio quotation rows and skips out-of-game players', () => {
  const teams = deriveRealTeamsFromCalendar(calendar)
  const players = parseFantacalcioPlayers(playersHtml, teams)
  assert.equal(players.length, 2)
  assert.equal(players.find(player => player.name === 'Mario Rossi')?.role, Role.Forward)
  assert.equal(players.find(player => player.name === 'Luca Bianchi')?.role, Role.GoalKeeper)
  assert.equal(players.every(player => player.isActive && player.visible), true)
})

test('reconciles observed Fantacalcio provider aliases to canonical calendar teams', () => {
  const teams = {
    year: SEASON,
    teams: [{ name: 'Monza', abbreviation: 'monz' }],
  }
  const players = parseFantacalcioPlayers(
    '<tr class="player-row"><span>Monza Player</span><td class="player-team">MON</td><span class="role" data-value="d"></span></tr>',
    teams,
  )
  assert.equal(players.length, 1)
  assert.deepEqual(players[0]?.team, { name: 'Monza', abbreviation: 'monz' })
})

test('master-data ingestion writes teams/players and preserves missing historical players as inactive', async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), 'fantazone-master-data-'))
  await writeJson(join(repoRoot, realCalendarDocumentPath(SEASON)), calendar)
  const existing: RealPlayers = {
    year: SEASON,
    players: [{
      name: 'Historical Player',
      team: { name: 'Roma', abbreviation: 'rom' },
      role: Role.Defensor,
      isActive: true,
      visible: false,
    }],
  }
  await writeJson(join(repoRoot, realPlayersDocumentPath(SEASON)), existing)
  let requestedUrl = ''

  const result = await ingestMasterData({
    repoRoot,
    now: NOW,
    minimumTeamCount: 2,
    fetchText: async url => {
      requestedUrl = url
      return playersHtml
    },
  })

  assert.equal(requestedUrl, DEFAULT_FANTACALCIO_PLAYERS_URL)
  assert.equal(result.teams.teams.length, 2)
  assert.equal(result.players.players.length, 3)
  assert.deepEqual(result.reconciliation.inactiveKeys, ['historicalplayer'])
  assert.equal(result.players.players.find(player => player.name === 'Historical Player')?.isActive, false)
  assert.equal(result.players.players.find(player => player.name === 'Historical Player')?.visible, false)

  const persistedTeams = JSON.parse(await readFile(join(repoRoot, realTeamsDocumentPath(SEASON)), 'utf8'))
  const persistedPlayers = JSON.parse(await readFile(join(repoRoot, realPlayersDocumentPath(SEASON)), 'utf8'))
  assert.equal(persistedTeams.year, SEASON)
  assert.equal(persistedPlayers.players.length, 3)
})

test('master-data ingestion fails closed when calendar or current-player source is incomplete', async () => {
  const emptyRoot = await mkdtemp(join(tmpdir(), 'fantazone-master-empty-'))
  await assert.rejects(
    ingestMasterData({ repoRoot: emptyRoot, now: NOW, minimumTeamCount: 2, fetchText: async () => playersHtml }),
    /Esegui prima ingest-serie-a/,
  )

  const repoRoot = await mkdtemp(join(tmpdir(), 'fantazone-master-source-empty-'))
  await writeJson(join(repoRoot, realCalendarDocumentPath(SEASON)), calendar)
  await assert.rejects(
    ingestMasterData({ repoRoot, now: NOW, minimumTeamCount: 2, fetchText: async () => '<html></html>' }),
    /non ha restituito giocatori validi/,
  )
})

test('unknown player team fails instead of silently persisting a broken relation', () => {
  const teams = deriveRealTeamsFromCalendar(calendar)
  assert.throws(
    () => parseFantacalcioPlayers(
      '<tr class="player-row"><span>Unknown Club Player</span><td class="player-team">zzz</td><span class="role" data-value="c"></span></tr>',
      teams,
    ),
    /non esiste nel RealCalendar/,
  )
})

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
