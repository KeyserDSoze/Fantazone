import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DefaultLeagueSetting,
  IdentityRole,
  LeagueType,
  type Calendar,
  type Group,
  type Rank,
} from '../../src/domain/src/index'
import { RepositoryWriteConflictError } from '../../src/github/src/index'
import {
  initializeLeagueCalendarAndRank,
  type GroupLeagueAdminRuntime,
} from '../../src/app/services/groupLeagueAdminService'

const admin = { username: 'Root', email: 'root@example.test', role: IdentityRole.SuperAdmin | IdentityRole.Admin }

class RacingRuntime implements GroupLeagueAdminRuntime {
  connection = { token: 'token' }
  target = { owner: 'owner', repo: 'Fantazone.Group', ref: 'main' }
  current = group()
  calendar: Calendar | null = null
  rank: Rank | null = null
  raceCalendar = true
  raceRank = true
  leaveCalendarMissing = false
  incompatibleCalendar = false

  async refreshGroup() { return clone(this.current) }
  groupRepository = { writeGroup: async (value: Group) => { this.current = clone(value); return 'group-sha' } }
  calendarRepository = {
    getCalendar: async () => cloneOrNull(this.calendar),
    writeCalendar: async (_leagueId: string, _season: number, value: Calendar) => {
      if (!this.raceCalendar) {
        this.calendar = clone(value)
        return 'calendar-sha'
      }
      this.raceCalendar = false
      if (!this.leaveCalendarMissing) {
        this.calendar = this.incompatibleCalendar
          ? { year: 2026, rounds: {} }
          : clone(value)
      }
      throw conflict('data/groups/seasons/2026/leagues/league-a/calendar.json')
    },
  }
  rankRepository = {
    getRank: async () => cloneOrNull(this.rank),
    writeRank: async (_leagueId: string, _season: number, value: Rank) => {
      if (!this.raceRank) {
        this.rank = clone(value)
        return 'rank-sha'
      }
      this.raceRank = false
      this.rank = clone(value)
      throw conflict('data/groups/seasons/2026/leagues/league-a/rank.json')
    },
  }
  hallOfFameRepository = { getHallOfFame: async () => null }
}

test('concurrent create-only Calendar and Rank races converge to the canonical winners', async () => {
  const runtime = new RacingRuntime()

  const result = await initializeLeagueCalendarAndRank(runtime, admin, 'league-a', 2026)

  assert.equal(result.createdCalendar, false)
  assert.equal(result.createdRank, false)
  assert.equal(result.teamCount, 4)
  assert.ok(runtime.calendar)
  assert.ok(runtime.rank)
  assert.equal(runtime.raceCalendar, false)
  assert.equal(runtime.raceRank, false)
})

test('a Calendar conflict is not swallowed when the canonical winner cannot be read', async () => {
  const runtime = new RacingRuntime()
  runtime.leaveCalendarMissing = true

  await assert.rejects(
    initializeLeagueCalendarAndRank(runtime, admin, 'league-a', 2026),
    error => error instanceof RepositoryWriteConflictError,
  )
  assert.equal(runtime.rank, null)
})

test('a concurrently-created incompatible Calendar still fails closed', async () => {
  const runtime = new RacingRuntime()
  runtime.incompatibleCalendar = true

  await assert.rejects(
    initializeLeagueCalendarAndRank(runtime, admin, 'league-a', 2026),
    /Calendar esistente non corrisponde più al roster configurato/i,
  )
  assert.equal(runtime.rank, null)
})

function group(): Group {
  return {
    id: 'g',
    name: 'Group',
    users: [admin],
    baskets: [{
      id: 'main',
      name: 'Main',
      years: [{
        year: 2026,
        teams: Array.from({ length: 4 }, (_, index) => ({
          name: `Team ${index + 1}`,
          owner: `owner${index + 1}@example.test`,
          additionalOwners: [],
        })),
      }],
    }],
    leagues: [{
      id: 'league-a',
      name: 'League A',
      isMain: true,
      type: LeagueType.League,
      basketsId: ['main'],
      years: [{ year: 2026, type: LeagueType.League, settings: clone(DefaultLeagueSetting) }],
    }],
  }
}

function conflict(path: string): RepositoryWriteConflictError {
  return new RepositoryWriteConflictError({ owner: 'owner', repo: 'Fantazone.Group', path, ref: 'main' }, 409)
}

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }
function cloneOrNull<T>(value: T | null): T | null { return value == null ? null : clone(value) }
