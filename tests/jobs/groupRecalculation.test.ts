import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import {
  DefaultLeagueSetting,
  FantaSoccerRole,
  IdentityRole,
  LeagueType,
  PlayerInTeamStatus,
  Role,
  createEmptyVote,
  type Calendar,
  type Group,
  type LeagueSetting,
  type Team,
  type VotedRealPlayers,
} from '../../src/domain/src/index'
import {
  GROUP_DOCUMENT_PATH,
  calendarDocumentPath,
  dailyRankDocumentPath,
  dayTeamDocumentPath,
  seasonRankDocumentPath,
  serieAVoteDocumentPath,
} from '../../src/github/src/index'
import {
  excludedRankRounds,
  recalculateGroupAll,
  recalculateGroupDay,
} from '../../src/jobs/src/groupRecalculation'

const SEASON = 15
const DAY = 7
const HOME = 'home@test.local'
const AWAY = 'away@test.local'
const BASKET = 'main'
const LEAGUE = 'league-a'

const settings: LeagueSetting = {
  ...DefaultLeagueSetting,
  votes: { ...DefaultLeagueSetting.votes },
  pointInHome: 2,
  pointForFirstGoal: 70,
  pointForNextGoal: 5,
  pointForGoodPeople: 0,
  pointForStrongDefense: 0,
  pointForStrongDefense4: 0,
  pointForStrongDefense5: 0,
  pointForCleanSheet: 0,
}

const group: Group = {
  id: 'test-group',
  name: 'Test group',
  users: [{ username: 'Admin', email: HOME, role: IdentityRole.SuperAdmin }],
  leagues: [{
    id: LEAGUE,
    name: 'League A',
    isMain: true,
    type: LeagueType.League,
    basketsId: [BASKET],
    years: [{ year: SEASON, type: LeagueType.League, settings }],
  }],
  baskets: [{
    id: BASKET,
    name: 'Main',
    years: [{
      year: SEASON,
      teams: [
        { name: 'Home', owner: HOME, additionalOwners: [] },
        { name: 'Away', owner: AWAY, additionalOwners: [] },
      ],
    }],
  }],
}

const calendar: Calendar = {
  year: SEASON,
  rounds: {
    Regular: [
      fantasyDay(DAY, null),
      fantasyDay(DAY + 1, null),
    ],
  },
}

const homeTeam = team('Home', HOME, 'Home player')
const awayTeam = team('Away', AWAY, 'Away player')
const official: VotedRealPlayers = {
  year: SEASON,
  serieADay: DAY,
  players: [voted(homeTeam, 72), voted(awayTeam, 66)],
}

test('recalculate-day writes definitive Calendar, season Rank and daily Rank inside the group checkout', async () => {
  const { groupRoot, platformRoot } = await fixtureRoots()
  const result = await recalculateGroupDay({ groupRepoRoot: groupRoot, platformRepoRoot: platformRoot, season: SEASON, day: DAY })

  assert.equal(result.leagues.length, 1)
  assert.deepEqual(result.leagues[0].calculatedSerieADays, [DAY])

  const persistedCalendar = await readJson<Calendar>(join(groupRoot, calendarDocumentPath(LEAGUE, SEASON)))
  const score = persistedCalendar.rounds.Regular[0].games[0].result
  assert.ok(score)
  assert.equal(score.home.value, 74)
  assert.equal(score.away.value, 66)
  assert.deepEqual([score.homeGoals, score.awayGoals], [1, 0])
  assert.equal(persistedCalendar.rounds.Regular[1].games[0].result, null, 'future day without official votes must stay untouched')

  const rank = await readJson<any>(join(groupRoot, seasonRankDocumentPath(LEAGUE, SEASON)))
  assert.equal(rank.serieADay, DAY)
  assert.equal(rank.rounds.Regular[0].owner, HOME)
  assert.equal(rank.rounds.Regular[0].point, 3)

  const dailyRank = await readJson<any>(join(groupRoot, dailyRankDocumentPath(LEAGUE, SEASON, DAY)))
  assert.equal(dailyRank.serieADay, DAY)
  assert.equal(dailyRank.rounds.Regular[0].point, 3)
})

test('recalculate-all skips calendar days with no official document instead of persisting zero scores', async () => {
  const { groupRoot, platformRoot } = await fixtureRoots()
  await recalculateGroupAll({ groupRepoRoot: groupRoot, platformRepoRoot: platformRoot, season: SEASON })

  const persisted = await readJson<Calendar>(join(groupRoot, calendarDocumentPath(LEAGUE, SEASON)))
  assert.ok(persisted.rounds.Regular[0].games[0].result)
  assert.equal(persisted.rounds.Regular[1].games[0].result, null)
})

test('explicit recalculate-day fails closed when official votes are missing', async () => {
  const { groupRoot, platformRoot } = await fixtureRoots({ withOfficial: false })
  await assert.rejects(
    recalculateGroupDay({ groupRepoRoot: groupRoot, platformRepoRoot: platformRoot, season: SEASON, day: DAY }),
    /Official votes.*non trovati/,
  )

  const persisted = await readJson<Calendar>(join(groupRoot, calendarDocumentPath(LEAGUE, SEASON)))
  assert.equal(persisted.rounds.Regular[0].games[0].result, null)
})

test('rank exclusions preserve legacy Cup and Champions group-stage ranking boundaries', () => {
  assert.deepEqual(excludedRankRounds(LeagueType.Cup), ['Finals'])
  assert.deepEqual(excludedRankRounds(LeagueType.ChampionsLeague), ['Finals', 'Europa League', 'Supercoppa'])
  assert.deepEqual(excludedRankRounds(LeagueType.League), [])
})

async function fixtureRoots(options: { withOfficial?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'fantazone-group-recalc-'))
  const groupRoot = join(root, 'group')
  const platformRoot = join(root, 'platform')
  await writeJson(join(groupRoot, GROUP_DOCUMENT_PATH), group)
  await writeJson(join(groupRoot, calendarDocumentPath(LEAGUE, SEASON)), calendar)
  for (const day of [DAY, DAY + 1]) {
    await writeJson(join(groupRoot, dayTeamDocumentPath(BASKET, SEASON, day, HOME)), homeTeam)
    await writeJson(join(groupRoot, dayTeamDocumentPath(BASKET, SEASON, day, AWAY)), awayTeam)
  }
  if (options.withOfficial !== false) {
    await writeJson(join(platformRoot, serieAVoteDocumentPath('official', SEASON, DAY)), official)
  }
  return { groupRoot, platformRoot }
}

function fantasyDay(serieADay: number, result: Calendar['rounds'][string][number]['games'][number]['result']) {
  return {
    serieADay,
    number: serieADay,
    games: [{
      id: `game-${serieADay}`,
      number: 1,
      home: 'Home',
      homeOwner: HOME,
      away: 'Away',
      awayOwner: AWAY,
      result,
    }],
  }
}

function team(name: string, owner: string, playerName: string): Team {
  return {
    name,
    owner,
    additionalOwners: [],
    moneyFromRank: 0,
    lastUpdate: null,
    players: [{
      name: playerName,
      team: { name: 'Roma', abbreviation: 'rom' },
      role: Role.Forward,
      isActive: true,
      visible: true,
      price: 1,
      revenue: 0,
      status: PlayerInTeamStatus.Active,
      position: FantaSoccerRole.Forward,
    }],
  }
}

function voted(teamValue: Team, value: number) {
  const player = teamValue.players[0]
  return {
    name: player.name,
    team: { ...player.team },
    role: player.role,
    isActive: true,
    visible: true,
    vote: {
      ...createEmptyVote(player.role),
      role: player.role,
      value,
      hasVote: true,
      isFinal: true,
    },
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}
