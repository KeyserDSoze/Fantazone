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
import {
  createGroupLeague,
  deleteGroupLeague,
  initializeLeagueCalendarAndRank,
  initializeLeagueYearDefaults,
  saveAnnualLeagueSettings,
  setAnnualLeagueType,
  setMainGroupLeague,
  toggleLeagueBasket,
  type GroupLeagueAdminRuntime,
} from '../../src/app/services/groupLeagueAdminService'

const admin = { username: 'Root', email: 'root@example.test', role: IdentityRole.SuperAdmin | IdentityRole.Admin }

class FakeRuntime implements GroupLeagueAdminRuntime {
  connection = { token: 'token' }
  target = { owner: 'owner', repo: 'Fantazone.Group', ref: 'main' }
  current: Group
  calendars = new Map<string, Calendar>()
  ranks = new Map<string, Rank>()
  hall = new Map<string, unknown>()
  calendarWrites = 0
  rankWrites = 0

  constructor(group: Group) { this.current = clone(group) }
  async refreshGroup() { return clone(this.current) }
  groupRepository = { writeGroup: async (group: Group) => { this.current = clone(group); return 'group-sha' } }
  calendarRepository = {
    getCalendar: async (leagueId: string, season: number) => cloneOrNull(this.calendars.get(key(leagueId, season))),
    writeCalendar: async (leagueId: string, season: number, calendar: Calendar, _message?: string, options?: { createOnly?: boolean }) => {
      const location = key(leagueId, season)
      if (options?.createOnly && this.calendars.has(location)) throw new Error('already exists')
      this.calendars.set(location, clone(calendar)); this.calendarWrites += 1; return `calendar-${this.calendarWrites}`
    },
  }
  rankRepository = {
    getRank: async (leagueId: string, season: number) => cloneOrNull(this.ranks.get(key(leagueId, season))),
    writeRank: async (leagueId: string, season: number, rank: Rank, _message?: string, options?: { createOnly?: boolean }) => {
      const location = key(leagueId, season)
      if (options?.createOnly && this.ranks.has(location)) throw new Error('already exists')
      this.ranks.set(location, clone(rank)); this.rankWrites += 1; return `rank-${this.rankWrites}`
    },
  }
  hallOfFameRepository = { getHallOfFame: async (leagueId: string) => this.hall.get(leagueId) ?? null }
}

function baseGroup(): Group {
  return {
    id: 'g',
    name: 'Group',
    users: [admin],
    baskets: [{
      id: 'main',
      name: 'Main',
      years: [{
        year: 2026,
        teams: Array.from({ length: 4 }, (_, index) => ({ name: `Team ${index + 1}`, owner: `owner${index + 1}@example.test`, additionalOwners: [] })),
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

test('creates a default league and keeps exactly one main league', async () => {
  const runtime = new FakeRuntime(baseGroup())
  const created = await createGroupLeague(runtime, admin, { name: 'League B', year: 2026 })
  assert.equal(created.league.type, LeagueType.League)
  assert.equal(created.league.isMain, false)
  const promoted = await setMainGroupLeague(runtime, admin, created.league.id)
  assert.equal(promoted.leagues.filter(league => league.isMain).length, 1)
  assert.equal(promoted.leagues.find(league => league.isMain)?.id, created.league.id)
})

test('league basket links and annual type are immutable after Calendar or Rank materialization', async () => {
  const runtime = new FakeRuntime(baseGroup())
  runtime.current.baskets.push({ id: 'second', name: 'Second', years: [] })
  runtime.calendars.set(key('league-a', 2026), { year: 2026, rounds: {} })
  await assert.rejects(toggleLeagueBasket(runtime, admin, 'league-a', 'second'), /struttura.*materializzata/i)
  await assert.rejects(setAnnualLeagueType(runtime, admin, 'league-a', 2026, LeagueType.Cup), /struttura.*materializzata/i)
})

test('initializes a missing annual season with defaults and validates settings before save', async () => {
  const runtime = new FakeRuntime(baseGroup())
  const initialized = await initializeLeagueYearDefaults(runtime, admin, 'league-a', 2027)
  assert.equal(initialized.leagues[0].years.find(year => year.year === 2027)?.settings.startingMoney, 1000)
  const invalid = { ...DefaultLeagueSetting, startingMoney: 1 }
  await assert.rejects(saveAnnualLeagueSettings(runtime, admin, 'league-a', 2027, invalid), /non sono valide/)
  const valid = { ...DefaultLeagueSetting, startingMoney: 1200 }
  const saved = await saveAnnualLeagueSettings(runtime, admin, 'league-a', 2027, valid)
  assert.equal(saved.leagues[0].years.find(year => year.year === 2027)?.settings.startingMoney, 1200)
})

test('initial calendar/rank creation is deterministic and repairs only a missing rank on retry', async () => {
  const runtime = new FakeRuntime(baseGroup())
  const first = await initializeLeagueCalendarAndRank(runtime, admin, 'league-a', 2026)
  assert.equal(first.createdCalendar, true)
  assert.equal(first.createdRank, true)
  assert.equal(first.teamCount, 4)
  assert.equal(runtime.calendarWrites, 1)
  assert.equal(runtime.rankWrites, 1)
  const calendar = clone(runtime.calendars.get(key('league-a', 2026))!)

  runtime.ranks.delete(key('league-a', 2026))
  const repaired = await initializeLeagueCalendarAndRank(runtime, admin, 'league-a', 2026)
  assert.equal(repaired.createdCalendar, false)
  assert.equal(repaired.createdRank, true)
  assert.equal(runtime.calendarWrites, 1)
  assert.equal(runtime.rankWrites, 2)
  assert.deepEqual(runtime.calendars.get(key('league-a', 2026)), calendar)
})

test('league deletion refuses canonical season data or Hall of Fame history', async () => {
  const withRank = new FakeRuntime(baseGroup())
  withRank.ranks.set(key('league-a', 2026), { serieADay: 0, rounds: {} })
  await assert.rejects(deleteGroupLeague(withRank, admin, 'league-a'), /dati canonici/)

  const withHall = new FakeRuntime(baseGroup())
  withHall.hall.set('league-a', { winningTeams: [] })
  await assert.rejects(deleteGroupLeague(withHall, admin, 'league-a'), /Hall of Fame/)

  const empty = new FakeRuntime(baseGroup())
  const removed = await deleteGroupLeague(empty, admin, 'league-a')
  assert.equal(removed.leagues.length, 0)
})

function key(league: string, season: number) { return `${league}|${season}` }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }
function cloneOrNull<T>(value: T | undefined): T | null { return value == null ? null : clone(value) }
