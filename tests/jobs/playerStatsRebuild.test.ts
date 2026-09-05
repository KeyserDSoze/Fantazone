import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import {
  Role,
  createEmptyVote,
  type RealCalendar,
  type RealPlayers,
  type VotedRealPlayers,
} from '../../src/domain/src/index'
import {
  realCalendarDocumentPath,
  realPlayersDocumentPath,
  serieAVoteDocumentPath,
  statPlayersDocumentPath,
} from '../../src/github/src/index'
import { rebuildPlayerStats } from '../../src/jobs/src/playerStatsRebuild'

const YEAR = 15
const NOW = new Date('2026-09-06T12:00:00Z')

const realPlayers: RealPlayers = {
  year: YEAR,
  players: [{
    name: 'Mario Rossi',
    team: { name: 'Roma', abbreviation: 'rom' },
    role: Role.Forward,
    isActive: true,
    visible: true,
  }],
}
const calendar: RealCalendar = {
  year: YEAR,
  days: [
    {
      year: YEAR,
      serieADay: 1,
      games: [{
        home: { name: 'Roma', abbreviation: 'rom' },
        away: { name: 'Inter', abbreviation: 'int' },
        date: '2026-08-22T18:45:00Z',
        homeGoals: 1,
        awayGoals: 0,
        delayed: false,
      }],
    },
    {
      year: YEAR,
      serieADay: 2,
      games: [{
        home: { name: 'Milan', abbreviation: 'mil' },
        away: { name: 'Roma', abbreviation: 'rom' },
        date: '2026-08-29T18:45:00Z',
        homeGoals: 0,
        awayGoals: 2,
        delayed: false,
      }],
    },
  ],
}
const officialDayOne: VotedRealPlayers = {
  year: YEAR,
  serieADay: 1,
  players: [{
    ...realPlayers.players[0],
    vote: {
      ...createEmptyVote(Role.Forward),
      value: 6,
      hasVote: true,
      isFinal: true,
      goal: 1,
    },
  }],
}

test('rebuild-player-stats reads canonical global inputs and writes readable statistics', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fantazone-stats-'))
  await writeJson(join(root, realPlayersDocumentPath(YEAR)), realPlayers)
  await writeJson(join(root, realCalendarDocumentPath(YEAR)), calendar)
  await writeJson(join(root, serieAVoteDocumentPath('official', YEAR, 1)), officialDayOne)

  const result = await rebuildPlayerStats({ repoRoot: root, season: YEAR, now: NOW })
  assert.equal(result.stats.untilSerieADay, 2)
  assert.equal(result.stats.players[0].withVote, 1)
  assert.equal(result.stats.players[0].noPlayed, 1)
  assert.equal(result.stats.players[0].summatory, 6)
  assert.equal(result.stats.players[0].fantaSummatory, 9)
  assert.deepEqual(result.stats.players[0].games.map(game => game.serieADay), [2, 1])

  const persisted = JSON.parse(await readFile(join(root, statPlayersDocumentPath(YEAR)), 'utf8'))
  assert.equal(persisted.untilSerieADay, 2)
  assert.equal(persisted.players[0].goals, 1)
  assert.equal('z' in persisted.players[0], false)
})

test('explicit day rebuild does not require RealCalendar and missing official documents preserve legacy no-play behavior', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fantazone-stats-day-'))
  await writeJson(join(root, realPlayersDocumentPath(YEAR)), realPlayers)
  const result = await rebuildPlayerStats({ repoRoot: root, season: YEAR, day: 1, now: NOW })
  assert.equal(result.stats.players[0].noPlayed, 1)
  assert.deepEqual(result.stats.players[0].games[0], { serieADay: 1, vote: null, positiveness: -2 })
})

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
