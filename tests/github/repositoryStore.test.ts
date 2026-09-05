import assert from 'node:assert/strict'
import test from 'node:test'
import {
  GitHubApiError,
  GitHubJsonStore,
  RepositoryJsonNotFoundError,
  RepositoryJsonParseError,
  RepositoryWriteConflictError,
  type RepositoryContentClient,
} from '../../src/github/src/index'

type StoredFile = { sha: string; content: string }

class FakeContentClient implements RepositoryContentClient {
  readonly files = new Map<string, StoredFile>()
  reads = 0
  writes = 0
  lastWriteSha: string | undefined
  failWriteStatus: number | null = null

  async tryGetContent(owner: string, repo: string, path: string, ref?: string): Promise<StoredFile | null> {
    this.reads += 1
    return this.files.get(key(owner, repo, path, ref)) ?? null
  }

  async putContent(owner: string, repo: string, path: string, text: string, _message: string, sha?: string, branch?: string): Promise<{ sha: string }> {
    this.writes += 1
    this.lastWriteSha = sha
    if (this.failWriteStatus) throw new GitHubApiError(this.failWriteStatus, 'synthetic write failure')
    const fileKey = key(owner, repo, path, branch)
    const existing = this.files.get(fileKey)
    if (existing && sha !== existing.sha) throw new GitHubApiError(409, 'stale sha')
    if (!existing && sha) throw new GitHubApiError(409, 'file no longer exists')
    const nextSha = `sha-${this.writes + 1}`
    this.files.set(fileKey, { sha: nextSha, content: text })
    return { sha: nextSha }
  }
}

const location = { owner: 'KeyserDSoze', repo: 'Fantazone.Demo', path: 'config/group.json', ref: 'main' }

test('caches parsed JSON and returns defensive copies', async () => {
  const client = new FakeContentClient()
  client.files.set(key(location.owner, location.repo, location.path, location.ref), { sha: 'sha-1', content: '{"name":"Demo"}' })
  const store = new GitHubJsonStore(client)
  const first = await store.readJson<{ name: string }>(location)
  first.value.name = 'mutated by caller'
  const second = await store.readJson<{ name: string }>(location)
  assert.equal(first.fromCache, false)
  assert.equal(second.fromCache, true)
  assert.equal(second.value.name, 'Demo')
  assert.equal(client.reads, 1)
})

test('refresh bypasses cache and captures a new repository SHA', async () => {
  const client = new FakeContentClient()
  const fileKey = key(location.owner, location.repo, location.path, location.ref)
  client.files.set(fileKey, { sha: 'sha-1', content: '{"revision":1}' })
  const store = new GitHubJsonStore(client)
  await store.readJson(location)
  client.files.set(fileKey, { sha: 'sha-2', content: '{"revision":2}' })
  const refreshed = await store.readJson<{ revision: number }>(location, { refresh: true })
  assert.equal(refreshed.value.revision, 2)
  assert.equal(refreshed.sha, 'sha-2')
  assert.equal(refreshed.fromCache, false)
  assert.equal(client.reads, 2)
})

test('writes reuse the cached SHA and replace it with GitHub returned SHA', async () => {
  const client = new FakeContentClient()
  const fileKey = key(location.owner, location.repo, location.path, location.ref)
  client.files.set(fileKey, { sha: 'sha-1', content: '{"revision":1}' })
  const store = new GitHubJsonStore(client)
  await store.readJson(location)
  const written = await store.writeJson(location, { revision: 2 }, 'test: update group')
  const cached = await store.readJson<{ revision: number }>(location)
  assert.equal(client.lastWriteSha, 'sha-1')
  assert.equal(written.sha, 'sha-2')
  assert.equal(cached.value.revision, 2)
  assert.equal(cached.sha, 'sha-2')
  assert.equal(client.reads, 1)
})

test('turns stale-SHA GitHub responses into an explicit write conflict', async () => {
  const client = new FakeContentClient()
  client.files.set(key(location.owner, location.repo, location.path, location.ref), { sha: 'sha-current', content: '{"revision":1}' })
  client.failWriteStatus = 409
  const store = new GitHubJsonStore(client)
  await assert.rejects(
    store.writeJson(location, { revision: 2 }, 'test: conflicting update', { expectedSha: 'sha-stale' }),
    error => error instanceof RepositoryWriteConflictError && error.status === 409,
  )
})

test('supports create-only writes and rejects an existing path', async () => {
  const client = new FakeContentClient()
  client.files.set(key(location.owner, location.repo, location.path, location.ref), { sha: 'sha-current', content: '{"name":"Demo"}' })
  const store = new GitHubJsonStore(client)
  await assert.rejects(store.writeJson(location, { name: 'Other' }, 'test: create only', { createOnly: true }), RepositoryWriteConflictError)
  assert.equal(client.writes, 0)
})

test('maps a GitHub 422 create race to RepositoryWriteConflictError', async () => {
  const client = new FakeContentClient()
  client.failWriteStatus = 422
  const store = new GitHubJsonStore(client)
  await assert.rejects(
    store.writeJson(location, { name: 'Demo' }, 'test: racing create', { createOnly: true }),
    error => error instanceof RepositoryWriteConflictError && error.status === 422,
  )
})

test('distinguishes missing and malformed JSON documents', async () => {
  const client = new FakeContentClient()
  const store = new GitHubJsonStore(client)
  await assert.rejects(store.readJson(location), RepositoryJsonNotFoundError)
  client.files.set(key(location.owner, location.repo, location.path, location.ref), { sha: 'sha-bad', content: '{not-json}' })
  await assert.rejects(store.readJson(location, { refresh: true }), RepositoryJsonParseError)
})

function key(owner: string, repo: string, path: string, ref?: string): string {
  return `${owner}/${repo}/${path}@${ref ?? ''}`
}
