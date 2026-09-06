import assert from 'node:assert/strict'
import test from 'node:test'
import { IdentityRole, type Group } from '../../src/domain/src/index'
import { GROUP_DOCUMENT_PATH, REPOSITORY_MANIFEST_PATH, type RepositoryContentClient } from '../../src/github/src/index'
import { DEFAULT_PLATFORM_TARGET, GroupSessionRuntime } from '../../src/app/services/groupSessionRuntime'

class FakeContentClient implements RepositoryContentClient {
  readonly files = new Map<string, { sha: string; content: string }>()
  reads = 0
  writes = 0
  async tryGetContent(owner: string, repo: string, path: string, ref?: string) {
    this.reads += 1
    return this.files.get(`${owner}/${repo}/${path}@${ref ?? ''}`) ?? null
  }
  async putContent(owner: string, repo: string, path: string, content: string, _message: string, _sha?: string, branch?: string) {
    this.writes += 1
    const key = `${owner}/${repo}/${path}@${branch ?? ''}`
    const sha = `write-${this.writes}`
    this.files.set(key, { sha, content })
    return { sha }
  }
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

function group(role: number = IdentityRole.Participant, name = 'Amici'): Group {
  return {
    id: 'amici',
    name,
    leagues: [],
    users: [{ username: 'Ale', email: 'ale@example.com', role }],
    baskets: [],
  }
}

function manifest(revision: number) {
  return JSON.stringify({
    schemaVersion: 2,
    revision,
    updatedAt: `2026-09-06T10:00:0${revision}.000Z`,
  })
}

test('opens one selected group and composes group plus shared platform repositories around one store', async () => {
  const client = new FakeContentClient()
  client.files.set(`KeyserDSoze/Fantazone.Amici/${GROUP_DOCUMENT_PATH}@main`, { sha: 'group-1', content: JSON.stringify(group()) })
  const runtime = await GroupSessionRuntime.open(connection, client)

  assert.equal(runtime.group.name, 'Amici')
  assert.deepEqual(runtime.target, { owner: 'KeyserDSoze', repo: 'Fantazone.Amici', ref: 'main' })
  assert.deepEqual(runtime.platformTarget, DEFAULT_PLATFORM_TARGET)
  assert.ok(runtime.groupRepository)
  assert.ok(runtime.calendarRepository)
  assert.ok(runtime.rankRepository)
  assert.ok(runtime.teamRepository)
  assert.ok(runtime.liveGroupRepository)
  assert.ok(runtime.realCalendarRepository)
  assert.equal(client.reads, 1)
})

test('allows tests or alternate deployments to override the shared platform repository target', async () => {
  const client = new FakeContentClient()
  client.files.set(`KeyserDSoze/Fantazone.Amici/${GROUP_DOCUMENT_PATH}@main`, { sha: 'group-1', content: JSON.stringify(group()) })
  const platformTarget = { owner: 'ExampleOrg', repo: 'Fantazone.Data', ref: 'production' }
  const runtime = await GroupSessionRuntime.open(connection, client, { platformTarget })
  assert.deepEqual(runtime.platformTarget, platformTarget)
})

test('uses manifest revision as the group cache invalidation clock', async () => {
  const client = new FakeContentClient()
  const groupKey = `KeyserDSoze/Fantazone.Amici/${GROUP_DOCUMENT_PATH}@main`
  const manifestKey = `KeyserDSoze/Fantazone.Amici/${REPOSITORY_MANIFEST_PATH}@main`
  client.files.set(groupKey, { sha: 'group-1', content: JSON.stringify(group()) })
  client.files.set(manifestKey, { sha: 'manifest-1', content: manifest(1) })
  const runtime = await GroupSessionRuntime.open(connection, client)

  const initial = await runtime.syncRepositoryRevision()
  assert.deepEqual(initial, { changed: false, previousRevision: null, revision: 1 })

  client.files.set(groupKey, { sha: 'group-2', content: JSON.stringify(group(IdentityRole.Participant, 'Amici aggiornati')) })
  client.files.set(manifestKey, { sha: 'manifest-2', content: manifest(2) })
  const updated = await runtime.syncRepositoryRevision()

  assert.deepEqual(updated, { changed: true, previousRevision: 1, revision: 2 })
  assert.equal(runtime.group.name, 'Amici aggiornati')
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

test('invite expectedEmail is enforced in addition to group membership', async () => {
  const client = new FakeContentClient()
  client.files.set(`KeyserDSoze/Fantazone.Amici/${GROUP_DOCUMENT_PATH}@main`, { sha: 'group-1', content: JSON.stringify(group()) })
  const runtime = await GroupSessionRuntime.open({ ...connection, expectedEmail: 'other@example.com' }, client)
  const result = await runtime.resolveIdentity({ provider: 'google', subject: 'google-subject', email: 'ale@example.com' })
  assert.equal(result.status, 'invite-email-mismatch')
})

test('only an authenticated admin can census an invited participant before sharing', async () => {
  const client = new FakeContentClient()
  const adminGroup = group(IdentityRole.Participant | IdentityRole.Admin)
  client.files.set(`KeyserDSoze/Fantazone.Amici/${GROUP_DOCUMENT_PATH}@main`, { sha: 'group-1', content: JSON.stringify(adminGroup) })
  const runtime = await GroupSessionRuntime.open(connection, client)
  const invited = await runtime.inviteMember(adminGroup.users[0], { email: 'New@Example.com', username: 'Nuovo' })
  assert.equal(invited.email, 'new@example.com')
  assert.equal(invited.role, IdentityRole.Participant)
  assert.equal(runtime.group.users.some(user => user.email === 'new@example.com'), true)
  assert.equal(client.writes, 1)
})

test('a non-admin participant cannot add an invite recipient to group.users', async () => {
  const client = new FakeContentClient()
  const participantGroup = group(IdentityRole.Participant)
  client.files.set(`KeyserDSoze/Fantazone.Amici/${GROUP_DOCUMENT_PATH}@main`, { sha: 'group-1', content: JSON.stringify(participantGroup) })
  const runtime = await GroupSessionRuntime.open(connection, client)
  await assert.rejects(
    runtime.inviteMember(participantGroup.users[0], { email: 'new@example.com' }),
    /Admin o SuperAdmin/,
  )
})
