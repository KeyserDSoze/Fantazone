import assert from 'node:assert/strict'
import test from 'node:test'
import type { LiveGroupRaw } from '../../src/domain/src/index'
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
    const sha = `write-${this.writes}`
    this.files.set(`${owner}/${repo}/${path}@${branch ?? ''}`, { sha, content: text })
    return { sha }
  }
}

const target = { owner: 'KeyserDSoze', repo: 'Fantazone.Amici', ref: 'main' }
const raw: LiveGroupRaw = {
  n: 'Amici',
  l: [{ i: 'league-a', l: 'Serie A', d: { '@': [{ a: 3, n: 3, g: [] }] }, r: null }],
}

test('reads the exact LiveGroupRaw snapshot and reuses GitHubJsonStore cache', async () => {
  const client = new FakeContentClient()
  client.files.set(`${target.owner}/${target.repo}/${LIVE_GROUP_DOCUMENT_PATH}@main`, { sha: 'live-1', content: JSON.stringify(raw) })
  const repository = new GitHubLiveGroupRepository(new GitHubJsonStore(client), target)

  assert.deepEqual(await repository.getRawLiveGroup(), raw)
  assert.equal((await repository.getLiveLeague('league-a'))?.name, 'Serie A')
  assert.equal(client.reads, 1)
})

test('writes raw snapshots directly so DayRaw[] shape is never lost', async () => {
  const client = new FakeContentClient()
  client.files.set(`${target.owner}/${target.repo}/${LIVE_GROUP_DOCUMENT_PATH}@main`, { sha: 'live-1', content: JSON.stringify(raw) })
  const repository = new GitHubLiveGroupRepository(new GitHubJsonStore(client), target)
  await repository.getRawLiveGroup()
  await repository.writeRawLiveGroup(raw)

  const stored = client.files.get(`${target.owner}/${target.repo}/${LIVE_GROUP_DOCUMENT_PATH}@main`)
  assert.deepEqual(JSON.parse(stored!.content), raw)
  assert.ok(Array.isArray((JSON.parse(stored!.content) as LiveGroupRaw).l[0].d?.['@']))
})
