import assert from 'node:assert/strict'
import test from 'node:test'
import {
  Role,
  getPlayerKey,
  reconcileRealPlayers,
  type RealPlayer,
  type RealPlayers,
} from '../../src/domain/src/index'

test('player key mirrors legacy lowercase ASCII-only behavior', () => {
  assert.equal(getPlayerKey("N'Golo Kanté 7"), 'ngolokant')
  assert.equal(getPlayerKey('João Félix'), 'jooflix')
  assert.equal(getPlayerKey(''), '')
})

test('fresh source wins, missing historical players become inactive and order stays legacy-compatible', () => {
  const existing: RealPlayers = {
    year: 15,
    players: [
      player('Existing player', 'Roma', true),
      player('Transferred player', 'Roma', true),
      player('Returning player', 'Milan', false),
    ],
  }
  const current = [
    player('Transferred player', 'Napoli', true),
    player('Returning player', 'Inter', true),
    player('New player', 'Lazio', true),
  ]

  const result = reconcileRealPlayers(existing, current, 15)

  assert.deepEqual(result.value.players.map(item => item.name), [
    'Transferred player',
    'Returning player',
    'New player',
    'Existing player',
  ])
  assert.equal(result.value.players.at(-1)?.isActive, false)
  assert.deepEqual(result.addedKeys, ['newplayer'])
  assert.deepEqual(result.inactiveKeys, ['existingplayer'])
  assert.deepEqual(result.reactivatedKeys, ['returningplayer'])
  assert.deepEqual(result.transferredKeys.sort(), ['returningplayer', 'transferredplayer'])
  assert.equal(result.playerCountChanged, true)
})

test('same player count does not request the deferred legacy stats trigger', () => {
  const existing: RealPlayers = { year: 15, players: [player('One', 'Roma', true)] }
  const result = reconcileRealPlayers(existing, [player('One', 'Milan', true)], 15)
  assert.equal(result.playerCountChanged, false)
  assert.deepEqual(result.transferredKeys, ['one'])
})

test('duplicate legacy keys fail loudly instead of producing ambiguous canonical data', () => {
  assert.throws(
    () => reconcileRealPlayers(null, [player('Foo 1', 'Roma', true), player('Foo 2', 'Roma', true)], 15),
    /Duplicate current player key 'foo'/,
  )
})

function player(name: string, team: string, isActive: boolean): RealPlayer {
  return {
    name,
    team: { name: team, abbreviation: team.slice(0, 3).toLowerCase() },
    role: Role.Forward,
    isActive,
    visible: true,
  }
}
