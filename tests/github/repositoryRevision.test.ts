import assert from 'node:assert/strict'
import test from 'node:test'
import {
  GitHubApiError,
  REPOSITORY_MANIFEST_PATH,
  RepositoryRevisionContentClient,
  type RepositoryContentClient,
} from '../../src/github/src/index'

type StoredFile = { sha: string; content: string }

class FakeContentClient implements RepositoryContentClient {
  readonly files = new Map<string, StoredFile>()
  readonly writes: string[] = []
  conflictManifestOnce = false
  failDocumentWrite = false

  async tryGetContent(owner: string, repo: string, path: string, ref?: string): Promise<StoredFile | null> {
    return this.files.get(key(owner, repo, path, ref)) ?? null
  }

  async putContent(owner: string, repo: string, path: string, text: string, _message: string, sha?: string, branch?: string): Promise<{ sha: string }> {
    const fileKey = key(owner, repo, path, branch)
    const existing = this.files.get(fileKey)

    if (path === REPOSITORY_MANIFEST_PATH && this.conflictManifestOnce) {
      this.conflictManifestOnce = false
      this.files.set(fileKey, {
        sha: 'manifest-concurrent',
        content: JSON.stringify({ schemaVersion: 2, revision: 2, updatedAt: '2026-09-06T10:00:00.000Z' }),
      })
      throw new GitHubApiError(409, 'synthetic manifest race')
    }
    if (path === documentPath && this.failDocumentWrite) {
      throw new GitHubApiError(409, 'synthetic document race')
    }

    if (existing && sha !== existing.sha) throw new GitHubApiError(409, 'stale sha')
    const nextSha = `${path}-sha-${this.writes.length + 1}`
    this.writes.push(path)
    this.files.set(fileKey, { sha: nextSha, content: text })
    return { sha: nextSha }
  }
}

const target = { owner: 'KeyserDSoze', repo: 'Fantazone.Amici', ref: 'main' }
const documentPath = 'config/group.json'

function seedManifest(client: FakeContentClient, revision = 1) {
  client.files.set(key(target.owner, target.repo, REPOSITORY_MANIFEST_PATH, target.ref), {
    sha: `manifest-${revision}`,
    content: JSON.stringify({ schemaVersion: 2, revision, updatedAt: '2026-09-06T09:00:00.000Z' }),
  })
}

test('publishes a two-phase manifest revision around a group document write', async () => {
  const client = new FakeContentClient()
  seedManifest(client)
  client.files.set(key(target.owner, target.repo, documentPath, target.ref), { sha: 'group-1', content: '{}' })
  const revisionClient = new RepositoryRevisionContentClient(
    client,
    target,
    () => new Date('2026-09-06T12:00:00.000Z'),
  )

  await revisionClient.putContent(target.owner, target.repo, documentPath, '{"name":"Amici"}', 'test', 'group-1', target.ref)

  const manifest = JSON.parse(client.files.get(key(target.owner, target.repo, REPOSITORY_MANIFEST_PATH, target.ref))!.content)
  assert.equal(manifest.revision, 3)
  assert.equal(manifest.updatedAt, '2026-09-06T12:00:00.000Z')
  assert.equal(manifest.updating, false)
  assert.equal(revisionClient.lastRevision, 3)
  assert.deepEqual(client.writes, [REPOSITORY_MANIFEST_PATH, documentPath, REPOSITORY_MANIFEST_PATH])
})

test('retries a concurrent manifest update and preserves a monotonic stable revision', async () => {
  const client = new FakeContentClient()
  seedManifest(client)
  client.conflictManifestOnce = true
  const revisionClient = new RepositoryRevisionContentClient(client, target)

  await revisionClient.putContent(target.owner, target.repo, documentPath, '{}', 'test', undefined, target.ref)

  const manifest = JSON.parse(client.files.get(key(target.owner, target.repo, REPOSITORY_MANIFEST_PATH, target.ref))!.content)
  assert.equal(manifest.revision, 4)
  assert.equal(manifest.updating, false)
  assert.equal(revisionClient.lastRevision, 4)
  assert.deepEqual(client.writes, [REPOSITORY_MANIFEST_PATH, documentPath, REPOSITORY_MANIFEST_PATH])
})

test('best-effort closes the updating phase when the document write conflicts', async () => {
  const client = new FakeContentClient()
  seedManifest(client)
  client.failDocumentWrite = true
  const revisionClient = new RepositoryRevisionContentClient(client, target)

  await assert.rejects(
    revisionClient.putContent(target.owner, target.repo, documentPath, '{}', 'test', undefined, target.ref),
    error => error instanceof GitHubApiError && error.status === 409,
  )

  const manifest = JSON.parse(client.files.get(key(target.owner, target.repo, REPOSITORY_MANIFEST_PATH, target.ref))!.content)
  assert.equal(manifest.revision, 3)
  assert.equal(manifest.updating, false)
  assert.deepEqual(client.writes, [REPOSITORY_MANIFEST_PATH, REPOSITORY_MANIFEST_PATH])
})

test('keeps realtime signaling writes out of manifest revisions', async () => {
  const client = new FakeContentClient()
  seedManifest(client, 7)
  const revisionClient = new RepositoryRevisionContentClient(client, target)
  const realtimePath = 'realtime/auctions/auction-1/room.json'

  await revisionClient.putContent(target.owner, target.repo, realtimePath, '{}', 'signal', undefined, target.ref)

  const manifest = JSON.parse(client.files.get(key(target.owner, target.repo, REPOSITORY_MANIFEST_PATH, target.ref))!.content)
  assert.equal(manifest.revision, 7)
  assert.equal(revisionClient.lastRevision, null)
  assert.deepEqual(client.writes, [realtimePath])
})

test('keeps legacy/test clients working when manifest.json is absent', async () => {
  const client = new FakeContentClient()
  const revisionClient = new RepositoryRevisionContentClient(client, target)

  await revisionClient.putContent(target.owner, target.repo, documentPath, '{}', 'test', undefined, target.ref)

  assert.equal(revisionClient.lastRevision, null)
  assert.deepEqual(client.writes, [documentPath])
})

function key(owner: string, repo: string, path: string, ref?: string): string {
  return `${owner}/${repo}/${path}@${ref ?? ''}`
}
