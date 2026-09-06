import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import {
  FantaSoccerRole,
  IdentityRole,
  PlayerInTeamStatus,
  Role,
  type Group,
  type RealCalendar,
  type RealPlayers,
  type Team,
} from '../../src/domain/src/index'
import {
  GROUP_DOCUMENT_PATH,
  dayTeamDocumentPath,
  realCalendarDocumentPath,
  realPlayersDocumentPath,
} from '../../src/github/src/index'
import { propagateNextFormations } from '../../src/jobs/src/formationPropagation'

const SEASON = 15
const BASKET = 'main'
const OWNER = 'formation@test.local'
const NOW = new Date('2026-09-05T18:00:00Z')

const group: Group = {
  id: 'formation-group',
  name: 'Formation group',
  users: [{ username: 'Admin', email: OWNER, role: IdentityRole.SuperAdmin }],
  leagues: [],
  baskets: [{
    id: BASKET,
    name: 'Main',
    years: [{ year: SEASON, teams: [{ name: 'Formation', owner: OWNER, additionalOwners: [] }] }],
  }],
}

const sourceTeam: Team = {
  name: 'Current formation',
  owner: OWNER,
  additionalOwners: [],
  moneyFromRank: 0,
  lastUpdate: '2026-09-04T20:00:00Z',
  players: [{
    name: 'Player',
    team: { name: 'Roma', abbreviation: 'ROM' },
    role: Role.Forward,
    isActive: true,
    visible: true,
    price: 1,
    revenue: 0,
    status: PlayerInTeamStatus.Active,
    position: FantaSoccerRole.Forward,
  }],
}

test('copies fantasy formation fields but snapshots current Serie A master into the next TeamDay', async () => {
  const { groupRoot, platformRoot } = await fixtureRoots(completedCalendar(7))
  const sourcePath = join(groupRoot, dayTeamDocumentPath(BASKET, SEASON, 7, OWNER))
  await writeJson(sourcePath, sourceTeam)

  const result = await propagateNextFormations({ groupRepoRoot: groupRoot, platformRepoRoot: platformRoot, season: SEASON, now: NOW })

  assert.deepEqual(result.copiedOwners, [OWNER])
  assert.equal(result.sourceSerieADay, 7)
  assert.equal(result.targetSerieADay, 8)
  assert.equal(result.source, 'last-completed')
  const target = await readJson<Team>(join(groupRoot, dayTeamDocumentPath(BASKET, SEASON, 8, OWNER)))
  assert.equal(target.players[0].team.name, 'Milan')
  assert.equal(target.players[0].role, Role.Forward)
  assert.equal(target.players[0].price, sourceTeam.players[0].price)
  assert.equal(target.players[0].status, sourceTeam.players[0].status)
  assert.equal(target.players[0].position, sourceTeam.players[0].position)
  assert.equal((await readJson<Team>(sourcePath)).players[0].team.name, 'Roma')
})

test('never overwrites an existing next formation', async () => {
  const { groupRoot, platformRoot } = await fixtureRoots(completedCalendar(7))
  await writeJson(join(groupRoot, dayTeamDocumentPath(BASKET, SEASON, 7, OWNER)), sourceTeam)
  const existing = { ...sourceTeam, name: 'Existing next formation' }
  const targetPath = join(groupRoot, dayTeamDocumentPath(BASKET, SEASON, 8, OWNER))
  await writeJson(targetPath, existing)

  const result = await propagateNextFormations({ groupRepoRoot: groupRoot, platformRepoRoot: platformRoot, season: SEASON, now: NOW })

  assert.deepEqual(result.existingOwners, [OWNER])
  assert.deepEqual(JSON.parse(await readFile(targetPath, 'utf8')), existing)
})

test('does not create a target when the source TeamDay is missing', async () => {
  const { groupRoot, platformRoot } = await fixtureRoots(completedCalendar(7))
  const result = await propagateNextFormations({ groupRepoRoot: groupRoot, platformRepoRoot: platformRoot, season: SEASON, now: NOW })

  assert.deepEqual(result.missingSourceOwners, [OWNER])
  await assert.rejects(readFile(join(groupRoot, dayTeamDocumentPath(BASKET, SEASON, 8, OWNER)), 'utf8'), /ENOENT/)
})

test('missing calendar and completed day 38 are no-ops', async () => {
  const missing = await fixtureRoots(null)
  const missingResult = await propagateNextFormations({
    groupRepoRoot: missing.groupRoot,
    platformRepoRoot: missing.platformRoot,
    season: SEASON,
    now: NOW,
  })
  assert.equal(missingResult.targetSerieADay, null)

  const ended = await fixtureRoots(completedCalendar(38))
  await writeJson(join(ended.groupRoot, dayTeamDocumentPath(BASKET, SEASON, 38, OWNER)), sourceTeam)
  const endedResult = await propagateNextFormations({
    groupRepoRoot: ended.groupRoot,
    platformRepoRoot: ended.platformRoot,
    season: SEASON,
    now: NOW,
  })
  assert.equal(endedResult.targetSerieADay, null)
  await assert.rejects(readFile(join(ended.groupRoot, dayTeamDocumentPath(BASKET, SEASON, 39, OWNER)), 'utf8'), /ENOENT/)
})

test('live day formation is copied forward instead of the last completed formation', async () => {
  const calendar = realCalendar([
    [7, '2026-09-04T18:00:00Z'],
    [8, '2026-09-05T17:50:00Z'],
  ])
  const { groupRoot, platformRoot } = await fixtureRoots(calendar)
  await writeJson(join(groupRoot, dayTeamDocumentPath(BASKET, SEASON, 7, OWNER)), { ...sourceTeam, name: 'Completed formation' })
  await writeJson(join(groupRoot, dayTeamDocumentPath(BASKET, SEASON, 8, OWNER)), { ...sourceTeam, name: 'Live formation' })

  const result = await propagateNextFormations({ groupRepoRoot: groupRoot, platformRepoRoot: platformRoot, season: SEASON, now: NOW })
  const day9 = await readJson<Team>(join(groupRoot, dayTeamDocumentPath(BASKET, SEASON, 9, OWNER)))

  assert.equal(result.sourceSerieADay, 8)
  assert.equal(result.targetSerieADay, 9)
  assert.equal(result.source, 'live')
  assert.equal(day9.name, 'Live formation')
  assert.equal(day9.players[0].team.name, 'Milan')
})

async function fixtureRoots(calendar: RealCalendar | null) {
  const root = await mkdtemp(join(tmpdir(), 'fantazone-formation-propagation-'))
  const groupRoot = join(root, 'group')
  const platformRoot = join(root, 'platform')
  await writeJson(join(groupRoot, GROUP_DOCUMENT_PATH), group)
  if (calendar) {
    await writeJson(join(platformRoot, realCalendarDocumentPath(SEASON)), calendar)
    await writeJson(join(platformRoot, realPlayersDocumentPath(SEASON)), master())
  }
  return { groupRoot, platformRoot }
}

function master(): RealPlayers {
  return {
    year: SEASON,
    players: [{
      name: 'Player',
      team: { name: 'Milan', abbreviation: 'MIL' },
      role: Role.Forward,
      isActive: true,
      visible: true,
    }],
  }
}

function completedCalendar(day: number): RealCalendar {
  return realCalendar([[day, '2026-09-04T18:00:00Z']])
}

function realCalendar(days: Array<[number, string]>): RealCalendar {
  return {
    year: SEASON,
    days: days.map(([serieADay, date]) => ({
      year: SEASON,
      serieADay,
      games: [{
        home: { name: 'Roma', abbreviation: 'ROM' },
        away: { name: 'Milan', abbreviation: 'MIL' },
        date,
        homeGoals: null,
        awayGoals: null,
        delayed: false,
      }],
    })),
  }
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeText(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function writeText(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, value, 'utf8')
}
