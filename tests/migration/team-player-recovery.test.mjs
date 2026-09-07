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

function team(players, name = 'Team') {
  return { n: name, o: teamKey.e, a: [], p: players, m: 0, d: null }
}

function dailyRecord(blobName, player, day = 1, key = teamKey) {
  return {
    container: 'dailyteams', blobName,
    key: { ...key, d: day },
    value: { ...team([player]), o: key.e },
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

test('recovers anonymized SoldForOneHalf Manolas when legacy role became Undefined', () => {
  const manolasActive = {
    n: 'Manolas', t: { n: '' }, r: 1, a: true,
    p: 16, s: 0, k: 1,
  }
  const manolasSold = {
    n: 'Manolas', t: { n: '' }, r: 1, a: true,
    p: 16, s: 1, k: 11,
  }
  const traore = {
    n: 'Traore-Hj', t: { n: 'Sassuolo' }, r: 2, a: true,
    p: 16, s: 2, k: 7,
  }
  const anonymized = {
    n: '', t: { n: '' }, r: -1, a: true,
    p: 16, s: 1, k: 11,
  }
  const records = [
    dailyRecord('day-4', manolasActive, 4),
    dailyRecord('day-30', manolasSold, 30),
    dailyRecord('day-31', traore, 31),
  ]
  const index = buildHistoricalTeamPlayerIndex(records, groupId)
  const recovered = recoverUnnamedSeasonTeamPlayers(team([anonymized]), teamKey, index)
  assert.equal(recovered.p[0].n, 'Manolas')
  assert.equal(recovered.p[0].p, 16)
  assert.equal(recovered.p[0].s, 1)
  assert.equal(recovered.p[0].k, 11)

  const migrationRecords = [
    { container: 'group', blobName: 'group', key: groupId, value: { i: groupId, n: 'Group One', l: [], u: [], b: [] } },
    ...records,
    { container: 'team', blobName: 'season-team', key: teamKey, value: team([anonymized]) },
  ]
  const plan = buildMigrationPlan(migrationRecords, { groupRepository: 'owner/Fantazone.Group-One', groupId })
  const season = JSON.parse(plan.groupFiles.find(file => file.path.includes('/teams/') && !file.path.includes('/days/')).content)
  assert.equal(season.players[0].playerKey, 'manolas')
  assert.equal(season.players[0].price, 16)
  assert.equal(season.players[0].status, 1)
  assert.equal(season.players[0].position, 11)
})

test('uses another basket history only when the season Team payload is an exact mirror', () => {
  const basketA = { ...teamKey, b: 'basket-a' }
  const basketB = { ...teamKey, b: 'basket-b' }
  const anonymized = { n: '', t: { n: '' }, r: -1, a: true, p: 28, s: 1, k: 11 }
  const manolas = { n: 'Manolas', t: { n: '' }, r: 1, a: true, p: 28, s: 1, k: 11 }
  const mirroredTeam = { ...team([anonymized], 'Mirrored Team'), o: basketA.e }
  const records = [
    { container: 'team', blobName: 'season-a', key: basketA, value: mirroredTeam },
    { container: 'team', blobName: 'season-b', key: basketB, value: JSON.parse(JSON.stringify(mirroredTeam)) },
    dailyRecord('day-b', manolas, 24, basketB),
  ]
  const index = buildHistoricalTeamPlayerIndex(records, groupId)
  const recovered = recoverUnnamedSeasonTeamPlayers(mirroredTeam, basketA, index)
  assert.equal(recovered.p[0].n, 'Manolas')
  assert.equal(recovered.p[0].p, 28)
})

test('does not borrow history from a different basket when season Team payloads differ', () => {
  const basketA = { ...teamKey, b: 'basket-a' }
  const basketB = { ...teamKey, b: 'basket-b' }
  const anonymized = { n: '', t: { n: '' }, r: -1, a: true, p: 28, s: 1, k: 11 }
  const manolas = { n: 'Manolas', t: { n: '' }, r: 1, a: true, p: 28, s: 1, k: 11 }
  const targetTeam = { ...team([anonymized], 'Target Team'), o: basketA.e }
  const otherTeam = { ...team([{ ...anonymized, p: 99 }], 'Different Team'), o: basketB.e }
  const records = [
    { container: 'team', blobName: 'season-a', key: basketA, value: targetTeam },
    { container: 'team', blobName: 'season-b', key: basketB, value: otherTeam },
    dailyRecord('day-b', manolas, 24, basketB),
  ]
  const index = buildHistoricalTeamPlayerIndex(records, groupId)
  assert.throws(
    () => recoverUnnamedSeasonTeamPlayers(targetTeam, basketA, index),
    /no historical Team\/TeamDay candidates|no metadata-compatible historical candidate/,
  )
})

test('fails closed when two different historical players are equally compatible', () => {
  const second = { ...namedPlayer, n: 'Luigi Bianchi' }
  const records = [dailyRecord('day-1', namedPlayer), dailyRecord('day-2', second, 2)]
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
