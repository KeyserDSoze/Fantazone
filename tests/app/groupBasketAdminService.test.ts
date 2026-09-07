import assert from 'node:assert/strict'
import test from 'node:test'
import { IdentityRole, type Group } from '../../src/domain/src/index'
import {
  addAnnualTeam,
  copyAnnualTeamsFromPreviousYear,
  createGroupBasket,
  deleteGroupBasket,
  removeAnnualTeam,
  toggleAnnualTeamCoOwner,
  type GroupBasketAdminRuntime,
} from '../../src/app/services/groupBasketAdminService'

const superAdmin = { username: 'Root', email: 'root@example.test', role: IdentityRole.SuperAdmin | IdentityRole.Admin }

class FakeRuntime implements GroupBasketAdminRuntime {
  current: Group
  teamKeys = new Set<string>()
  calendarOwners = new Set<string>()

  constructor(group: Group) { this.current = clone(group) }

  async refreshGroup(): Promise<Group> { return clone(this.current) }

  groupRepository = {
    writeGroup: async (group: Group) => { this.current = clone(group); return 'sha' },
  }

  teamRepository = {
    getTeam: async (basketId: string, season: number, email: string) =>
      this.teamKeys.has(`${basketId}|${season}|${normalize(email)}`) ? ({ owner: email }) : null,
  }

  calendarRepository = {
    getCalendar: async (_leagueId: string, season: number) => ({
      year: season,
      rounds: {
        '@': [{
          number: 1,
          serieADay: 1,
          games: [...this.calendarOwners].map((owner, index) => ({
            id: `g${index}`,
            home: 'Home',
            away: 'Away',
            homeOwner: owner,
            awayOwner: 'other@example.test',
            result: null,
          })),
        }],
      },
    } as any),
  }
}

function group(overrides: Partial<Group> = {}): Group {
  return {
    id: 'g',
    name: 'Group',
    users: [
      superAdmin,
      { username: 'Alice', email: 'alice@example.test', role: IdentityRole.Participant },
      { username: 'Bob', email: 'bob@example.test', role: IdentityRole.Participant },
      { username: 'Carol', email: 'carol@example.test', role: IdentityRole.Participant },
    ],
    baskets: [],
    leagues: [],
    ...overrides,
  }
}

test('creates baskets and prevents one identity from belonging to two teams in the same season', async () => {
  const runtime = new FakeRuntime(group({
    baskets: [
      { id: 'a', name: 'A', years: [{ year: 2026, teams: [] }] },
      { id: 'b', name: 'B', years: [{ year: 2026, teams: [] }] },
    ],
  }))

  const created = await createGroupBasket(runtime, superAdmin, 'C', 2026)
  assert.equal(created.group.baskets.length, 3)
  assert.equal(created.basket.years[0].year, 2026)

  await addAnnualTeam(runtime, superAdmin, { basketId: 'a', year: 2026, name: 'Alice FC', owner: 'alice@example.test' })
  await assert.rejects(
    addAnnualTeam(runtime, superAdmin, { basketId: 'b', year: 2026, name: 'Alice 2', owner: 'ALICE@example.test' }),
    /già assegnato/,
  )

  await toggleAnnualTeamCoOwner(runtime, superAdmin, { basketId: 'a', year: 2026, owner: 'alice@example.test', coOwner: 'bob@example.test' })
  await assert.rejects(
    addAnnualTeam(runtime, superAdmin, { basketId: 'b', year: 2026, name: 'Bob FC', owner: 'bob@example.test' }),
    /già assegnato/,
  )
})

test('basket deletion is fail-closed for league references and contained teams', async () => {
  const referenced = new FakeRuntime(group({
    baskets: [{ id: 'a', name: 'A', years: [{ year: 2026, teams: [] }] }],
    leagues: [{ id: 'l', name: 'League', basketsId: ['a'], years: [], isMain: true, type: 1 } as any],
  }))
  await assert.rejects(deleteGroupBasket(referenced, superAdmin, 'a'), /usato da League/)

  const populated = new FakeRuntime(group({
    baskets: [{ id: 'a', name: 'A', years: [{ year: 2026, teams: [{ name: 'Alice FC', owner: 'alice@example.test', additionalOwners: [] }] }] }],
  }))
  await assert.rejects(deleteGroupBasket(populated, superAdmin, 'a'), /contiene ancora squadre/)

  const empty = new FakeRuntime(group({ baskets: [{ id: 'a', name: 'A', years: [] }] }))
  const updated = await deleteGroupBasket(empty, superAdmin, 'a')
  assert.equal(updated.baskets.length, 0)
})

test('annual-team removal refuses canonical Team or calendar references', async () => {
  const base = group({
    baskets: [{ id: 'a', name: 'A', years: [{ year: 2026, teams: [{ name: 'Alice FC', owner: 'alice@example.test', additionalOwners: [] }] }] }],
    leagues: [{ id: 'l', name: 'League', basketsId: ['a'], years: [], isMain: true, type: 1 } as any],
  })

  const materialized = new FakeRuntime(base)
  materialized.teamKeys.add('a|2026|alice@example.test')
  await assert.rejects(
    removeAnnualTeam(materialized, superAdmin, { basketId: 'a', year: 2026, owner: 'alice@example.test' }),
    /Team canonico/,
  )

  const scheduled = new FakeRuntime(base)
  scheduled.calendarOwners.add('alice@example.test')
  await assert.rejects(
    removeAnnualTeam(scheduled, superAdmin, { basketId: 'a', year: 2026, owner: 'alice@example.test' }),
    /calendario di League/,
  )

  const safe = new FakeRuntime(base)
  const updated = await removeAnnualTeam(safe, superAdmin, { basketId: 'a', year: 2026, owner: 'alice@example.test' })
  assert.equal(updated.baskets[0].years[0].teams.length, 0)
})

test('copy from previous year skips identities already assigned elsewhere', async () => {
  const runtime = new FakeRuntime(group({
    baskets: [
      {
        id: 'a',
        name: 'A',
        years: [{
          year: 2025,
          teams: [
            { name: 'Alice FC', owner: 'alice@example.test', additionalOwners: [] },
            { name: 'Bob FC', owner: 'bob@example.test', additionalOwners: [] },
          ],
        }],
      },
      {
        id: 'b',
        name: 'B',
        years: [{ year: 2026, teams: [{ name: 'Alice elsewhere', owner: 'alice@example.test', additionalOwners: [] }] }],
      },
    ],
  }))

  const result = await copyAnnualTeamsFromPreviousYear(runtime, superAdmin, { basketId: 'a', year: 2026 })
  assert.equal(result.copied, 1)
  assert.deepEqual(result.skipped, ['Alice FC'])
  assert.deepEqual(result.group.baskets.find(item => item.id === 'a')?.years.find(item => item.year === 2026)?.teams.map(team => team.name), ['Bob FC'])
})

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }
function normalize(value: string): string { return value.trim().toLowerCase() }
