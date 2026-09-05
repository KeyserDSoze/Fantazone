import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ChanceType,
  Role,
  TrendType,
  defaultChance,
  mergePlayerChances,
  normalizeChanceName,
  type ChancedRealPlayer,
  type RealPlayers,
} from '../../src/domain/src/index'

const realPlayers: RealPlayers = {
  year: 15,
  players: [
    { name: "Danilo D'Ambrosio", team: { name: 'Inter', abbreviation: 'INT' }, role: Role.Defensor, isActive: true, visible: true },
    { name: 'Mario Rossi', team: { name: 'Roma', abbreviation: 'ROM' }, role: Role.Forward, isActive: true, visible: true },
  ],
}

function parsed(name: string, team: string, chance: Partial<ReturnType<typeof defaultChance>>): ChancedRealPlayer {
  return {
    name,
    team: { name: team, abbreviation: team.slice(0, 3).toUpperCase() },
    role: Role.Forward,
    isActive: true,
    visible: true,
    chance: { ...defaultChance(), ...chance },
  }
}

test('initializes chance snapshot from global RealPlayers', () => {
  const value = mergePlayerChances({ realPlayers, serieADay: 3, parserResults: [] })
  assert.equal(value.year, 15)
  assert.equal(value.serieADay, 3)
  assert.equal(value.players.length, 2)
  assert.deepEqual(value.players[0].chance, defaultChance())
})

test('refresh resets current source/status fields but preserves trend and last game', () => {
  const existing = mergePlayerChances({ realPlayers, serieADay: 3, parserResults: [] })
  existing.players[0].chance = {
    ...existing.players[0].chance,
    fantagazzetta: true,
    gazzetta: true,
    status: ChanceType.Injury,
    description: 'Vecchio infortunio',
    trend: TrendType.Excellent,
    lastGame: { serieADay: 2, vote: 7, positiveness: 2 },
  }

  const refreshed = mergePlayerChances({ realPlayers, existing, serieADay: 3, parserResults: [] })
  assert.equal(refreshed.players[0].chance.fantagazzetta, false)
  assert.equal(refreshed.players[0].chance.gazzetta, false)
  assert.equal(refreshed.players[0].chance.status, ChanceType.Normal)
  assert.equal(refreshed.players[0].chance.description, null)
  assert.equal(refreshed.players[0].chance.trend, TrendType.Excellent)
  assert.deepEqual(refreshed.players[0].chance.lastGame, { serieADay: 2, vote: 7, positiveness: 2 })
})

test('merges source booleans and lets later parser status/description win like legacy job', () => {
  const value = mergePlayerChances({
    realPlayers,
    serieADay: 3,
    parserResults: [
      [parsed('Mario Rossi', 'Roma', { fantagazzetta: true, status: ChanceType.Maybe, description: 'In dubbio' })],
      [parsed('Mario Rossi', 'Roma', { gazzetta: true, status: ChanceType.Injury, description: 'Problema muscolare' })],
    ],
  })

  const mario = value.players.find(player => player.name === 'Mario Rossi')!
  assert.equal(mario.chance.fantagazzetta, true)
  assert.equal(mario.chance.gazzetta, true)
  assert.equal(mario.chance.status, ChanceType.Injury)
  assert.equal(mario.chance.description, 'Problema muscolare')
})

test('falls back to normalized longest surname part plus team when exact legacy key differs', () => {
  const value = mergePlayerChances({
    realPlayers,
    serieADay: 3,
    parserResults: [[parsed('Dambrosio', 'INTER', { gazzetta: true, status: ChanceType.Maybe })]],
  })
  const player = value.players.find(item => item.name.includes("D'Ambrosio"))!
  assert.equal(player.chance.gazzetta, true)
  assert.equal(player.chance.status, ChanceType.Maybe)
})

test('normalizes accents, apostrophes, html entities and spaces', () => {
  assert.equal(normalizeChanceName("  D&#39;Àmbrosio  "), 'dambrosio')
})
