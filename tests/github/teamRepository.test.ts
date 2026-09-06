import assert from 'node:assert/strict'
import test from 'node:test'
import { FantaSoccerRole, PlayerInTeamStatus, Role, type RealPlayers, type Team } from '../../src/domain/src/index'
import {
  GitHubJsonStore,
  GitHubRankRepository,
  GitHubRealPlayersRepository,
  GitHubTeamRepository,
  dayTeamDocumentPath,
  realPlayersDocumentPath,
  seasonTeamDocumentPath,
  type RepositoryContentClient,
} from '../../src/github/src/index'

class FakeContentClient implements RepositoryContentClient {
  readonly files = new Map<string, { sha: string; content: string }>()
  reads = 0
  writes = 0
  async tryGetContent(owner: string, repo: string, path: string, ref?: string) {
    this.reads += 1
    return this.files.get(`${owner}/${repo}/${path}@${ref ?? ''}`) ?? null
  }
  async putContent(owner: string, repo: string, path: string, text: string, _message: string, _sha?: string, branch?: string) {
    this.writes += 1
    const sha = `write-${this.writes}`
    this.files.set(`${owner}/${repo}/${path}@${branch ?? ''}`, { sha, content: text })
    return { sha }
  }
}

const target = { owner: 'KeyserDSoze', repo: 'Fantazone.Amici', ref: 'main' }
const platform = { owner: 'KeyserDSoze', repo: 'Fantazone', ref: 'main' }
const team: Team = {
  name: 'Alpha', owner: 'Ale@Example.com', additionalOwners: [], moneyFromRank: 0, lastUpdate: null,
  players: [{ name: 'Portiere', team: { name: 'Roma', abbreviation: 'ROM' }, role: Role.GoalKeeper, isActive: true, visible: true, price: 12, revenue: 12, status: PlayerInTeamStatus.Active, position: FantaSoccerRole.GoalKeeper }],
}

function master(realTeam = 'Roma'): RealPlayers {
  return {
    year: 15,
    players: [{
      name: 'Portiere',
      team: { name: realTeam, abbreviation: realTeam.slice(0, 3).toUpperCase() },
      role: Role.GoalKeeper,
      isActive: true,
      visible: true,
    }],
  }
}

test('writes mutable Team as player references and hydrates it from the global master', async () => {
  const client = new FakeContentClient()
  const store = new GitHubJsonStore(client)
  const realPlayers = new GitHubRealPlayersRepository(store, platform)
  const repository = new GitHubTeamRepository(store, target, undefined, realPlayers)
  const seasonPath = seasonTeamDocumentPath('main', 15, 'Ale@Example.com')
  const masterPath = realPlayersDocumentPath(15)
  client.files.set(`${target.owner}/${target.repo}/${seasonPath}@main`, { sha: 'team-1', content: JSON.stringify(team) })
  client.files.set(`${platform.owner}/${platform.repo}/${masterPath}@main`, { sha: 'master-1', content: JSON.stringify(master()) })

  const loaded = await repository.getTeam('main', 15, 'Ale@Example.com')
  assert.equal(loaded?.players[0].team.name, 'Roma')
  await repository.writeTeam('main', 15, 'Ale@Example.com', loaded!)

  const persisted = JSON.parse(client.files.get(`${target.owner}/${target.repo}/${seasonPath}@main`)!.content)
  assert.deepEqual(persisted, {
    version: 3,
    name: 'Alpha',
    owner: 'Ale@Example.com',
    additionalOwners: [],
    players: [{ playerKey: 'portiere', price: 12, revenue: 12, status: 0, position: 0 }],
    moneyFromRank: 0,
    lastUpdate: null,
  })
  assert.equal('name' in persisted.players[0], false)
  assert.equal('team' in persisted.players[0], false)
  assert.equal('role' in persisted.players[0], false)

  client.files.set(`${platform.owner}/${platform.repo}/${masterPath}@main`, { sha: 'master-2', content: JSON.stringify(master('Milan')) })
  const refreshed = await repository.getTeam('main', 15, 'Ale@Example.com', { refresh: true })
  assert.equal(refreshed?.players[0].team.name, 'Milan')
  assert.equal(refreshed?.players[0].price, 12)
  assert.equal(dayTeamDocumentPath('main', 15, 3, 'Ale@Example.com'), 'data/groups/seasons/15/days/3/teams/main/Ale%40Example.com.json')
})

test('enhanced team derives moneyFromRank from the readable shared Rank document', async () => {
  const client = new FakeContentClient()
  const store = new GitHubJsonStore(client)
  const rank = new GitHubRankRepository(store, target)
  const teams = new GitHubTeamRepository(store, target, rank)
  const teamPath = seasonTeamDocumentPath('main', 15, 'Ale@Example.com')
  client.files.set(`${target.owner}/${target.repo}/${teamPath}@main`, { sha: 'team-1', content: JSON.stringify(team) })
  const rankPath = 'data/groups/seasons/15/leagues/league-a/ranking.json'
  client.files.set(`${target.owner}/${target.repo}/${rankPath}@main`, {
    sha: 'rank-1',
    content: JSON.stringify({ serieADay: 3, rounds: { '@': [{ name: 'Alpha', owner: 'Ale@Example.com', point: 6, victories: 2, draws: 0, defeats: 1, goal: 4, sufferedGoal: 2, valuePoint: 210, sufferedValuePoint: 200, plusMoney: 0, money: 100, valueAssets: 100 }] } }),
  })

  const enhanced = await teams.getEnhancedTeam('main', 15, 'Ale@Example.com', {
    leagueId: 'league-a',
    leagueSettings: { moneyForGoal: 5, moneyForSufferedGoal: 3 } as any,
  })
  assert.equal(enhanced?.moneyFromRank, 26)
})
