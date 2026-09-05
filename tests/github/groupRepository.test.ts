import assert from 'node:assert/strict'
import test from 'node:test'
import type { Group } from '../../src/domain/src/index'
import {
  createAndInitializeGroup,
  decodeStoredGroup,
  ensureGroupInitialized,
  FANTAZONE_SCHEMA_VERSION,
  GitHubGroupRepository,
  GitHubJsonStore,
  GROUP_DOCUMENT_PATH,
  type GroupSetupClient,
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

  async putContent(owner: string, repo: string, path: string, text: string, _message: string, sha?: string, branch?: string) {
    this.writes += 1
    const key = `${owner}/${repo}/${path}@${branch ?? ''}`
    const existing = this.files.get(key)
    if (existing && existing.sha !== sha) throw new Error('fake stale sha')
    const nextSha = `sha-${this.writes}`
    this.files.set(key, { sha: nextSha, content: text })
    return { sha: nextSha }
  }
}

const target = { owner: 'KeyserDSoze', repo: 'Fantazone.Amici', ref: 'main' }
const group: Group = {
  id: 'amici',
  name: 'Amici',
  leagues: [],
  users: [{ username: 'Ale', email: 'ale@example.com', role: 6 }],
  baskets: [],
}

test('reads users from readable group JSON and reuses the cache', async () => {
  const client = new FakeContentClient()
  client.files.set(`${target.owner}/${target.repo}/${GROUP_DOCUMENT_PATH}@main`, { sha: 'sha-0', content: JSON.stringify(group) })
  const repository = new GitHubGroupRepository(new GitHubJsonStore(client), target)

  assert.equal((await repository.getGroup())?.name, 'Amici')
  assert.equal((await repository.findUserByEmail('ALE@EXAMPLE.COM'))?.username, 'Ale')
  assert.equal(await repository.hasUser('missing@example.com'), false)
  assert.equal(client.reads, 1)
})

test('writes Group directly with readable property names', async () => {
  const client = new FakeContentClient()
  client.files.set(`${target.owner}/${target.repo}/${GROUP_DOCUMENT_PATH}@main`, { sha: 'sha-0', content: JSON.stringify(group) })
  const repository = new GitHubGroupRepository(new GitHubJsonStore(client), target)
  const edited = { ...(await repository.getGroup() as Group), name: 'Amici 2' }

  await repository.writeGroup(edited)
  const stored = JSON.parse(client.files.get(`${target.owner}/${target.repo}/${GROUP_DOCUMENT_PATH}@main`)!.content)
  assert.deepEqual(stored, { ...group, name: 'Amici 2' })
  assert.equal('n' in stored, false)
  assert.equal('u' in stored, false)
})

test('rejects the old compact group representation instead of keeping a permanent mapper', () => {
  assert.throws(() => decodeStoredGroup({ i: 'amici', n: 'Amici', l: [], u: [], b: [] }, target), /schema v2/)
})

test('accepts the early bootstrap-only group document', () => {
  const decoded = decodeStoredGroup({ name: 'Amici', repository: 'KeyserDSoze/Fantazone.Amici', schemaVersion: 1 }, target)
  assert.deepEqual(decoded, { id: 'Amici', name: 'Amici', leagues: [], users: [], baskets: [] })
})

test('new repositories initialize readable schema v2', async () => {
  const files = new Map<string, { sha: string; content: string }>()
  let write = 0
  const setup: GroupSetupClient = {
    async discoverFantazoneRepositories() { return [] },
    async createRepository() { throw new Error('not used') },
    async tryGetContent(owner, repo, path) { return files.get(`${owner}/${repo}/${path}`) ?? null },
    async putContent(owner, repo, path, content) {
      write += 1
      files.set(`${owner}/${repo}/${path}`, { sha: `setup-${write}`, content })
      return { sha: `setup-${write}` }
    },
  }
  const repo: any = { name: 'Fantazone.Amici', full_name: 'KeyserDSoze/Fantazone.Amici', owner: { login: 'KeyserDSoze' } }

  await ensureGroupInitialized(setup, repo, 'Amici')

  assert.equal(FANTAZONE_SCHEMA_VERSION, 2)
  assert.deepEqual(JSON.parse(files.get(`KeyserDSoze/Fantazone.Amici/${GROUP_DOCUMENT_PATH}`)!.content), {
    id: 'Amici', name: 'Amici', leagues: [], users: [], baskets: [],
  })
  assert.equal(JSON.parse(files.get('KeyserDSoze/Fantazone.Amici/fantazone.json')!.content).schemaVersion, 2)
})

test('new group repositories remain private by default because group.users contains member emails', async () => {
  let requestedPrivate: boolean | undefined
  const files = new Map<string, { sha: string; content: string }>()
  const repo: any = { name: 'Fantazone.Amici', full_name: 'KeyserDSoze/Fantazone.Amici', owner: { login: 'KeyserDSoze' } }
  const setup: GroupSetupClient = {
    async discoverFantazoneRepositories() { return [] },
    async createRepository(input) { requestedPrivate = input.isPrivate; return repo },
    async tryGetContent(owner, repository, path) { return files.get(`${owner}/${repository}/${path}`) ?? null },
    async putContent(owner, repository, path, content) {
      files.set(`${owner}/${repository}/${path}`, { sha: 'setup', content })
      return { sha: 'setup' }
    },
  }

  await createAndInitializeGroup(setup, 'Amici')
  assert.equal(requestedPrivate, true)
})
