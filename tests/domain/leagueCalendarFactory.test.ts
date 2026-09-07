import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DefaultLeagueSetting,
  LeagueType,
  createInitialLeagueCalendar,
  type AnnualTeam,
} from '../../src/domain/src/index'

const teams = (count: number): AnnualTeam[] => Array.from({ length: count }, (_, index) => ({
  name: `Team ${index + 1}`,
  owner: `owner${index + 1}@example.test`,
  additionalOwners: [],
}))

const settings = { ...DefaultLeagueSetting, delayedDay: 2, cancelledDay: 1 }

test('creates a deterministic repeated round-robin league through Serie A day 38', () => {
  const input = { year: 2026, leagueType: LeagueType.League, settings, teams: teams(4), seed: 'league-a' }
  const first = createInitialLeagueCalendar(input)
  const second = createInitialLeagueCalendar(input)
  assert.deepEqual(second, first)
  assert.equal(first.rounds['@'].length, 36)
  assert.equal(first.rounds['@'][0].serieADay, 3)
  assert.equal(first.rounds['@'].at(-1)?.serieADay, 38)
  assert.equal(first.rounds['@'][0].games.length, 2)
  assert.equal(first.rounds['@'][0].games.every(game => game.result?.isCancelled === true), true)
  assert.equal(first.rounds['@'][1].games.every(game => game.result === null), true)
  const ids = first.rounds['@'].flatMap(day => day.games.map(game => game.id))
  assert.equal(new Set(ids).size, ids.length)
})

test('supports an odd team count using one bye per round-robin day without crossing day 38', () => {
  const calendar = createInitialLeagueCalendar({ year: 2026, leagueType: LeagueType.League, settings, teams: teams(5), seed: 'odd' })
  assert.equal(calendar.rounds['@'].length, 35)
  assert.equal(calendar.rounds['@'].every(day => day.games.length === 2), true)
  assert.equal(calendar.rounds['@'].at(-1)?.serieADay, 37)
})

test('classic Cup creates four groups of four and twelve group-stage days', () => {
  const calendar = createInitialLeagueCalendar({ year: 2026, leagueType: LeagueType.Cup, settings, teams: teams(16), seed: 'cup' })
  assert.deepEqual(Object.keys(calendar.rounds), ['A', 'B', 'C', 'D'])
  for (const days of Object.values(calendar.rounds)) {
    assert.equal(days.length, 12)
    assert.equal(days.every(day => day.games.length === 2), true)
    const owners = new Set(days.flatMap(day => day.games.flatMap(game => [game.homeOwner, game.awayOwner])))
    assert.equal(owners.size, 4)
  }
})

test('NewCup creates one initial round-robin stage for at least sixteen teams', () => {
  const calendar = createInitialLeagueCalendar({ year: 2026, leagueType: LeagueType.NewCup, settings, teams: teams(16), seed: 'new-cup' })
  assert.deepEqual(Object.keys(calendar.rounds), ['@'])
  assert.equal(calendar.rounds['@'].length, 15)
  assert.equal(calendar.rounds['@'].every(day => day.games.length === 8), true)
  assert.equal(calendar.rounds['@'].at(-1)?.serieADay, 17)
})

test('fails closed for duplicate owners and invalid Cup size', () => {
  const duplicate = teams(4)
  duplicate[3] = { ...duplicate[3], owner: duplicate[0].owner.toUpperCase() }
  assert.throws(() => createInitialLeagueCalendar({ year: 2026, leagueType: LeagueType.League, settings, teams: duplicate }), /Owner duplicato/)
  assert.throws(() => createInitialLeagueCalendar({ year: 2026, leagueType: LeagueType.Cup, settings, teams: teams(15) }), /16 squadre/)
})
