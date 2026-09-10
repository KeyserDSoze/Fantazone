import assert from 'node:assert/strict'
import test from 'node:test'
import { IdentityRole, type Group } from '../../src/domain/src/index'
import {
  GitHubApiError,
  GROUP_DOCUMENT_PATH,
  GROUP_SETTINGS_PATH,
  REPOSITORY_MANIFEST_PATH,
  type RepositoryContentClient,
} from '../../src/github/src/index'
import { DEFAULT_PLATFORM_TARGET, GroupSessionRuntime } from '../../src/app/services/groupSessionRuntime'

class FakeContentClient implements RepositoryContentClient {
  readonly files = new Map<string, { sha: string; content: string }>()
  reads = 0
  writes = 0
  conflictGroupWriteOnce = false
  readonly readsByPath = new Map<string, number>()

  async tryGetContent(owner: string, repo: string, path: string, ref?: string) {
    this.reads += 1
    this.readsByPath.set(path, (this.readsByPath.get(path) ?? 0) + 1)
    return this.files.get(`${owner}/${repo}/${path}@${ref ?? ''}`) ?? null
  }

  async putContent(owner: string, repo: string, path: string, content: string, _message: string, _sha?: string, branch?: string) {
    if (path === GROUP_DOCUMENT_PATH && this.conflictGroupWriteOnce) {
      this.conflictGroupWriteOnce = false
      throw new GitHubApiError(409, 'synthetic group race')
    }
    this.writes += 1
    const key = `${owner}/${repo}/${path}@${branch ?? ''}`
    const sha = `write-${this.writes}`
    this.files.set(key, { sha, content })
    return { sha }
  }

  readCount(path: string): number {
    return this.readsByPath.get(path) ?? 0
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

function manifest(
  revision: number,
  updating = false,
  updatedAt = `2026-09-06T10:00:0${revision}.000Z`,
) {
  return JSON.stringify({
    schemaVersion: 2,
    revision,
    updatedAt,
    updating,
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
  assert.ok(runtime.groupSettingsRepository)
  assert.ok(runtime.calendarRepository)
  assert.ok(runtime.rankRepository)
  assert.ok(runtime.teamRepository)
  assert.ok(runtime.liveGroupRepository)
  assert.ok(runtime.realCalendarRepository)
  assert.equal(client.readCount(GROUP_DOCUMENT_PATH), 1)
  assert.equal(client.readCount(GROUP_SETTINGS_PATH), 1)
  assert.equal(client.writes, 0)
})

test('overlays root display settings without mutating the canonical group document', async () => {
  const client = new FakeContentClient()
  const canonical = group()
  client.files.set(`KeyserDSoze/Fantazone.Amici/${GROUP_DOCUMENT_PATH}@main`, { sha: 'group-1', content: JSON.stringify(canonical) })
  client.files.set(`KeyserDSoze/Fantazone.Amici/${GROUP_SETTINGS_PATH}@main`, {
    sha: 'settings-1',
    content: JSON.stringify({ version: 1, group: { name: 'Nome nuovo' }, leagues: {} }),
  })

  const runtime = await GroupSessionRuntime.open({ ...connection }, client)
  assert.equal(runtime.group.name, 'Nome nuovo')
  assert.equal(runtime.connection.groupName, 'Nome nuovo')
  assert.equal(canonical.name, 'Amici')
  assert.equal(client.writes, 0)
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
  assert.deepEqual(initial, { changed: false, previousRevision: null, revision: 1, offline: false })

  client.files.set(groupKey, { sha: 'group-2', content: JSON.stringify(group(IdentityRole.Participant, 'Amici aggiornati')) })
  client.files.set(manifestKey, { sha: 'manifest-2', content: manifest(2) })
  const updated = await runtime.syncRepositoryRevision()

  assert.deepEqual(updated, { changed: true, previousRevision: 1, revision: 2, offline: false })
  assert.equal(runtime.group.name, 'Amici aggiornati')
})

test('treats a fresh in-flight manifest revision as stale on every poll until it becomes stable', async () => {
  const client = new FakeContentClient()
  const groupKey = `KeyserDSoze/Fantazone.Amici/${GROUP_DOCUMENT_PATH}@main`
  const manifestKey = `KeyserDSoze/Fantazone.Amici/${REPOSITORY_MANIFEST_PATH}@main`
  client.files.set(groupKey, { sha: 'group-1', content: JSON.stringify(group()) })
  client.files.set(manifestKey, { sha: 'manifest-1', content: manifest(1) })
  const runtime = await GroupSessionRuntime.open(connection, client, {
    now: () => new Date('2026-09-06T10:00:30.000Z'),
  })
  await runtime.syncRepositoryRevision()

  client.files.set(groupKey, { sha: 'group-2', content: JSON.stringify(group(IdentityRole.Participant, 'Durante update')) })
  client.files.set(manifestKey, { sha: 'manifest-2', content: manifest(2, true) })
  const firstInFlight = await runtime.syncRepositoryRevision()
  const secondInFlight = await runtime.syncRepositoryRevision()

  assert.deepEqual(firstInFlight, { changed: true, previousRevision: 1, revision: 2, offline: false })
  assert.deepEqual(secondInFlight, { changed: true, previousRevision: 2, revision: 2, offline: false })
  assert.equal(runtime.group.name, 'Durante update')
  assert.equal(client.writes, 0)

  client.files.set(groupKey, { sha: 'group-3', content: JSON.stringify(group(IdentityRole.Participant, 'Update completato')) })
  client.files.set(manifestKey, { sha: 'manifest-3', content: manifest(3, false) })
  const stable = await runtime.syncRepositoryRevision()
  assert.deepEqual(stable, { changed: true, previousRevision: 2, revision: 3, offline: false })
  assert.equal(runtime.group.name, 'Update completato')
})

test('self-heals an abandoned in-flight manifest after the stale threshold', async () => {
  const client = new FakeContentClient()
  const groupKey = `KeyserDSoze/Fantazone.Amici/${GROUP_DOCUMENT_PATH}@main`
  const manifestKey = `KeyserDSoze/Fantazone.Amici/${REPOSITORY_MANIFEST_PATH}@main`
  client.files.set(groupKey, { sha: 'group-1', content: JSON.stringify(group()) })
  client.files.set(manifestKey, { sha: 'manifest-1', content: manifest(1) })
  const runtime = await GroupSessionRuntime.open(connection, client, {
    now: () => new Date('2026-09-06T10:10:00.000Z'),
  })
  await runtime.syncRepositoryRevision()

  client.files.set(groupKey, { sha: 'group-2', content: JSON.stringify(group(IdentityRole.Participant, 'Dopo crash')) })
  client.files.set(manifestKey, {
    sha: 'manifest-2',
    content: manifest(2, true, '2026-09-06T10:00:00.000Z'),
  })

  const healed = await runtime.syncRepositoryRevision()
  const persistedManifest = JSON.parse(client.files.get(manifestKey)!.content)

  assert.deepEqual(healed, { changed: true, previousRevision: 1, revision: 3, offline: false })
  assert.equal(persistedManifest.revision, 3)
  assert.equal(persistedManifest.updating, false)
  assert.equal(persistedManifest.updatedAt, '2026-09-06T10:10:00.000Z')
  assert.equal(runtime.group.name, 'Dopo crash')
  assert.equal(client.writes, 1)

  const stable = await runtime.syncRepositoryRevision()
  assert.deepEqual(stable, { changed: false, previousRevision: 3, revision: 3, offline: false })
})

test('re-reads selected group.users membership when resolving external identity', async () => {
  const client = new FakeContentClient()
  const key = `KeyserDSoze/Fantazone.Amici/${GROUP_DOCUMENT_PATH}@main`
  client.files.set(key, { sha: 'group-1', content: JSON.stringify(group()) })
  const runtime = await GroupSessionRuntime.open(connection, client)

  client.files.set(key, { sha: 'group-2', content: JSON.stringify(group(IdentityRole.None)) })
  const result = await runtime.resolveIdentity({ provider: 'microsoft', subject: 'external-subject', email: 'ALE@example.com' })

  assert.equal(result.status, 'disabled')
  assert.equal(client.readCount(GROUP_DOCUMENT_PATH), 2)
  assert.equal(client.readCount(GROUP_SETTINGS_PATH), 2)
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

test('reissuing an email invitation to an existing active member does not rewrite group.json', async () => {
  const client = new FakeContentClient()
  const adminGroup = group(IdentityRole.Participant | IdentityRole.Admin)
  client.files.set(`KeyserDSoze/Fantazone.Amici/${GROUP_DOCUMENT_PATH}@main`, { sha: 'group-1', content: JSON.stringify(adminGroup) })
  const runtime = await GroupSessionRuntime.open(connection, client)

  const invited = await runtime.inviteMember(adminGroup.users[0], { email: 'ALE@example.com' })

  assert.equal(invited.email, 'ale@example.com')
  assert.equal(client.writes, 0)
})

test('email census retries a transient optimistic group write conflict', async () => {
  const client = new FakeContentClient()
  const adminGroup = group(IdentityRole.Participant | IdentityRole.Admin)
  client.files.set(`KeyserDSoze/Fantazone.Amici/${GROUP_DOCUMENT_PATH}@main`, { sha: 'group-1', content: JSON.stringify(adminGroup) })
  client.conflictGroupWriteOnce = true
  const runtime = await GroupSessionRuntime.open(connection, client)

  const invited = await runtime.inviteMember(adminGroup.users[0], { email: 'new@example.com' })

  assert.equal(invited.email, 'new@example.com')
  assert.equal(runtime.group.users.some(user => user.email === 'new@example.com'), true)
  assert.equal(client.writes, 1)
})

test('a non-admin participant cannot add an email invite recipient to group.users', async () => {
  const client = new FakeContentClient()
  const participantGroup = group(IdentityRole.Participant)
  client.files.set(`KeyserDSoze/Fantazone.Amici/${GROUP_DOCUMENT_PATH}@main`, { sha: 'group-1', content: JSON.stringify(participantGroup) })
  const runtime = await GroupSessionRuntime.open(connection, client)
  await assert.rejects(
    runtime.inviteMember(participantGroup.users[0], { email: 'new@example.com' }),
    /Admin o SuperAdmin/,
  )
})

test('shared invitation self-enrolls a verified Microsoft identity only as Participant', async () => {
  const client = new FakeContentClient()
  client.files.set(`KeyserDSoze/Fantazone.Amici/${GROUP_DOCUMENT_PATH}@main`, { sha: 'group-1', content: JSON.stringify(group()) })
  const runtime = await GroupSessionRuntime.open(connection, client)

  const member = await runtime.ensureSharedInviteParticipant({
    provider: 'microsoft',
    subject: 'new-subject',
    email: 'NEW@example.com',
    displayName: 'Nuovo Utente',
  })

  assert.equal(member.email, 'new@example.com')
  assert.equal(member.username, 'Nuovo Utente')
  assert.equal(member.role, IdentityRole.Participant)
  assert.equal(runtime.group.users.some(user => user.email === 'new@example.com'), true)
  assert.equal(client.writes, 1)
})

test('shared invitation does not rewrite an existing active member', async () => {
  const client = new FakeContentClient()
  client.files.set(`KeyserDSoze/Fantazone.Amici/${GROUP_DOCUMENT_PATH}@main`, { sha: 'group-1', content: JSON.stringify(group()) })
  const runtime = await GroupSessionRuntime.open(connection, client)

  const member = await runtime.ensureSharedInviteParticipant({
    provider: 'microsoft',
    subject: 'ale-subject',
    email: 'ALE@example.com',
  })

  assert.equal(member.email, 'ale@example.com')
  assert.equal(client.writes, 0)
})

test('shared invitation cannot reactivate a deliberately disabled member', async () => {
  const client = new FakeContentClient()
  client.files.set(`KeyserDSoze/Fantazone.Amici/${GROUP_DOCUMENT_PATH}@main`, { sha: 'group-1', content: JSON.stringify(group(IdentityRole.None)) })
  const runtime = await GroupSessionRuntime.open(connection, client)

  await assert.rejects(
    runtime.ensureSharedInviteParticipant({ provider: 'microsoft', subject: 'ale-subject', email: 'ale@example.com' }),
    /disabilitato/,
  )
  assert.equal(client.writes, 0)
})

test('shared invitation enrollment retries a transient optimistic conflict', async () => {
  const client = new FakeContentClient()
  client.files.set(`KeyserDSoze/Fantazone.Amici/${GROUP_DOCUMENT_PATH}@main`, { sha: 'group-1', content: JSON.stringify(group()) })
  client.conflictGroupWriteOnce = true
  const runtime = await GroupSessionRuntime.open(connection, client)

  const member = await runtime.ensureSharedInviteParticipant({
    provider: 'microsoft',
    subject: 'new-subject',
    email: 'new@example.com',
  })

  assert.equal(member.role, IdentityRole.Participant)
  assert.equal(client.writes, 1)
})
