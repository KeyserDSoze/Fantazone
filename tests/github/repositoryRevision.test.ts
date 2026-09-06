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

test('advances manifest revision before writing a group document', async () => {
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
  assert.equal(manifest.revision, 2)
  assert.equal(manifest.updatedAt, '2026-09-06T12:00:00.000Z')
  assert.equal(revisionClient.lastRevision, 2)
  assert.deepEqual(client.writes, [REPOSITORY_MANIFEST_PATH, documentPath])
})

test('retries a concurrent manifest update and preserves a monotonic revision', async () => {
  const client = new FakeContentClient()
  seedManifest(client)
  client.conflictManifestOnce = true
  const revisionClient = new RepositoryRevisionContentClient(client, target)

  await revisionClient.putContent(target.owner, target.repo, documentPath, '{}', 'test', undefined, target.ref)

  const manifest = JSON.parse(client.files.get(key(target.owner, target.repo, REPOSITORY_MANIFEST_PATH, target.ref))!.content)
  assert.equal(manifest.revision, 3)
  assert.equal(revisionClient.lastRevision, 3)
  assert.deepEqual(client.writes, [REPOSITORY_MANIFEST_PATH, documentPath])
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
