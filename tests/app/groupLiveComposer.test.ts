import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DefaultLeagueSetting,
  DefaultRankedTeam,
  FantaSoccerRole,
  IdentityRole,
  LeagueType,
  PlayerInTeamStatus,
  Role,
  createEmptyVote,
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
  dayTeamDocumentPath,
  realCalendarDocumentPath,
  seasonRankDocumentPath,
  serieAVoteDocumentPath,
  type RepositoryContentClient,
} from '../../src/github/src/index'
import { GroupSessionRuntime } from '../../src/app/services/groupSessionRuntime'

class FakeContentClient implements RepositoryContentClient {
  readonly files = new Map<string, { sha: string; content: string }>()
  writes = 0

  async tryGetContent(owner: string, repo: string, path: string, ref?: string) {
    return this.files.get(`${owner}/${repo}/${path}@${ref ?? ''}`) ?? null
  }

  async putContent() {
    this.writes += 1
    return { sha: `write-${this.writes}` }
  }
}

const NOW = new Date('2026-09-05T18:00:00Z')
const SEASON = 15
const DAY = 3
const connection = {
  token: 'test-token',
  groupName: 'Amici',
  repository: {
    name: 'Fantazone.Amici',
    full_name: 'KeyserDSoze/Fantazone.Amici',
    private: true,
    owner: { login: 'KeyserDSoze' },
    default_branch: 'main',
  },
}

const settings: LeagueSetting = {
  ...DefaultLeagueSetting,
  votes: { ...DefaultLeagueSetting.votes },
  pointInHome: 1,
  pointForGoodPeople: 0,
  pointForStrongDefense: 0,
  pointForStrongDefense4: 0,
  pointForStrongDefense5: 0,
  pointForCleanSheet: 0,
}

const group: Group = {
  id: 'amici',
  name: 'Amici',
  users: [{ username: 'Alpha', email: 'alpha@example.com', role: IdentityRole.Participant }],
  leagues: [{
    id: 'league-a',
    name: 'Lega A',
    isMain: true,
    type: LeagueType.League,
    basketsId: ['main'],
    years: [{ year: SEASON, type: LeagueType.League, settings }],
  }],
  baskets: [{
    id: 'main',
    name: 'Principale',
    years: [{
      year: SEASON,
      teams: [
        { name: 'Alpha', owner: 'alpha@example.com', additionalOwners: [] },
        { name: 'Beta', owner: 'beta@example.com', additionalOwners: [] },
      ],
    }],
  }],
}

const calendar: Calendar = {
  year: SEASON,
  rounds: {
    A: [{
      serieADay: DAY,
      number: 3,
      games: [{
        id: 'game-live',
        number: 1,
        home: 'Alpha',
        homeOwner: 'alpha@example.com',
        away: 'Beta',
        awayOwner: 'beta@example.com',
        result: null,
      }],
    }],
  },
}

const realCalendar: RealCalendar = {
  year: SEASON,
  days: [{
    year: SEASON,
    serieADay: DAY,
    games: [{
      home: { name: 'Roma', abbreviation: 'rom' },
      away: { name: 'Milan', abbreviation: 'mil' },
      date: '2026-09-05T17:00:00Z',
      homeGoals: null,
      awayGoals: null,
      delayed: false,
    }],
  }],
}

const homeTeam = team('Alpha', 'alpha@example.com', 'Home Player', 'Roma', 'rom')
const awayTeam = team('Beta', 'beta@example.com', 'Away Player', 'Milan', 'mil')
const officialVotes = voteDocument([
  voted(homeTeam.players[0], 70, true),
])
const liveVotes = voteDocument([
  voted(homeTeam.players[0], 80, false),
  voted(awayTeam.players[0], 65, false),
])
const rank = {
  serieADay: 2,
  rounds: {
    A: [
      { ...DefaultRankedTeam, name: 'Alpha', owner: 'alpha@example.com' },
      { ...DefaultRankedTeam, name: 'Beta', owner: 'beta@example.com' },
    ],
  },
}

test('composes LiveGroup locally from canonical group/global data without writing a live cache', async () => {
  const client = fixtureClient({ includeHomeTeam: true })
  const runtime = await GroupSessionRuntime.open(connection, client, { now: () => NOW })
  const result = await runtime.liveComposer.getLiveGroup(SEASON)

  assert.ok(result)
  assert.equal(result.name, 'Amici')
  assert.equal(result.leagues.length, 1)
  const league = result.leagues[0]
  const game = league.rounds.A.games[0]
  assert.equal(game.result?.home.value, 71, 'official 70 must override live 80, then +1 home advantage')
  assert.equal(game.result?.away.value, 65, 'away falls back to live vote when no official row exists')
  assert.equal(game.result?.homeGoals, 1)
  assert.equal(game.result?.awayGoals, 0)
  assert.equal(league.rank?.rounds.A[0].point, 3)
  assert.equal(league.rank?.rounds.A[0].valuePoint, 71)
  assert.equal(rank.rounds.A[0].point, 0, 'canonical rank fixture must remain untouched')
  assert.equal(client.writes, 0, 'local live composition must not persist data/groups/live-group.json')
})

test('missing home TeamDay stays Point.Zero and does not receive home advantage', async () => {
  const client = fixtureClient({ includeHomeTeam: false })
  const runtime = await GroupSessionRuntime.open(connection, client, { now: () => NOW })
  const result = await runtime.liveComposer.getLiveGroup(SEASON)

  assert.ok(result)
  const game = result.leagues[0].rounds.A.games[0]
  assert.equal(game.result?.home.value, 0)
  assert.equal(game.result?.away.value, 65)
})

function fixtureClient(options: { includeHomeTeam: boolean }): FakeContentClient {
  const client = new FakeContentClient()
  putGroup(client, GROUP_DOCUMENT_PATH, group)
  putGroup(client, calendarDocumentPath('league-a', SEASON), calendar)
  if (options.includeHomeTeam) {
    putGroup(client, dayTeamDocumentPath('main', SEASON, DAY, 'alpha@example.com'), homeTeam)
  }
  putGroup(client, dayTeamDocumentPath('main', SEASON, DAY, 'beta@example.com'), awayTeam)
  putGroup(client, seasonRankDocumentPath('league-a', SEASON), rank)
  putPlatform(client, realCalendarDocumentPath(SEASON), realCalendar)
  putPlatform(client, serieAVoteDocumentPath('official', SEASON, DAY), officialVotes)
  putPlatform(client, serieAVoteDocumentPath('live', SEASON, DAY), liveVotes)
  return client
}

function team(name: string, owner: string, playerName: string, realTeam: string, abbreviation: string): Team {
  return {
    name,
    owner,
    additionalOwners: [],
    moneyFromRank: 0,
    lastUpdate: null,
    players: [{
      name: playerName,
      team: { name: realTeam, abbreviation },
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

function voted(player: Team['players'][number], value: number, isFinal: boolean) {
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
      isFinal,
    },
  }
}

function voteDocument(players: VotedRealPlayers['players']): VotedRealPlayers {
  return { year: SEASON, serieADay: DAY, players }
}

function putGroup(client: FakeContentClient, path: string, value: unknown) {
  client.files.set(`KeyserDSoze/Fantazone.Amici/${path}@main`, { sha: `sha-${path}`, content: JSON.stringify(value) })
}

function putPlatform(client: FakeContentClient, path: string, value: unknown) {
  client.files.set(`KeyserDSoze/Fantazone/${path}@main`, { sha: `sha-${path}`, content: JSON.stringify(value) })
}
