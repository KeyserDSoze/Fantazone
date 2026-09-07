import assert from 'node:assert/strict'
import test from 'node:test'
import {
  GitHubClient,
  GitHubJsonStore,
  type GitHubConditionalContentReadResult,
  type GitHubContentReadResult,
  type RepositoryContentClient,
  type RepositoryJsonCacheEntry,
  type RepositoryJsonPersistentCache,
} from '../../src/github/src/index'

test('GitHubClient sends If-None-Match and accepts a 304 response', async () => {
  const previousFetch = globalThis.fetch
  let ifNoneMatch: string | null = null
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    ifNoneMatch = new Headers(init?.headers).get('If-None-Match')
    return new Response(null, { status: 304, headers: { ETag: '"etag-1"' } })
  }) as typeof fetch

  try {
    const result = await new GitHubClient('token').tryGetContentConditional(
      'KeyserDSoze',
      'Fantazone',
      'manifest.json',
      'main',
      '"etag-1"',
    )
    assert.equal(ifNoneMatch, '"etag-1"')
    assert.deepEqual(result, { status: 'not-modified', etag: '"etag-1"' })
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('GitHubClient captures ETag on a normal content response', async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify({
    sha: 'sha-1',
    content: btoa('{"revision":1}'),
    encoding: 'base64',
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ETag: 'W/"etag-1"' },
  })) as typeof fetch

  try {
    const result = await new GitHubClient().tryGetContent('KeyserDSoze', 'Fantazone', 'manifest.json', 'main')
    assert.deepEqual(result, {
      sha: 'sha-1',
      content: '{"revision":1}',
      etag: 'W/"etag-1"',
    })
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('GitHubJsonStore revalidates durable JSON with ETag and reuses it on 304', async () => {
  const client = new ConditionalFakeContentClient({
    sha: 'sha-1',
    content: '{"revision":1}',
    etag: '"etag-1"',
  })
  const cache = new FakePersistentCache()
  const location = { owner: 'KeyserDSoze', repo: 'Fantazone.Demo', path: 'manifest.json', ref: 'main' }

  const first = await new GitHubJsonStore(client, cache).readJson<{ revision: number }>(location)
  assert.equal(first.fromCache, false)
  assert.equal(client.fullReads, 1)

  const second = await new GitHubJsonStore(client, cache).readJson<{ revision: number }>(location, { refresh: true })
  assert.equal(second.fromCache, true)
  assert.equal(second.value.revision, 1)
  assert.equal(second.sha, 'sha-1')
  assert.equal(client.fullReads, 1)
  assert.equal(client.conditionalReads, 1)
  assert.equal(client.lastIfNoneMatch, '"etag-1"')
})

test('GitHubJsonStore replaces durable JSON when conditional refresh returns a changed representation', async () => {
  const client = new ConditionalFakeContentClient({
    sha: 'sha-1',
    content: '{"revision":1}',
    etag: '"etag-1"',
  })
  const cache = new FakePersistentCache()
  const location = { owner: 'KeyserDSoze', repo: 'Fantazone.Demo', path: 'manifest.json', ref: 'main' }

  await new GitHubJsonStore(client, cache).readJson(location)
  client.remote = { sha: 'sha-2', content: '{"revision":2}', etag: '"etag-2"' }

  const refreshed = await new GitHubJsonStore(client, cache).readJson<{ revision: number }>(location, { refresh: true })
  assert.equal(refreshed.fromCache, false)
  assert.equal(refreshed.value.revision, 2)
  assert.equal(refreshed.sha, 'sha-2')
  assert.equal(client.conditionalReads, 1)
  assert.equal(client.lastIfNoneMatch, '"etag-1"')

  const verified = await new GitHubJsonStore(client, cache).readJson<{ revision: number }>(location, { refresh: true })
  assert.equal(verified.fromCache, true)
  assert.equal(verified.value.revision, 2)
  assert.equal(client.lastIfNoneMatch, '"etag-2"')
})

class ConditionalFakeContentClient implements RepositoryContentClient {
  fullReads = 0
  conditionalReads = 0
  lastIfNoneMatch: string | null = null

  constructor(public remote: GitHubContentReadResult) {}

  async tryGetContent(): Promise<GitHubContentReadResult | null> {
    this.fullReads += 1
    return { ...this.remote }
  }

  async tryGetContentConditional(
    _owner: string,
    _repo: string,
    _path: string,
    _ref: string | undefined,
    etag: string,
  ): Promise<GitHubConditionalContentReadResult | null> {
    this.conditionalReads += 1
    this.lastIfNoneMatch = etag
    if (etag === this.remote.etag) return { status: 'not-modified', etag }
    return { status: 'found', value: { ...this.remote } }
  }

  async putContent(
    _owner: string,
    _repo: string,
    _path: string,
    text: string,
  ): Promise<{ sha: string }> {
    this.remote = { sha: 'sha-written', content: text }
    return { sha: this.remote.sha }
  }
}

class FakePersistentCache implements RepositoryJsonPersistentCache {
  readonly entries = new Map<string, RepositoryJsonCacheEntry>()

  async get(key: string): Promise<RepositoryJsonCacheEntry | null> {
    const entry = this.entries.get(key)
    return entry ? clone(entry) : null
  }

  async set(key: string, entry: RepositoryJsonCacheEntry): Promise<void> {
    this.entries.set(key, clone(entry))
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key)
  }

  async deleteByPrefix(prefix: string, preserveKeys: readonly string[] = []): Promise<void> {
    const preserve = new Set(preserveKeys)
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix) && !preserve.has(key)) this.entries.delete(key)
    }
  }

  async clear(): Promise<void> {
    this.entries.clear()
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
