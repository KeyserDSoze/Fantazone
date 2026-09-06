import assert from 'node:assert/strict'
import test from 'node:test'
import {
  GitHubApiError,
  GROUP_DOCUMENT_PATH,
  REPOSITORY_MANIFEST_PATH,
  type GitHubRepo,
} from '../../src/github/src/index'
import {
  reconnectStoredGroup,
  shouldRecoverStoredGroupCredential,
  StoredGroupRepositoryAccessError,
  StoredGroupRepositoryContractError,
  StoredGroupRepositoryReadError,
  StoredGroupRepositoryWriteError,
  type StoredGroupReconnectClient,
} from '../../src/app/services/groupReconnect'

const storedGroup = {
  id: 'group-1',
  name: 'Amici del Bar',
  repository: 'KeyserDSoze/Fantazone.Amici-del-Bar',
  pat: 'github_pat_shared',
}

function repository(
  fullName: string,
  permissions: GitHubRepo['permissions'] = { pull: true, push: true, admin: false },
): GitHubRepo {
  const [owner, name] = fullName.split('/')
  return {
    name,
    full_name: fullName,
    private: true,
    owner: { login: owner },
    default_branch: 'main',
    permissions,
  }
}

class FakeReconnectClient implements StoredGroupReconnectClient {
  readonly calls: string[] = []
  repo = repository(storedGroup.repository)
  manifest: unknown = { schemaVersion: 2, revision: 1, updatedAt: '2026-09-06T12:00:00Z', updating: false }
  group: unknown = { id: 'amici', name: 'Amici del Bar', users: [], leagues: [], baskets: [] }

  async validateToken() {
    this.calls.push('validate')
    return { login: 'KeyserDSoze' }
  }

  async getRepository(owner: string, repo: string) {
    this.calls.push(`repo:${owner}/${repo}`)
    return this.repo
  }

  async getContent(owner: string, repo: string, path: string, ref?: string) {
    this.calls.push(`content:${owner}/${repo}/${path}@${ref ?? ''}`)
    const value = path === REPOSITORY_MANIFEST_PATH ? this.manifest : path === GROUP_DOCUMENT_PATH ? this.group : null
    if (value == null) throw new GitHubApiError(404, 'missing')
    return { sha: `sha-${path}`, content: JSON.stringify(value) }
  }
}

test('reconnect preflights the exact repository and trims the shared PAT', async () => {
  const client = new FakeReconnectClient()

  const connection = await reconnectStoredGroup('  github_pat_test  ', storedGroup, client)

  assert.equal(connection.token, 'github_pat_test')
  assert.equal(connection.groupName, storedGroup.name)
  assert.equal(connection.repository, client.repo)
  assert.deepEqual(client.calls, [
    'validate',
    'repo:KeyserDSoze/Fantazone.Amici-del-Bar',
    `content:KeyserDSoze/Fantazone.Amici-del-Bar/${REPOSITORY_MANIFEST_PATH}@main`,
    `content:KeyserDSoze/Fantazone.Amici-del-Bar/${GROUP_DOCUMENT_PATH}@main`,
  ])
})

test('does not accept a different repository returned by GitHub', async () => {
  const client = new FakeReconnectClient()
  client.repo = repository('KeyserDSoze/Fantazone.Altro')

  await assert.rejects(
    reconnectStoredGroup('github_pat_test', storedGroup, client),
    error => error instanceof StoredGroupRepositoryAccessError && error.repository === storedGroup.repository,
  )
})

test('fails closed when the token lacks repository read access', async () => {
  const client = new FakeReconnectClient()
  client.repo = repository(storedGroup.repository, { pull: false, push: true })
  await assert.rejects(reconnectStoredGroup('github_pat_test', storedGroup, client), StoredGroupRepositoryReadError)
})

test('fails closed when the token lacks repository write access', async () => {
  const client = new FakeReconnectClient()
  client.repo = repository(storedGroup.repository, { pull: true, push: false })
  await assert.rejects(reconnectStoredGroup('github_pat_test', storedGroup, client), StoredGroupRepositoryWriteError)
})

test('validates manifest and group documents before returning a connection', async () => {
  const client = new FakeReconnectClient()
  client.manifest = { revision: 'broken' }
  await assert.rejects(reconnectStoredGroup('github_pat_test', storedGroup, client), StoredGroupRepositoryContractError)
})

test('marks expired or repository-permission credentials for reconnect', () => {
  assert.equal(shouldRecoverStoredGroupCredential(new GitHubApiError(401, 'expired')), true)
  assert.equal(shouldRecoverStoredGroupCredential(new StoredGroupRepositoryAccessError(storedGroup.repository)), true)
  assert.equal(shouldRecoverStoredGroupCredential(new StoredGroupRepositoryReadError(storedGroup.repository)), true)
  assert.equal(shouldRecoverStoredGroupCredential(new StoredGroupRepositoryWriteError(storedGroup.repository)), true)
})

test('does not replace a shared credential for transient or repository-contract failures', () => {
  assert.equal(shouldRecoverStoredGroupCredential(new GitHubApiError(403, 'rate limited')), false)
  assert.equal(shouldRecoverStoredGroupCredential(new StoredGroupRepositoryContractError(storedGroup.repository, 'bad manifest')), false)
  assert.equal(shouldRecoverStoredGroupCredential(new Error('network unavailable')), false)
})

test('rejects an empty PAT before contacting GitHub', async () => {
  const client = new FakeReconnectClient()

  await assert.rejects(reconnectStoredGroup('   ', storedGroup, client), /Inserisci il PAT GitHub condiviso/)
  assert.deepEqual(client.calls, [])
})
