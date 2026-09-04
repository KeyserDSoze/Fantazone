import assert from 'node:assert/strict'
import test from 'node:test'
import type { Rank, RankRaw } from '../../src/domain/src/index'
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

  async putContent(
    owner: string,
    repo: string,
    path: string,
    text: string,
    _message: string,
    sha?: string,
    branch?: string,
  ): Promise<{ sha: string }> {
    this.writes += 1
    const fileKey = this.key(owner, repo, path, branch)
    const existing = this.files.get(fileKey)
    if (existing && existing.sha !== sha) throw new Error('fake stale sha')
    const nextSha = `rank-sha-${this.writes + 1}`
    this.files.set(fileKey, { sha: nextSha, content: text })
    return { sha: nextSha }
  }

  private key(owner: string, repo: string, path: string, ref?: string) {
    return `${owner}/${repo}/${path}@${ref ?? ''}`
  }
}

const raw: RankRaw = {
  d: 4,
  r: {
    '@': [
      { n: 'Alpha', o: 'alpha@example.test', p: 6, v: 2, d: 0, e: 1, g: 5, s: 3, x: 200, w: 180, z: 10, m: 100 },
      { n: 'Beta', o: 'beta@example.test', p: 9, v: 3, d: 0, e: 0, g: 7, s: 2, x: 220, w: 170, z: 0, m: 90 },
    ],
  },
}

const target = { owner: 'KeyserDSoze', repo: 'Fantazone.Demo', ref: 'main' }

test('uses stable season and daily ranking paths', () => {
  assert.equal(seasonRankDocumentPath('serie-a', 15), 'data/groups/seasons/15/leagues/serie-a/ranking.json')
  assert.equal(dailyRankDocumentPath('serie-a', 15, 4), 'data/groups/seasons/15/leagues/serie-a/days/4/ranking.json')
  assert.throws(() => dailyRankDocumentPath('serie-a', 15, 0))
})

test('reads ranking helpers through one cached repository document', async () => {
  const client = new FakeContentClient()
  const path = seasonRankDocumentPath('serie-a', 15)
  client.files.set(`${target.owner}/${target.repo}/${path}@main`, { sha: 'rank-sha-1', content: JSON.stringify(raw) })
  const repository = new GitHubRankRepository(new GitHubJsonStore(client), target)

  assert.equal((await repository.getRank('serie-a', 15))?.serieADay, 4)
  assert.deepEqual((await repository.getRoundRanking('serie-a', 15, '@')).map(team => team.name), ['Beta', 'Alpha'])
  assert.equal(await repository.getTeamPosition('serie-a', 15, '@', 'alpha@example.test'), 2)
  assert.equal(await repository.getCurrentSerieADay('serie-a', 15), 4)
  assert.equal(client.reads, 1)
})

test('writes season and daily ranks as compact canonical data for Actions', async () => {
  const client = new FakeContentClient()
  const repository = new GitHubRankRepository(new GitHubJsonStore(client), target)
  const clean: Rank = {
    serieADay: 5,
    rounds: {
      '@': [{
        name: 'Alpha', owner: 'alpha@example.test', point: 12, victories: 4, draws: 0, defeats: 1,
        goal: 9, sufferedGoal: 4, valuePoint: 350, sufferedValuePoint: 300, plusMoney: 10, money: 100, valueAssets: 110,
      }],
    },
  }

  const seasonSha = await repository.writeRank('serie-a', 15, clean)
  const dailySha = await repository.writeDailyRank('serie-a', 15, 5, clean)

  assert.equal(seasonSha, 'rank-sha-2')
  assert.equal(dailySha, 'rank-sha-3')
  assert.equal(client.writes, 2)

  const seasonStored = client.files.get(`${target.owner}/${target.repo}/${seasonRankDocumentPath('serie-a', 15)}@main`)
  assert.deepEqual(JSON.parse(seasonStored!.content), {
    d: 5,
    r: {
      '@': [{ n: 'Alpha', o: 'alpha@example.test', p: 12, v: 4, d: 0, e: 1, g: 9, s: 4, x: 350, w: 300, z: 10, m: 100 }],
    },
  })
})
