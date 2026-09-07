import test from 'node:test'
import assert from 'node:assert/strict'
import { buildHistoricalTeamPlayerIndex, recoverUnnamedSeasonTeamPlayers } from '../../scripts/migration/team-player-recovery.mjs'
import { buildMigrationPlan } from '../../scripts/migration/migration-plan.mjs'

const groupId = 'group-1'
const teamKey = { g: groupId, y: 10, b: 'basket-1', e: 'owner@example.com' }
const namedPlayer = {
  n: 'Mario Rossi', t: { n: 'Roma', a: 'ROM' }, r: 3, a: true, vh: true,
  p: 17, rv: 0, s: 0, k: 3,
}
const anonymousPlayer = {
  n: '', t: null, r: 3, a: true, vh: true,
  p: 17, rv: 0, s: 0, k: 3,
}

function team(players) {
  return { n: 'Team', o: teamKey.e, a: [], p: players, m: 0, d: null }
}

function dailyRecord(blobName, player) {
  return {
    container: 'dailyteams', blobName,
    key: { ...teamKey, d: 1 },
    value: team([player]),
  }
}

test('recovers an unnamed season Team player from same-team historical TeamDay metadata', () => {
  const records = [dailyRecord('day-1', namedPlayer)]
  const index = buildHistoricalTeamPlayerIndex(records, groupId)
  const recovered = recoverUnnamedSeasonTeamPlayers(team([anonymousPlayer]), teamKey, index)
  assert.equal(recovered.p[0].n, 'Mario Rossi')
  assert.equal(recovered.p[0].t.n, 'Roma')
  assert.equal(recovered.p[0].p, 17)
})

test('migration plan emits schema-v3 playerKey after unnamed historical Team recovery', () => {
  const records = [
    { container: 'group', blobName: 'group', key: groupId, value: { i: groupId, n: 'Group One', l: [], u: [], b: [] } },
    dailyRecord('day-1', namedPlayer),
    { container: 'team', blobName: 'season-team', key: teamKey, value: team([anonymousPlayer]) },
  ]
  const plan = buildMigrationPlan(records, { groupRepository: 'owner/Fantazone.Group-One', groupId })
  const season = JSON.parse(plan.groupFiles.find(file => file.path.includes('/teams/') && !file.path.includes('/days/')).content)
  assert.equal(season.players[0].playerKey, 'mariorossi')
  assert.equal(season.players[0].price, 17)
})

test('fails closed when two different historical players are equally compatible', () => {
  const second = { ...namedPlayer, n: 'Luigi Bianchi' }
  const records = [dailyRecord('day-1', namedPlayer), dailyRecord('day-2', second)]
  const index = buildHistoricalTeamPlayerIndex(records, groupId)
  assert.throws(
    () => recoverUnnamedSeasonTeamPlayers(team([anonymousPlayer]), teamKey, index),
    /historical candidates tie/,
  )
})

test('fails closed when evidence is too weak to identify an unnamed player', () => {
  const weakAnonymous = { n: '', p: 17 }
  const records = [dailyRecord('day-1', namedPlayer)]
  const index = buildHistoricalTeamPlayerIndex(records, groupId)
  assert.throws(
    () => recoverUnnamedSeasonTeamPlayers(team([weakAnonymous]), teamKey, index),
    /too weak/,
  )
})
