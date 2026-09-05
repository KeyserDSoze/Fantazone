import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import {
  ChanceType,
  Role,
  type RealCalendar,
  type RealPlayers,
} from '../../src/domain/src/index'
import {
  chanceDocumentPath,
  realCalendarDocumentPath,
  realPlayersDocumentPath,
} from '../../src/github/src/index'
import {
  ingestPlayerOdds,
  DEFAULT_FANTACALCIO_INJURY_URL,
  DEFAULT_FANTAGAZZETTA_FORMATIONS_URL,
  DEFAULT_GAZZETTA_FORMATIONS_URL,
} from '../../src/jobs/src/playerOddsIngestion'

const SEASON = 15
const NOW = new Date('2026-09-05T12:00:00Z')

const calendar: RealCalendar = {
  year: SEASON,
  days: [
    {
      year: SEASON,
      serieADay: 2,
      games: [{
        home: { name: 'Roma', abbreviation: 'rom' },
        away: { name: 'Milan', abbreviation: 'mil' },
        date: '2026-09-04T18:00:00Z',
        homeGoals: 1,
        awayGoals: 0,
        delayed: false,
      }],
    },
    {
      year: SEASON,
      serieADay: 3,
      games: [{
        home: { name: 'Roma', abbreviation: 'rom' },
        away: { name: 'Milan', abbreviation: 'mil' },
        date: '2026-09-06T18:00:00Z',
        homeGoals: null,
        awayGoals: null,
        delayed: false,
      }],
    },
  ],
}

const players: RealPlayers = {
  year: SEASON,
  players: [
    { name: 'Mario Rossi', team: { name: 'Roma', abbreviation: 'rom' }, role: Role.Forward, isActive: true, visible: true },
    { name: 'Luca Bianchi', team: { name: 'Milan', abbreviation: 'mil' }, role: Role.GoalKeeper, isActive: true, visible: true },
  ],
}

test('ingests all successful global providers into the next Serie A day', async () => {
  const root = await fixtureRoot()
  const fetchText = async (url: string) => {
    if (url === DEFAULT_FANTAGAZZETTA_FORMATIONS_URL) {
      return '<ul class="player-list starters"><li class="player-item"><a href="https://www.fantacalcio.it/serie-a/squadre/roma/rosa"><span>Mario Rossi</span></a></li></ul>'
    }
    if (url === DEFAULT_GAZZETTA_FORMATIONS_URL) {
      return '<div class="bck-box-match-details"><a href="https://www.gazzetta.it/calcio/squadre/roma/">Roma</a><a href="https://www.gazzetta.it/calcio/squadre/milan/">Milan</a><ul><li><span class="lineup-team__name">Mario Rossi</span></li></ul><ul><li><span class="lineup-team__name">Luca Bianchi</span></li></ul><div class="go-above-container"></div></div>'
    }
    if (url === DEFAULT_FANTACALCIO_INJURY_URL) {
      return '<div id="team-roma"><span class="team-name">Roma</span><header><strong class="item-name">Mario Rossi</strong><p>Problema muscolare</p></header></div>'
    }
    throw new Error(`unexpected ${url}`)
  }

  const result = await ingestPlayerOdds({ season: SEASON, repoRoot: root, now: NOW, fetchText })

  assert.equal(result.skipped, false)
  assert.equal(result.serieADay, 3)
  assert.equal(result.sources.every(source => source.ok), true)
  const stored = JSON.parse(await readFile(join(root, chanceDocumentPath(SEASON, 3)), 'utf8'))
  const mario = stored.players.find((player: any) => player.name === 'Mario Rossi')
  assert.equal(mario.chance.fantagazzetta, true)
  assert.equal(mario.chance.gazzetta, true)
  assert.equal(mario.chance.status, ChanceType.Injury)
  assert.equal(mario.chance.description, 'Problema muscolare')
})

test('isolates one provider failure and still writes the other observations', async () => {
  const root = await fixtureRoot()
  const fetchText = async (url: string) => {
    if (url === DEFAULT_GAZZETTA_FORMATIONS_URL) throw new Error('Gazzetta unavailable')
    if (url === DEFAULT_FANTAGAZZETTA_FORMATIONS_URL) {
      return '<ul class="player-list starters"><li class="player-item"><a href="https://www.fantacalcio.it/serie-a/squadre/roma/rosa"><span>Mario Rossi</span></a></li></ul>'
    }
    return ''
  }

  const result = await ingestPlayerOdds({ season: SEASON, repoRoot: root, now: NOW, fetchText })
  assert.equal(result.written, true)
  assert.equal(result.sources.find(source => source.source === 'gazzetta')?.ok, false)
  assert.equal(result.snapshot?.players.find(player => player.name === 'Mario Rossi')?.chance.fantagazzetta, true)
})

test('preserves existing usable snapshot when every provider fails', async () => {
  const root = await fixtureRoot()
  const target = join(root, chanceDocumentPath(SEASON, 3))
  const existing = {
    year: SEASON,
    serieADay: 3,
    players: players.players.map(player => ({
      ...player,
      chance: {
        fantagazzetta: true,
        gazzetta: false,
        mediaset: false,
        sky: false,
        status: ChanceType.Maybe,
        description: 'Snapshot buono',
        lastGame: null,
        trend: 2,
      },
    })),
  }
  await writeJson(target, existing)
  const before = await readFile(target, 'utf8')

  const result = await ingestPlayerOdds({
    season: SEASON,
    repoRoot: root,
    now: NOW,
    fetchText: async () => { throw new Error('offline') },
  })

  assert.equal(result.skipped, true)
  assert.equal(result.reason, 'all-providers-failed')
  assert.equal(result.written, false)
  assert.equal(await readFile(target, 'utf8'), before)
})

test('missing calendar or master players performs no external calls and no write', async () => {
  const emptyRoot = await mkdtemp(join(tmpdir(), 'fantazone-odds-empty-'))
  let calls = 0
  const missingCalendar = await ingestPlayerOdds({
    season: SEASON,
    repoRoot: emptyRoot,
    now: NOW,
    fetchText: async () => { calls += 1; return '' },
  })
  assert.equal(missingCalendar.reason, 'calendar-missing')
  assert.equal(calls, 0)

  const noPlayersRoot = await mkdtemp(join(tmpdir(), 'fantazone-odds-no-players-'))
  await writeJson(join(noPlayersRoot, realCalendarDocumentPath(SEASON)), calendar)
  const missingPlayers = await ingestPlayerOdds({
    season: SEASON,
    repoRoot: noPlayersRoot,
    now: NOW,
    fetchText: async () => { calls += 1; return '' },
  })
  assert.equal(missingPlayers.reason, 'players-missing')
  assert.equal(calls, 0)
})

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'fantazone-odds-'))
  await writeJson(join(root, realCalendarDocumentPath(SEASON)), calendar)
  await writeJson(join(root, realPlayersDocumentPath(SEASON)), players)
  return root
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
