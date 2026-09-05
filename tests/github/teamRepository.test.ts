import assert from 'node:assert/strict'
import test from 'node:test'
import { FantaSoccerRole, PlayerInTeamStatus, Role, type Team } from '../../src/domain/src/index'
import {
  GitHubJsonStore,
  GitHubRankRepository,
  GitHubTeamRepository,
  dayTeamDocumentPath,
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
const team: Team = {
  name: 'Alpha', owner: 'Ale@Example.com', additionalOwners: [], moneyFromRank: 0, lastUpdate: null,
  players: [{ name: 'Portiere', team: { name: 'Roma', abbreviation: 'ROM' }, role: Role.GoalKeeper, isActive: true, visible: true, price: 12, revenue: 12, status: PlayerInTeamStatus.Active, position: FantaSoccerRole.GoalKeeper }],
}

test('uses repository-scoped paths while storing Team directly', async () => {
  const client = new FakeContentClient()
  const repository = new GitHubTeamRepository(new GitHubJsonStore(client), target)
  const seasonPath = seasonTeamDocumentPath('main', 15, 'Ale@Example.com')
  client.files.set(`${target.owner}/${target.repo}/${seasonPath}@main`, { sha: 'team-1', content: JSON.stringify(team) })

  const loaded = await repository.getTeam('main', 15, 'Ale@Example.com')
  assert.equal(loaded?.name, 'Alpha')
  await repository.getTeamPlayers('main', 15, 'Ale@Example.com')
  assert.equal(client.reads, 1)

  await repository.writeTeam('main', 15, 'Ale@Example.com', loaded!)
  assert.deepEqual(JSON.parse(client.files.get(`${target.owner}/${target.repo}/${seasonPath}@main`)!.content), team)
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
