import assert from 'node:assert/strict'
import test from 'node:test'
import type { LiveGroup } from '../../src/domain/src/index'
import {
  GitHubJsonStore,
  GitHubLiveGroupRepository,
  LIVE_GROUP_DOCUMENT_PATH,
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
    const sha = `live-${this.writes}`
    this.files.set(`${owner}/${repo}/${path}@${branch ?? ''}`, { sha, content: text })
    return { sha }
  }
}

const target = { owner: 'KeyserDSoze', repo: 'Fantazone.Amici', ref: 'main' }
const group: LiveGroup = {
  name: 'Amici',
  leagues: [{
    id: 'league-a',
    name: 'Serie A',
    rounds: {
      '@': { serieADay: 3, number: 1, games: [{ id: 'pending', number: 1, home: 'Alpha', homeOwner: 'ale@example.com', away: 'Beta', awayOwner: 'beta@example.com', result: null }] },
    },
    rank: { serieADay: 3, rounds: { '@': [] } },
  }],
}

test('reads one schema-v2 LiveGroup document and reuses the shared cache', async () => {
  const client = new FakeContentClient()
  client.files.set(`${target.owner}/${target.repo}/${LIVE_GROUP_DOCUMENT_PATH}@main`, { sha: 'live-0', content: JSON.stringify(group) })
  const repository = new GitHubLiveGroupRepository(new GitHubJsonStore(client), target)

  assert.equal((await repository.getLiveGroup())?.name, 'Amici')
  assert.equal((await repository.getLiveLeague('league-a'))?.name, 'Serie A')
  assert.deepEqual((await repository.getPendingGames()).map(game => game.id), ['pending'])
  assert.equal(client.reads, 1)
})

test('writes the readable LiveGroup document directly', async () => {
  const client = new FakeContentClient()
  client.files.set(`${target.owner}/${target.repo}/${LIVE_GROUP_DOCUMENT_PATH}@main`, { sha: 'live-0', content: JSON.stringify(group) })
  const repository = new GitHubLiveGroupRepository(new GitHubJsonStore(client), target)
  const loaded = await repository.getLiveGroup()
  const edited = { ...loaded!, name: 'Amici Live' }

  assert.equal(await repository.writeLiveGroup(edited), 'live-1')
  const stored = JSON.parse(client.files.get(`${target.owner}/${target.repo}/${LIVE_GROUP_DOCUMENT_PATH}@main`)!.content)
  assert.deepEqual(stored, edited)
  assert.equal('l' in stored, false)
})
