import assert from 'node:assert/strict'
import test from 'node:test'
import { IdentityRole, type Group } from '../../src/domain/src/index'
import { GROUP_DOCUMENT_PATH, type RepositoryContentClient } from '../../src/github/src/index'
import { GroupSessionRuntime } from '../../src/app/services/groupSessionRuntime'

class FakeContentClient implements RepositoryContentClient {
  readonly files = new Map<string, { sha: string; content: string }>()
  reads = 0
  async tryGetContent(owner: string, repo: string, path: string, ref?: string) {
    this.reads += 1
    return this.files.get(`${owner}/${repo}/${path}@${ref ?? ''}`) ?? null
  }
  async putContent() { return { sha: 'unused' } }
}

const connection = {
  token: 'test-token',
  groupName: 'Amici',
  repository: {
    name: 'Fantazone.Amici',
    full_name: 'KeyserDSoze/Fantazone.Amici',
    private: true,
    owner: { login: 'KeyserDSoze' },
    default_branch: 'main',
  },
}

function group(role: number = IdentityRole.Participant): Group {
  return {
    id: 'amici',
    name: 'Amici',
    leagues: [],
    users: [{ username: 'Ale', email: 'ale@example.com', role }],
    baskets: [],
  }
}

test('opens one selected group and composes all repositories around one store', async () => {
  const client = new FakeContentClient()
  client.files.set(`KeyserDSoze/Fantazone.Amici/${GROUP_DOCUMENT_PATH}@main`, { sha: 'group-1', content: JSON.stringify(group()) })
  const runtime = await GroupSessionRuntime.open(connection, client)

  assert.equal(runtime.group.name, 'Amici')
  assert.deepEqual(runtime.target, { owner: 'KeyserDSoze', repo: 'Fantazone.Amici', ref: 'main' })
  assert.ok(runtime.groupRepository)
  assert.ok(runtime.calendarRepository)
  assert.ok(runtime.rankRepository)
  assert.ok(runtime.teamRepository)
  assert.equal(client.reads, 1)
})

test('re-reads selected group.users membership when resolving external identity', async () => {
  const client = new FakeContentClient()
  const key = `KeyserDSoze/Fantazone.Amici/${GROUP_DOCUMENT_PATH}@main`
  client.files.set(key, { sha: 'group-1', content: JSON.stringify(group()) })
  const runtime = await GroupSessionRuntime.open(connection, client)

  client.files.set(key, { sha: 'group-2', content: JSON.stringify(group(IdentityRole.None)) })
  const result = await runtime.resolveIdentity({ provider: 'microsoft', subject: 'external-subject', email: 'ALE@example.com' })

  assert.equal(result.status, 'disabled')
  assert.equal(client.reads, 2)
})
