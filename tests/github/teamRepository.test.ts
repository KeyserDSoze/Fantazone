import assert from 'node:assert/strict'
import test from 'node:test'
import { FantaSoccerRole, PlayerInTeamStatus, Role, type TeamRaw } from '../../src/domain/src/index'
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
const raw: TeamRaw = {
  n: 'Alpha', o: 'Ale@Example.com', a: [], m: 0, d: null,
  p: [{ n: 'Portiere', t: { n: 'Roma', a: 'ROM' }, r: Role.GoalKeeper, a: true, vh: true, p: 12, rv: 12, s: PlayerInTeamStatus.Active, k: FantaSoccerRole.GoalKeeper }],
}

test('uses repository-scoped season/day paths while preserving the stored TeamRaw JSON', async () => {
  const client = new FakeContentClient()
  const store = new GitHubJsonStore(client)
  const repository = new GitHubTeamRepository(store, target)
  const seasonPath = seasonTeamDocumentPath('main', 15, 'Ale@Example.com')
  client.files.set(`${target.owner}/${target.repo}/${seasonPath}@main`, { sha: 'team-1', content: JSON.stringify(raw) })

  const team = await repository.getTeam('main', 15, 'Ale@Example.com')
  assert.equal(team?.name, 'Alpha')
  assert.equal(client.reads, 1)
  await repository.getTeamPlayers('main', 15, 'Ale@Example.com')
  assert.equal(client.reads, 1)

  await repository.writeTeam('main', 15, 'Ale@Example.com', team!)
  const stored = client.files.get(`${target.owner}/${target.repo}/${seasonPath}@main`)
  assert.deepEqual(JSON.parse(stored!.content), raw)

  assert.equal(dayTeamDocumentPath('main', 15, 3, 'Ale@Example.com'), 'data/groups/seasons/15/days/3/teams/main/Ale%40Example.com.json')
})

test('enhanced team can derive legacy moneyFromRank from the shared rank repository', async () => {
  const client = new FakeContentClient()
  const store = new GitHubJsonStore(client)
  const rank = new GitHubRankRepository(store, target)
  const teams = new GitHubTeamRepository(store, target, rank)
  const teamPath = seasonTeamDocumentPath('main', 15, 'Ale@Example.com')
  client.files.set(`${target.owner}/${target.repo}/${teamPath}@main`, { sha: 'team-1', content: JSON.stringify(raw) })
  const rankPath = 'data/groups/seasons/15/leagues/league-a/ranking.json'
  client.files.set(`${target.owner}/${target.repo}/${rankPath}@main`, {
    sha: 'rank-1',
    content: JSON.stringify({ d: 3, r: { '@': [{ n: 'Alpha', o: 'Ale@Example.com', p: 6, v: 2, d: 0, e: 1, g: 4, s: 2, x: 210, w: 200, z: 0, m: 100 }] } }),
  })

  const enhanced = await teams.getEnhancedTeam('main', 15, 'Ale@Example.com', {
    leagueId: 'league-a',
    leagueSettings: { moneyForGoal: 5, moneyForSufferedGoal: 3 } as any,
  })
  assert.equal(enhanced?.moneyFromRank, 26)
})
