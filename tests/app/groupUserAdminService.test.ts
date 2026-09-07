import assert from 'node:assert/strict'
import test from 'node:test'
import { IdentityRole, type Group } from '../../src/domain/src/index'
import {
  disableGroupMember,
  renameGroupMember,
  setGroupMemberRole,
  toggleGroupMemberRole,
  type GroupUserAdminRuntime,
} from '../../src/app/services/groupUserAdminService'

class FakeRuntime implements GroupUserAdminRuntime {
  writes = 0
  constructor(public current: Group) {}
  async refreshGroup() { return JSON.parse(JSON.stringify(this.current)) as Group }
  groupRepository = {
    writeGroup: async (group: Group) => {
      this.writes += 1
      this.current = JSON.parse(JSON.stringify(group)) as Group
      return `sha-${this.writes}`
    },
  }
}

function group(): Group {
  return {
    id: 'amici',
    name: 'Amici',
    leagues: [],
    baskets: [],
    users: [
      { username: 'Root', email: 'root@example.test', role: IdentityRole.SuperAdmin | IdentityRole.Admin },
      { username: 'Second', email: 'second@example.test', role: IdentityRole.SuperAdmin },
      { username: 'Player', email: 'player@example.test', role: IdentityRole.Participant },
      { username: 'Reader', email: 'reader@example.test', role: IdentityRole.Reader },
    ],
  }
}

test('only a fresh SuperAdmin membership can mutate group users', async () => {
  const runtime = new FakeRuntime(group())
  await assert.rejects(
    () => setGroupMemberRole(runtime, runtime.current.users[2], 'reader@example.test', IdentityRole.Participant),
    /Solo un SuperAdmin/,
  )
  assert.equal(runtime.writes, 0)
})

test('role toggles persist against fresh group state', async () => {
  const runtime = new FakeRuntime(group())
  await toggleGroupMemberRole(runtime, runtime.current.users[0], 'reader@example.test', IdentityRole.Participant)
  const reader = runtime.current.users.find(user => user.email === 'reader@example.test')!
  assert.equal((reader.role & IdentityRole.Reader) === IdentityRole.Reader, true)
  assert.equal((reader.role & IdentityRole.Participant) === IdentityRole.Participant, true)
  assert.equal(runtime.writes, 1)
})

test('disables members with IdentityRole.None but protects the current and last SuperAdmin', async () => {
  const runtime = new FakeRuntime(group())
  await disableGroupMember(runtime, runtime.current.users[0], 'player@example.test')
  assert.equal(runtime.current.users.find(user => user.email === 'player@example.test')?.role, IdentityRole.None)

  await assert.rejects(
    () => disableGroupMember(runtime, runtime.current.users[0], 'root@example.test'),
    /tuo stesso accesso/,
  )

  await setGroupMemberRole(runtime, runtime.current.users[0], 'second@example.test', IdentityRole.Reader)
  await assert.rejects(
    () => setGroupMemberRole(runtime, runtime.current.users[0], 'root@example.test', IdentityRole.Admin),
    /almeno un SuperAdmin/,
  )
})

test('renames a member without changing canonical email or roles', async () => {
  const runtime = new FakeRuntime(group())
  const beforeRole = runtime.current.users[2].role
  await renameGroupMember(runtime, runtime.current.users[0], 'player@example.test', 'Nuovo Nome')
  const member = runtime.current.users.find(user => user.email === 'player@example.test')!
  assert.equal(member.username, 'Nuovo Nome')
  assert.equal(member.role, beforeRole)
})
