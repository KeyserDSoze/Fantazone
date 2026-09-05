import assert from 'node:assert/strict'
import test from 'node:test'
import {
  GameWrapperHelper,
  IdentityRole,
  PlayerInTeamStatus,
  Role,
  FantaSoccerRole,
  type Calendar,
  type Group,
  type Team,
} from '../../src/domain/src/index'
import {
  GROUP_DOCUMENT_PATH,
  calendarDocumentPath,
  dayTeamDocumentPath,
  seasonTeamDocumentPath,
  type RepositoryContentClient,
} from '../../src/github/src/index'
import { GroupSessionRuntime } from '../../src/app/services/groupSessionRuntime'

class FakeContentClient implements RepositoryContentClient {
  readonly files = new Map<string, { sha: string; content: string }>()
  reads = 0
  async tryGetContent(owner: string, repo: string, path: string, ref?: string) {
    this.reads += 1
    return this.files.get(`${owner}/${repo}/${path}@${ref ?? ''}`) ?? null
  }
  async putContent() { return { sha: 'unused' } }
}

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

const group: Group = {
  id: 'amici',
  name: 'Amici',
  leagues: [],
  users: [{ username: 'Ale', email: 'alpha@example.com', role: IdentityRole.Participant }],
  baskets: [{
    id: 'main',
    name: 'Principale',
    years: [{
      year: 15,
      teams: [
        { name: 'Alpha', owner: 'alpha@example.com', additionalOwners: ['coalpha@example.com'] },
        { name: 'Beta', owner: 'beta@example.com', additionalOwners: [] },
      ],
    }],
  }],
}

const calendar: Calendar = {
  year: 15,
  rounds: {
    '@': [{
      serieADay: 4,
      number: 2,
      games: [{
        id: 'game-1',
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

const goalkeeper = {
  name: 'Portiere',
  team: { name: 'Roma', abbreviation: 'ROM' },
  role: Role.GoalKeeper,
  isActive: true,
  visible: true,
  price: 10,
  revenue: 10,
  status: PlayerInTeamStatus.Active,
  position: FantaSoccerRole.GoalKeeper,
}

const sold = {
  ...goalkeeper,
  name: 'Venduto',
  status: PlayerInTeamStatus.Sold,
}

const alphaDay: Team = {
  name: 'Alpha Day',
  owner: 'alpha@example.com',
  additionalOwners: ['coalpha@example.com'],
  players: [goalkeeper, sold],
  moneyFromRank: 0,
  lastUpdate: '2026-09-05T06:00:00Z',
}

const betaSeason: Team = {
  name: 'Beta Season',
  owner: 'beta@example.com',
  additionalOwners: [],
  players: [goalkeeper],
  moneyFromRank: 0,
  lastUpdate: null,
}

function put(client: FakeContentClient, path: string, value: unknown) {
  client.files.set(`KeyserDSoze/Fantazone.Amici/${path}@main`, { sha: `sha-${path}`, content: JSON.stringify(value) })
}

async function runtimeWithFixtures() {
  const client = new FakeContentClient()
  put(client, GROUP_DOCUMENT_PATH, group)
  put(client, calendarDocumentPath('league-a', 15), calendar)
  put(client, dayTeamDocumentPath('main', 15, 4, 'alpha@example.com'), alphaDay)
  put(client, seasonTeamDocumentPath('main', 15, 'beta@example.com'), betaSeason)
  return { client, runtime: await GroupSessionRuntime.open(connection, client) }
}

test('composes GameWrapper locally from Calendar + TeamDay with editable season-team fallback', async () => {
  const { runtime } = await runtimeWithFixtures()
  const wrapper = await runtime.gameComposer.getGame({
    leagueId: 'league-a',
    season: 15,
    gameId: 'game-1',
    nextSerieADay: 4,
  })

  assert.ok(wrapper)
  assert.equal(wrapper.serieADay, 4)
  assert.equal(wrapper.fantasyDay, 2)
  assert.equal(wrapper.canEdit, true)
  assert.equal(wrapper.editabilitySource, 'serie-a-context')
  assert.equal(GameWrapperHelper.getHomeTeam(wrapper)?.source, 'day')
  assert.equal(GameWrapperHelper.getHomeTeam(wrapper)?.name, 'Alpha Day')
  assert.deepEqual(GameWrapperHelper.getHomeTeam(wrapper)?.players.map(player => player.current.name), ['Portiere'])
  assert.equal(GameWrapperHelper.getAwayTeam(wrapper)?.source, 'season')
  assert.equal(GameWrapperHelper.getAwayTeam(wrapper)?.name, 'Beta Season')
  assert.equal(GameWrapperHelper.canUserEdit(wrapper, 'COALPHA@example.com'), true)
})

test('does not fall back to the mutable season team after the game becomes locked', async () => {
  const { runtime } = await runtimeWithFixtures()
  const wrapper = await runtime.gameComposer.getGame({
    leagueId: 'league-a',
    season: 15,
    gameId: 'game-1',
    nextSerieADay: 5,
  })

  assert.ok(wrapper)
  assert.equal(wrapper.canEdit, false)
  assert.equal(GameWrapperHelper.getHomeTeam(wrapper)?.source, 'day')
  assert.equal(GameWrapperHelper.getAwayTeam(wrapper)?.source, 'missing')
  assert.equal(GameWrapperHelper.getAwayTeam(wrapper)?.name, 'Beta')
  assert.equal(wrapper.requiresScoreCalculation, true)
  assert.equal(GameWrapperHelper.canUserEdit(wrapper, 'alpha@example.com'), false)
})

test('keeps a stored calendar result authoritative and does not request score calculation', async () => {
  const { client, runtime } = await runtimeWithFixtures()
  const withResult: Calendar = structuredClone(calendar)
  withResult.rounds['@'][0].games[0].result = {
    home: { value: 72, defensiveBonus: false, goodPeople: false, ownGoal: false },
    away: { value: 66, defensiveBonus: false, goodPeople: false, ownGoal: false },
    isCancelled: false,
    homeGoals: 2,
    awayGoals: 1,
  }
  put(client, calendarDocumentPath('league-a', 15), withResult)

  const wrapper = await runtime.gameComposer.getGame({ leagueId: 'league-a', season: 15, gameId: 'game-1', nextSerieADay: 5 })
  assert.ok(wrapper)
  assert.equal(wrapper.requiresScoreCalculation, false)
  assert.equal(GameWrapperHelper.hasStoredResult(wrapper), true)
})

test('preserves the old missing-real-calendar fallback of next Serie A day 39', async () => {
  const { runtime } = await runtimeWithFixtures()
  const wrapper = await runtime.gameComposer.getGame({ leagueId: 'league-a', season: 15, gameId: 'game-1' })
  assert.ok(wrapper)
  assert.equal(wrapper.nextSerieADay, 39)
  assert.equal(wrapper.editabilitySource, 'legacy-fallback')
  assert.equal(wrapper.canEdit, false)
})

test('returns null for an unknown game instead of inventing a wrapper', async () => {
  const { runtime } = await runtimeWithFixtures()
  assert.equal(await runtime.gameComposer.getGame({ leagueId: 'league-a', season: 15, gameId: 'missing', nextSerieADay: 4 }), null)
})
