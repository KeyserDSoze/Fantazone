import assert from 'node:assert/strict'
import test from 'node:test'
import type { GitHubRepo } from '../../src/github/src/index'
import {
  findStoredGroupRepository,
  reconnectStoredGroup,
  type StoredGroupReconnectClient,
} from '../../src/app/services/groupReconnect'

const storedGroup = {
  id: 'group-1',
  name: 'Amici del Bar',
  repository: 'KeyserDSoze/Fantazone.Amici-del-Bar',
}

function repository(fullName: string): GitHubRepo {
  const [owner, name] = fullName.split('/')
  return {
    name,
    full_name: fullName,
    private: true,
    owner: { login: owner },
    default_branch: 'main',
  }
}

class FakeReconnectClient implements StoredGroupReconnectClient {
  readonly calls: string[] = []
  constructor(readonly repositories: GitHubRepo[]) {}

  async validateToken() {
    this.calls.push('validate')
    return { login: 'KeyserDSoze' }
  }

  async discoverFantazoneRepositories() {
    this.calls.push('discover')
    return this.repositories
  }
}

test('matches the exact OneDrive repository full name case-insensitively', () => {
  const exact = repository('keyserdsoze/fantazone.amici-del-bar')
  const other = repository('KeyserDSoze/Fantazone.Amici')

  assert.equal(findStoredGroupRepository([other, exact], storedGroup.repository), exact)
})

test('reconnect preserves the synced group identity and trims the local PAT', async () => {
  const exact = repository(storedGroup.repository)
  const client = new FakeReconnectClient([exact])

  const connection = await reconnectStoredGroup('  github_pat_test  ', storedGroup, client)

  assert.equal(connection.token, 'github_pat_test')
  assert.equal(connection.groupName, storedGroup.name)
  assert.equal(connection.repository, exact)
  assert.deepEqual(client.calls, ['validate', 'discover'])
})

test('does not fall back to another Fantazone repository visible to the PAT', async () => {
  const client = new FakeReconnectClient([
    repository('KeyserDSoze/Fantazone.Amici-del-Bar-2'),
    repository('OtherOwner/Fantazone.Amici-del-Bar'),
  ])

  await assert.rejects(
    reconnectStoredGroup('github_pat_test', storedGroup, client),
    new RegExp(`Il PAT non può aprire il repository ${storedGroup.repository.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
  )
})

test('rejects an empty PAT before contacting GitHub', async () => {
  const client = new FakeReconnectClient([repository(storedGroup.repository)])

  await assert.rejects(reconnectStoredGroup('   ', storedGroup, client), /Inserisci il PAT GitHub/)
  assert.deepEqual(client.calls, [])
})
