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
  createDefaultFantazoneEvolutionSettings,
  createEmptyVote,
  createEvolutionCardCommitment,
  revealEvolutionCardCommitment,
  type Calendar,
  type Group,
  type LeagueSetting,
  type Team,
  type VotedRealPlayers,
} from '../../src/domain/src/index'
import {
  GROUP_DOCUMENT_PATH,
  calendarDocumentPath,
  dayTeamDocumentPath,
  evolutionCardsPath,
  evolutionPlayerStatePath,
  evolutionTracePath,
  serieAVoteDocumentPath,
  type EvolutionCardsDocument,
} from '../../src/github/src/index'
import { recalculateGroupDay } from '../../src/jobs/src/groupRecalculation'

const SEASON = 15
const DAY = 1
const LEAGUE = 'evolution-league'
const BASKET = 'main'
const HOME = 'home@example.com'
const AWAY = 'away@example.com'

function evolutionSettings(): LeagueSetting {
  const evolution = createDefaultFantazoneEvolutionSettings()
  evolution.enabled = true
  evolution.playerSkills.enabled = false
  evolution.coachCards.enabled = true
  evolution.families.enabled = false
  evolution.morale.enabled = false
  evolution.momentum.enabled = false
  return {
    ...DefaultLeagueSetting,
    votes: { ...DefaultLeagueSetting.votes },
    pointInHome: 0,
    pointForFirstGoal: 100,
    pointForNextGoal: 6,
    pointForGoodPeople: 0,
    pointForStrongDefense: 0,
    pointForStrongDefense4: 0,
    pointForStrongDefense5: 0,
    pointForCleanSheet: 0,
    evolution,
  }
}

const settings = evolutionSettings()
const group: Group = {
  id: 'evolution-test',
  name: 'Evolution Test',
  users: [{ username: 'Home', email: HOME, role: IdentityRole.Participant }],
  leagues: [{
    id: LEAGUE,
    name: 'Evolution League',
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
    Regular: [{
      serieADay: DAY,
      number: 1,
      games: [{ id: 'game-1', number: 1, home: 'Home', homeOwner: HOME, away: 'Away', awayOwner: AWAY, result: null }],
    }],
  },
}

const homeTeam = team('Home', HOME, 'Home forward')
const awayTeam = team('Away', AWAY, 'Away forward')
const official: VotedRealPlayers = {
  year: SEASON,
  serieADay: DAY,
  players: [voted(homeTeam, 60), voted(awayTeam, 60)],
}

test('recalculation consumes only verified revealed cards and persists explainable trace/state', async () => {
  const { groupRoot, platformRoot } = await fixtureRoots()
  const nonce = '0123456789abcdef0123456789abcdef'
  const sealed = createEvolutionCardCommitment({
    leagueId: LEAGUE,
    year: SEASON,
    serieADay: DAY,
    owner: HOME,
    cardIds: ['card-low-block'],
    nonce,
    committedAt: '2026-09-12T12:00:00.000Z',
    revealAt: '2026-09-12T16:00:00.000Z',
  })
  const revealed = revealEvolutionCardCommitment(sealed, {
    leagueId: LEAGUE,
    year: SEASON,
    serieADay: DAY,
    owner: HOME,
    cardIds: ['card-low-block'],
    nonce,
    revealedAt: '2026-09-12T16:00:00.000Z',
  })
  const cards: EvolutionCardsDocument = {
    version: 2,
    leagueId: LEAGUE,
    year: SEASON,
    serieADay: DAY,
    commitments: { [HOME]: revealed },
  }
  await writeJson(join(groupRoot, evolutionCardsPath(LEAGUE, SEASON, DAY)), cards)

  await recalculateGroupDay({ groupRepoRoot: groupRoot, platformRepoRoot: platformRoot, season: SEASON, day: DAY })

  const persisted = await readJson<Calendar>(join(groupRoot, calendarDocumentPath(LEAGUE, SEASON)))
  const score = persisted.rounds.Regular[0].games[0].result
  assert.ok(score)
  assert.equal(score.home.value, 63, 'Blocco Basso adds +3 when the opponent forward does not score')
  assert.equal(score.away.value, 60)

  const trace = await readJson<any>(join(groupRoot, evolutionTracePath(LEAGUE, SEASON, DAY, 'game-1')))
  assert.equal(trace.trace.some((item: any) => item.source === 'coach-card' && item.ruleId === 'card-low-block-rule'), true)

  const state = await readJson<any>(join(groupRoot, evolutionPlayerStatePath(LEAGUE, SEASON, HOME)))
  assert.equal(state.updatedThroughDay, DAY)
  assert.equal(state.players[0].playerKey, 'homeforward')
})

test('a forged reveal is ignored by the definitive job', async () => {
  const { groupRoot, platformRoot } = await fixtureRoots()
  const nonce = '0123456789abcdef0123456789abcdef'
  const sealed = createEvolutionCardCommitment({
    leagueId: LEAGUE,
    year: SEASON,
    serieADay: DAY,
    owner: HOME,
    cardIds: ['card-low-block'],
    nonce,
    committedAt: '2026-09-12T12:00:00.000Z',
  })
  const cards: EvolutionCardsDocument = {
    version: 2,
    leagueId: LEAGUE,
    year: SEASON,
    serieADay: DAY,
    commitments: {
      [HOME]: {
        ...sealed,
        reveal: { cardIds: ['card-offside-trap'], nonce, revealedAt: '2026-09-12T16:00:00.000Z' },
      },
    },
  }
  await writeJson(join(groupRoot, evolutionCardsPath(LEAGUE, SEASON, DAY)), cards)

  await recalculateGroupDay({ groupRepoRoot: groupRoot, platformRepoRoot: platformRoot, season: SEASON, day: DAY })
  const persisted = await readJson<Calendar>(join(groupRoot, calendarDocumentPath(LEAGUE, SEASON)))
  assert.equal(persisted.rounds.Regular[0].games[0].result?.home.value, 60)
})

async function fixtureRoots() {
  const root = await mkdtemp(join(tmpdir(), 'fantazone-evolution-recalc-'))
  const groupRoot = join(root, 'group')
  const platformRoot = join(root, 'platform')
  await writeJson(join(groupRoot, GROUP_DOCUMENT_PATH), group)
  await writeJson(join(groupRoot, calendarDocumentPath(LEAGUE, SEASON)), calendar)
  await writeJson(join(groupRoot, dayTeamDocumentPath(BASKET, SEASON, DAY, HOME)), homeTeam)
  await writeJson(join(groupRoot, dayTeamDocumentPath(BASKET, SEASON, DAY, AWAY)), awayTeam)
  await writeJson(join(platformRoot, serieAVoteDocumentPath('official', SEASON, DAY)), official)
  return { groupRoot, platformRoot }
}

function team(name: string, owner: string, playerName: string): Team {
  return {
    name,
    owner,
    additionalOwners: [],
    moneyFromRank: 0,
    formationChanges: 0,
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
