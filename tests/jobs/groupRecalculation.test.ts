import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import {
  DefaultLeagueSetting,
  FantaSoccerRole,
  IdentityRole,
  LeagueType,
  PlayerInTeamStatus,
  Role,
  createDefaultFantazoneEvolutionSettings,
  createEmptyVote,
  createEvolutionCardCommitment,
  getBuiltinEvolutionCards,
  revealEvolutionCardCommitment,
  type Calendar,
  type Group,
  type LeagueSetting,
  type RealCalendar,
  type Team,
  type VotedRealPlayers,
} from '../../src/domain/src/index'
import {
  GROUP_DOCUMENT_PATH,
  calendarDocumentPath,
  dailyRankDocumentPath,
  dayTeamDocumentPath,
  evolutionCardsPath,
  realCalendarDocumentPath,
  seasonRankDocumentPath,
  serieAVoteDocumentPath,
} from '../../src/github/src/index'
import {
  excludedRankRounds,
  recalculateGroupAll,
  recalculateGroupDay,
} from '../../src/jobs/src/groupRecalculation'

const execFileAsync = promisify(execFile)
const SEASON = 15
const DAY = 7
const HOME = 'home@test.local'
const AWAY = 'away@test.local'
const BASKET = 'main'
const LEAGUE = 'league-a'
const TEST_CARD = 'test-card-fixed-team-bonus'
const FIRST_KICKOFF = '2026-09-12T16:00:00.000Z'
const SECOND_KICKOFF = '2026-09-19T16:00:00.000Z'

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

const realCalendar: RealCalendar = {
  year: SEASON,
  days: [
    realDay(DAY, FIRST_KICKOFF),
    realDay(DAY + 1, SECOND_KICKOFF),
  ],
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

test('definitive recalculation applies the only deck copy once and rejects a second valid reveal after exhaustion', async () => {
  const { groupRoot, platformRoot } = await fixtureRoots()
  const evolutionSettings = settingsWithSingleCardDeck()
  const evolutionGroup = structuredClone(group)
  evolutionGroup.leagues[0].years[0].settings = evolutionSettings
  await writeJson(join(groupRoot, GROUP_DOCUMENT_PATH), evolutionGroup)
  await writeJson(join(platformRoot, realCalendarDocumentPath(SEASON)), realCalendar)
  await writeJson(join(platformRoot, serieAVoteDocumentPath('official', SEASON, DAY + 1)), {
    ...official,
    serieADay: DAY + 1,
  })

  await initializeGit(groupRoot, '2026-09-12T12:00:00.000Z')
  await writeJson(join(groupRoot, evolutionCardsPath(LEAGUE, SEASON, DAY)), sealedCardsDocument(DAY))
  await writeJson(join(groupRoot, evolutionCardsPath(LEAGUE, SEASON, DAY + 1)), sealedCardsDocument(DAY + 1))
  await commitAll(groupRoot, 'seal Evolution cards', '2026-09-12T15:00:00.000Z')

  await writeJson(join(groupRoot, evolutionCardsPath(LEAGUE, SEASON, DAY)), revealedCardsDocument(DAY, '2026-09-12T16:00:30.000Z'))
  await commitAll(groupRoot, 'reveal first Evolution card', '2026-09-12T16:00:30.000Z')
  await writeJson(join(groupRoot, evolutionCardsPath(LEAGUE, SEASON, DAY + 1)), revealedCardsDocument(DAY + 1, '2026-09-19T16:00:30.000Z'))
  await commitAll(groupRoot, 'reveal second Evolution card', '2026-09-19T16:00:30.000Z')

  await recalculateGroupAll({ groupRepoRoot: groupRoot, platformRepoRoot: platformRoot, season: SEASON })

  const persisted = await readJson<Calendar>(join(groupRoot, calendarDocumentPath(LEAGUE, SEASON)))
  const first = persisted.rounds.Regular[0].games[0].result
  const second = persisted.rounds.Regular[1].games[0].result
  assert.ok(first)
  assert.ok(second)
  assert.equal(first.home.value, 84, 'first timely reveal consumes and applies the only +10 card copy')
  assert.equal(second.home.value, 74, 'second timely and cryptographically valid reveal is ignored because the deck copy is exhausted')
})

test('definitive recalculation ignores a reveal first committed after the configured grace window', async () => {
  const { groupRoot, platformRoot } = await fixtureRoots()
  const evolutionGroup = structuredClone(group)
  evolutionGroup.leagues[0].years[0].settings = settingsWithSingleCardDeck()
  await writeJson(join(groupRoot, GROUP_DOCUMENT_PATH), evolutionGroup)
  await writeJson(join(platformRoot, realCalendarDocumentPath(SEASON)), realCalendar)

  await initializeGit(groupRoot, '2026-09-12T12:00:00.000Z')
  await writeJson(join(groupRoot, evolutionCardsPath(LEAGUE, SEASON, DAY)), sealedCardsDocument(DAY))
  await commitAll(groupRoot, 'seal card before kickoff', '2026-09-12T15:00:00.000Z')
  await writeJson(join(groupRoot, evolutionCardsPath(LEAGUE, SEASON, DAY)), revealedCardsDocument(DAY, '2026-09-12T16:10:00.000Z'))
  await commitAll(groupRoot, 'late selective reveal', '2026-09-12T16:10:00.000Z')

  await recalculateGroupDay({ groupRepoRoot: groupRoot, platformRepoRoot: platformRoot, season: SEASON, day: DAY })
  const persisted = await readJson<Calendar>(join(groupRoot, calendarDocumentPath(LEAGUE, SEASON)))
  assert.equal(persisted.rounds.Regular[0].games[0].result?.home.value, 74)
})

test('rank exclusions preserve legacy Cup and NewCup group-stage ranking boundaries', () => {
  assert.deepEqual(excludedRankRounds(LeagueType.Cup), ['Finals'])
  assert.deepEqual(excludedRankRounds(LeagueType.NewCup), ['Finals', 'Europa League', 'Supercoppa'])
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

function settingsWithSingleCardDeck(): LeagueSetting {
  const evolution = createDefaultFantazoneEvolutionSettings()
  evolution.enabled = true
  evolution.playerSkills.enabled = false
  evolution.families.enabled = false
  evolution.morale.enabled = false
  evolution.momentum.enabled = false
  evolution.coachCards.enabled = true
  evolution.coachCards.cardsPerMatch = 1
  evolution.coachCards.cardsInSeasonDeck = 1
  evolution.coachCards.revealGraceSecondsAfterFirstKickoff = 120
  evolution.coachCards.catalog.disabledCardIds = getBuiltinEvolutionCards().map(card => card.id)
  evolution.coachCards.catalog.customCards = [{
    id: TEST_CARD,
    name: 'Test +10',
    description: 'Adds ten points to the team for deterministic deck tests.',
    category: 'team',
    rarity: 'common',
    power: 10,
    weight: 1,
    rules: [{
      id: `${TEST_CARD}-rule`,
      name: 'Fixed team bonus',
      description: 'Always adds ten team points.',
      source: 'coach-card',
      trigger: 'team-finalized',
      effects: [{ type: 'add-score', target: 'team', value: 10 }],
      priority: 200,
      stacking: { mode: 'stack' },
    }],
  }]
  return { ...settings, evolution }
}

function sealedCardsDocument(serieADay: number) {
  const commitment = cardCommitment(serieADay)
  return {
    version: 2 as const,
    leagueId: LEAGUE,
    year: SEASON,
    serieADay,
    commitments: { [HOME]: commitment },
  }
}

function revealedCardsDocument(serieADay: number, revealedAt: string) {
  const commitment = cardCommitment(serieADay)
  const identity = { leagueId: LEAGUE, year: SEASON, serieADay, owner: HOME }
  const revealed = revealEvolutionCardCommitment(commitment, {
    ...identity,
    cardIds: [TEST_CARD],
    nonce: cardNonce(serieADay),
    revealedAt,
  })
  return {
    version: 2 as const,
    leagueId: LEAGUE,
    year: SEASON,
    serieADay,
    commitments: { [HOME]: revealed },
  }
}

function cardCommitment(serieADay: number) {
  return createEvolutionCardCommitment({
    leagueId: LEAGUE,
    year: SEASON,
    serieADay,
    owner: HOME,
    cardIds: [TEST_CARD],
    nonce: cardNonce(serieADay),
    committedAt: '1999-01-01T00:00:00.000Z',
  })
}

function cardNonce(serieADay: number): string {
  return `day-${serieADay}-0123456789abcdef`
}

async function initializeGit(root: string, date: string): Promise<void> {
  await execFileAsync('git', ['-C', root, 'init', '-b', 'main'])
  await execFileAsync('git', ['-C', root, 'config', 'user.name', 'Fantazone test'])
  await execFileAsync('git', ['-C', root, 'config', 'user.email', 'test@fantazone.local'])
  await commitAll(root, 'fixture base', date)
}

async function commitAll(root: string, message: string, date: string): Promise<void> {
  await execFileAsync('git', ['-C', root, 'add', '-A'])
  await execFileAsync('git', ['-C', root, 'commit', '-m', message], {
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  })
}

function realDay(serieADay: number, kickoff: string) {
  return {
    year: SEASON,
    serieADay,
    games: [{
      home: { name: 'Roma', abbreviation: 'ROM' },
      away: { name: 'Milan', abbreviation: 'MIL' },
      date: kickoff,
      homeGoals: null,
      awayGoals: null,
      delayed: false,
    }],
  }
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
