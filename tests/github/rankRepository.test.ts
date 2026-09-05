import assert from 'node:assert/strict'
import test from 'node:test'
import type { Rank } from '../../src/domain/src/index'
import {
  dailyRankDocumentPath,
  GitHubJsonStore,
  GitHubRankRepository,
  seasonRankDocumentPath,
  type RepositoryContentClient,
} from '../../src/github/src/index'

class FakeContentClient implements RepositoryContentClient {
  readonly files = new Map<string, { sha: string; content: string }>()
  reads = 0
  writes = 0
  async tryGetContent(owner: string, repo: string, path: string, ref?: string) {
    this.reads += 1
    return this.files.get(this.key(owner, repo, path, ref)) ?? null
  }
  async putContent(owner: string, repo: string, path: string, text: string, _message: string, sha?: string, branch?: string) {
    this.writes += 1
    const fileKey = this.key(owner, repo, path, branch)
    const existing = this.files.get(fileKey)
    if (existing && existing.sha !== sha) throw new Error('fake stale sha')
    const nextSha = `rank-sha-${this.writes + 1}`
    this.files.set(fileKey, { sha: nextSha, content: text })
    return { sha: nextSha }
  }
  private key(owner: string, repo: string, path: string, ref?: string) { return `${owner}/${repo}/${path}@${ref ?? ''}` }
}

const rank: Rank = {
  serieADay: 4,
  rounds: {
    '@': [
      { name: 'Alpha', owner: 'alpha@example.test', point: 6, victories: 2, draws: 0, defeats: 1, goal: 5, sufferedGoal: 3, valuePoint: 200, sufferedValuePoint: 180, plusMoney: 10, money: 100, valueAssets: 110 },
      { name: 'Beta', owner: 'beta@example.test', point: 9, victories: 3, draws: 0, defeats: 0, goal: 7, sufferedGoal: 2, valuePoint: 220, sufferedValuePoint: 170, plusMoney: 0, money: 90, valueAssets: 90 },
    ],
  },
}
const target = { owner: 'KeyserDSoze', repo: 'Fantazone.Demo', ref: 'main' }

test('uses stable season and daily ranking paths', () => {
  assert.equal(seasonRankDocumentPath('serie-a', 15), 'data/groups/seasons/15/leagues/serie-a/ranking.json')
  assert.equal(dailyRankDocumentPath('serie-a', 15, 4), 'data/groups/seasons/15/leagues/serie-a/days/4/ranking.json')
  assert.throws(() => dailyRankDocumentPath('serie-a', 15, 0))
})

test('reads ranking helpers through one cached readable document', async () => {
  const client = new FakeContentClient()
  const path = seasonRankDocumentPath('serie-a', 15)
  client.files.set(`${target.owner}/${target.repo}/${path}@main`, { sha: 'rank-sha-1', content: JSON.stringify(rank) })
  const repository = new GitHubRankRepository(new GitHubJsonStore(client), target)

  assert.equal((await repository.getRank('serie-a', 15))?.serieADay, 4)
  assert.deepEqual((await repository.getRoundRanking('serie-a', 15, '@')).map(team => team.name), ['Beta', 'Alpha'])
  assert.equal(await repository.getTeamPosition('serie-a', 15, '@', 'alpha@example.test'), 2)
  assert.equal(client.reads, 1)
})

test('writes season and daily Rank documents without compact serialization', async () => {
  const client = new FakeContentClient()
  const repository = new GitHubRankRepository(new GitHubJsonStore(client), target)
  const changed: Rank = { ...rank, serieADay: 5 }

  assert.equal(await repository.writeRank('serie-a', 15, changed), 'rank-sha-2')
  assert.equal(await repository.writeDailyRank('serie-a', 15, 5, changed), 'rank-sha-3')

  const stored = JSON.parse(client.files.get(`${target.owner}/${target.repo}/${seasonRankDocumentPath('serie-a', 15)}@main`)!.content)
  assert.deepEqual(stored, changed)
  assert.equal(stored.rounds['@'][0].owner, 'alpha@example.test')
  assert.equal('r' in stored, false)
})
