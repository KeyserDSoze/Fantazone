import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getLegacyPlayerKey, mapLegacyCalendar, mapLegacyChances, mapLegacyGroup, mapLegacyRank,
  mapLegacyRealCalendar, mapLegacySeasonTeam, mapLegacyStats, mapLegacyTeam, mapLegacyVotes,
  unwrapRystemEntity,
} from '../../scripts/migration/legacy-mappers.mjs'

const realTeam = { n: 'Inter', a: 'INT' }
const realPlayer = { n: 'Nicolò Barella', t: realTeam, r: 2, a: true, vh: true }
const player = { ...realPlayer, p: 42, rv: 5, s: 0, k: 2 }

test('unwraps Rystem compact k/v envelope', () => {
  assert.deepEqual(unwrapRystemEntity(JSON.stringify({ k: { y: 15, d: 1 }, v: { p: [] } })), { key: { y: 15, d: 1 }, value: { p: [] }, enveloped: true })
})

test('unwraps Rystem legacy Key/Value envelope', () => {
  assert.deepEqual(unwrapRystemEntity(JSON.stringify({ Key: 15, Value: { t: [] } })), { key: 15, value: { t: [] }, enveloped: true })
})

test('player key mirrors legacy ASCII-only normalization', () => {
  assert.equal(getLegacyPlayerKey('Nicolò Barella'), 'nicolbarella')
  assert.equal(getLegacyPlayerKey("M'Bala Nzola"), 'mbalanzola')
})

test('season Team becomes schema v3 references while TeamDay remains a full snapshot', () => {
  const raw = { n: 'FC Test', o: 'owner@example.com', a: ['co@example.com'], p: [player], m: 12, d: '2026-01-01T00:00:00Z' }
  const season = mapLegacySeasonTeam(raw)
  assert.equal(season.version, 3)
  assert.deepEqual(season.players[0], { playerKey: 'nicolbarella', price: 42, revenue: 5, status: 0, position: 2 })
  assert.equal(season.players[0].name, undefined)

  const day = mapLegacyTeam(raw)
  assert.equal(day.players[0].name, 'Nicolò Barella')
  assert.deepEqual(day.players[0].team, { name: 'Inter', abbreviation: 'INT' })
})

test('maps ambiguous compact Calendar fields by type', () => {
  const result = mapLegacyCalendar({ y: 15, r: { '@': [{ a: 1, n: 7, g: [{ i: 'g1', n: 1, h: 'Home', o: 'h@x', a: 'Away', u: 'a@x', r: { h: { v: 70, d: true, g: false, o: false }, a: { v: 65, d: false, g: true, o: false }, i: false, g: 2, l: 0 } }] }] } })
  assert.equal(result.rounds['@'][0].serieADay, 1)
  assert.equal(result.rounds['@'][0].games[0].awayOwner, 'a@x')
  assert.equal(result.rounds['@'][0].games[0].result.home.defensiveBonus, true)
  assert.equal(result.rounds['@'][0].games[0].result.away.goodPeople, true)
})

test('maps Rank and computes valueAssets instead of persisting a compact alias', () => {
  const rank = mapLegacyRank({ d: 9, r: { '@': [{ n: 'T', o: 'o', p: 10, v: 3, d: 1, e: 2, g: 9, s: 5, x: 500, w: 450, z: 30, m: 100 }] } })
  assert.equal(rank.serieADay, 9)
  assert.equal(rank.rounds['@'][0].valueAssets, 130)
})

test('maps nested Group settings including multi-letter ambiguous keys', () => {
  const raw = {
    i: 'g1', n: 'Gruppo', u: [{ u: 'user', e: 'u@example.com', r: 8 }], b: [],
    l: [{ i: 'l1', n: 'Lega', m: true, t: 1, b: [], y: [{ y: 15, t: 1, s: {
      v: { '-1': { g: 3, p: 3, s: -1, d: 3, w: -3, o: -3, a: 1, y: -0.5, r: -1, j: 0, m: 2 } },
      frm: 0, lt: { t: 0, r: [], n: { t: 25, g: 1, d: 5, m: 4, f: 2, mg: 1, md: 1, mb: 1, fb: 1 }, fpy: null, ct: { c: {} } },
      s: 1000, d: 2, c: 1, g: 66, t: 6, o: 6, f: 6, p: 0, a: 3, b: 0, h: 1, '3': 2, '4': 4, '5': 6,
      gp: 2, l: 1, m: 5, n: 3, q: false, vp: false, mk: 0,
    } }] }],
  }
  const group = mapLegacyGroup(raw)
  const settings = group.leagues[0].years[0].settings
  assert.equal(settings.typeSettings.numbers.maxGoalKeepersInBench, 1)
  assert.equal(settings.pointForStrongDefense5, 6)
  assert.equal(settings.votes['-1'].manOfTheMatch, 2)
})

test('maps RealCalendar date/goals without confusing d/y meanings', () => {
  const calendar = mapLegacyRealCalendar({ y: 15, d: [{ y: 15, a: 1, g: [{ h: realTeam, a: { n: 'Milan', a: 'MIL' }, d: '2026-08-20T18:00:00Z', g: 1, y: 2, e: false }] }] })
  assert.equal(calendar.days[0].games[0].date, '2026-08-20T18:00:00Z')
  assert.equal(calendar.days[0].games[0].awayGoals, 2)
})

test('maps votes into readable singular bonus fields', () => {
  const votes = mapLegacyVotes({ p: [{ ...realPlayer, v: { r: 2, v: 6.5, i: true, g: 1, p: 0, a: 1, s: 0, d: 0, w: 0, o: 0, t: 1, c: true, h: true, u: false, n: true, j: false } }] }, 15, 3)
  assert.equal(votes.year, 15)
  assert.equal(votes.serieADay, 3)
  assert.equal(votes.players[0].vote.goal, 1)
  assert.equal(votes.players[0].vote.status, 1)
})

test('maps statistics and derives untilSerieADay from legacy games', () => {
  const rawPlayer = { ...realPlayer, z: 12, f: 18, v: 2, q: 0, np: 1, s: 1, g: 2, p: 0, u: 1, j: 0, m: 0, w: 0, o: 0, y: 1, d: 0, e: 2, c: 1, ij: 0, lg: [{ d: 3, v: 6, p: 1 }, { d: 5, v: 7, p: 2 }] }
  const stats = mapLegacyStats({ p: [rawPlayer] }, 15)
  assert.equal(stats.untilSerieADay, 5)
  assert.equal(stats.players[0].fantaSummatory, 18)
  assert.equal(stats.players[0].average, undefined)
})

test('preserves historical chance lastGame and trend in readable form', () => {
  const chances = mapLegacyChances({ p: [{ ...realPlayer, c: { f: true, g: false, m: true, s: false, t: 4, d: 'dubbio', l: { d: 8, v: 6, p: 1 }, r: 3 } }] }, 15, 9)
  assert.equal(chances.players[0].chance.lastGame.serieADay, 8)
  assert.equal(chances.players[0].chance.trend, 3)
})
