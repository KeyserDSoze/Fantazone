import assert from 'node:assert/strict'
import test from 'node:test'
import {
  GitHubApiError,
  GitHubJsonStore,
  type RepositoryContentClient,
  type RepositoryJsonCacheEntry,
  type RepositoryJsonPersistentCache,
} from '../../src/github/src/index'

class MemoryPersistentCache implements RepositoryJsonPersistentCache {
  readonly entries = new Map<string, RepositoryJsonCacheEntry>()

  async get(key: string) { return this.entries.get(key) ?? null }
  async set(key: string, entry: RepositoryJsonCacheEntry) { this.entries.set(key, structuredClone(entry)) }
  async delete(key: string) { this.entries.delete(key) }
  async deleteByPrefix(prefix: string, preserveKeys: readonly string[] = []) {
    const preserve = new Set(preserveKeys)
    for (const key of this.entries.keys()) if (key.startsWith(prefix) && !preserve.has(key)) this.entries.delete(key)
  }
  async clear() { this.entries.clear() }
}

class SwitchingClient implements RepositoryContentClient {
  mode: 'online' | 'offline' | 'forbidden' = 'online'

  async tryGetContent() {
    if (this.mode === 'offline') throw new TypeError('Failed to fetch')
    if (this.mode === 'forbidden') throw new GitHubApiError(403, 'forbidden')
    return { sha: 'remote-sha', content: JSON.stringify({ name: 'Amici' }), etag: '"v1"' }
  }

  async tryGetContentConditional() {
    return this.tryGetContent().then(value => value ? ({ status: 'found', value } as const) : null)
  }

  async putContent() { return { sha: 'write-sha' } }
}

const location = { owner: 'KeyserDSoze', repo: 'Fantazone.Amici', path: 'config/group.json', ref: 'main' }

test('refresh falls back to the durable snapshot after a transport failure', async () => {
  const cache = new MemoryPersistentCache()
  const online = new SwitchingClient()
  const firstStore = new GitHubJsonStore(online, cache)
  const first = await firstStore.readJson<{ name: string }>(location, { refresh: true })
  assert.equal(first.fromCache, false)
  assert.equal(first.value.name, 'Amici')

  const offline = new SwitchingClient()
  offline.mode = 'offline'
  // New store simulates an application restart: only the durable cache survives.
  const restartedStore = new GitHubJsonStore(offline, cache)
  const restored = await restartedStore.readJson<{ name: string }>(location, { refresh: true })

  assert.equal(restored.fromCache, true)
  assert.equal(restored.value.name, 'Amici')
  assert.equal(restored.sha, 'remote-sha')
})

test('authorization failures remain authoritative and never fall back to stale cache', async () => {
  const cache = new MemoryPersistentCache()
  const online = new SwitchingClient()
  await new GitHubJsonStore(online, cache).readJson(location, { refresh: true })

  const forbidden = new SwitchingClient()
  forbidden.mode = 'forbidden'
  const restartedStore = new GitHubJsonStore(forbidden, cache)

  await assert.rejects(
    restartedStore.readJson(location, { refresh: true }),
    (error: unknown) => error instanceof GitHubApiError && error.status === 403,
  )
})
