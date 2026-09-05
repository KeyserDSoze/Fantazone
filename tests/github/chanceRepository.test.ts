import assert from 'node:assert/strict'
import test from 'node:test'
import { ChanceType, Role, TrendType, type ChancedRealPlayers } from '../../src/domain/src/index'
import {
  GitHubChanceRepository,
  GitHubJsonStore,
  chanceDocumentPath,
  type RepositoryContentClient,
} from '../../src/github/src/index'

class FakeContentClient implements RepositoryContentClient {
  files = new Map<string, { sha: string; content: string }>()
  writes = 0

  async tryGetContent(owner: string, repo: string, path: string, ref?: string) {
    return this.files.get(`${owner}/${repo}/${path}@${ref ?? ''}`) ?? null
  }

  async putContent(owner: string, repo: string, path: string, text: string, _message: string, sha?: string, branch?: string) {
    const key = `${owner}/${repo}/${path}@${branch ?? ''}`
    const existing = this.files.get(key)
    if (existing && sha !== existing.sha) throw new Error('stale sha')
    const nextSha = `sha-${++this.writes}`
    this.files.set(key, { sha: nextSha, content: text })
    return { sha: nextSha }
  }
}

const target = { owner: 'KeyserDSoze', repo: 'Fantazone', ref: 'main' }
const value: ChancedRealPlayers = {
  year: 15,
  serieADay: 3,
  players: [{
    name: 'Mario Rossi',
    team: { name: 'Roma', abbreviation: 'ROM' },
    role: Role.Forward,
    isActive: true,
    visible: true,
    chance: {
      fantagazzetta: true,
      gazzetta: false,
      mediaset: false,
      sky: false,
      status: ChanceType.Maybe,
      description: 'In dubbio',
      lastGame: null,
      trend: TrendType.Normal,
    },
  }],
}

test('uses readable global season/day chance path', () => {
  assert.equal(chanceDocumentPath(15, 3), 'data/serie-a/chances/15/3.json')
})

test('round-trips readable chance snapshot', async () => {
  const client = new FakeContentClient()
  const repository = new GitHubChanceRepository(new GitHubJsonStore(client), target)

  await repository.write(value)
  const stored = client.files.get(`KeyserDSoze/Fantazone/${chanceDocumentPath(15, 3)}@main`)!.content
  assert.equal(stored.includes('"fantagazzetta"'), true)
  assert.equal(stored.includes('"status"'), true)
  assert.equal(stored.includes('"f"'), false)

  const loaded = await repository.get(15, 3, { refresh: true })
  assert.deepEqual(loaded, value)
})

test('rejects compact/invalid chance documents', async () => {
  const client = new FakeContentClient()
  client.files.set(`KeyserDSoze/Fantazone/${chanceDocumentPath(15, 3)}@main`, {
    sha: 'sha-0',
    content: JSON.stringify({ y: 15, d: 3, p: [] }),
  })
  const repository = new GitHubChanceRepository(new GitHubJsonStore(client), target)
  await assert.rejects(repository.get(15, 3, { refresh: true }), /readable schema v2/)
})
