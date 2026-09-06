import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AuctionKind,
  DefaultLeagueSetting,
  FantaSoccerRole,
  IdentityRole,
  LeagueType,
  PlayerInTeamStatus,
  Role,
  applyAuctionAssignmentOutcome,
  type AuctionAssignmentOutcome,
  type Group,
  type RealPlayer,
  type Team,
} from '../../src/domain/src/index'

const HOST = 'host@example.com'
const ALICE = 'alice@example.com'
const SEASON = 15
const star: RealPlayer = {
  name: 'Star Forward', team: { name: 'Roma', abbreviation: 'ROM' }, role: Role.Forward, isActive: true, visible: true,
}

function group(startingMoney = 1000): Group {
  return {
    id: 'friends', name: 'Friends',
    users: [
      { username: 'Host', email: HOST, role: IdentityRole.Admin },
      { username: 'Alice', email: ALICE, role: IdentityRole.Participant },
    ],
    baskets: [{ id: 'main', name: 'Main', years: [{ year: SEASON, teams: [{ name: 'Alice FC', owner: ALICE, additionalOwners: [] }] }] }],
    leagues: [{
      id: 'league', name: 'League', isMain: true, type: LeagueType.League, basketsId: ['main'],
      years: [{ year: SEASON, type: LeagueType.League, settings: { ...DefaultLeagueSetting, startingMoney } }],
    }],
  }
}

function team(players: Team['players'] = []): Team {
  return { name: 'Alice FC', owner: ALICE, additionalOwners: [], players, moneyFromRank: 0, lastUpdate: null }
}

function outcome(overrides: Partial<AuctionAssignmentOutcome> = {}): AuctionAssignmentOutcome {
  return {
    version: 1,
    auctionId: 'auction-1',
    sequence: 3,
    leagueId: 'league',
    season: SEASON,
    kind: AuctionKind.Starting,
    actor: HOST,
    owner: ALICE,
    playerKey: 'starforward',
    price: 25,
    substitutedPlayerKey: null,
    assignedAt: '2026-09-06T16:00:03.000Z',
    status: 'pending',
    ...overrides,
  }
}

test('revalidates a realtime assignment and builds the canonical roster player', () => {
  const result = applyAuctionAssignmentOutcome({
    group: group(), outcome: outcome(), team: team(), player: star,
    processedAt: new Date('2026-09-06T16:01:00Z'),
  })

  assert.equal(result.changed, true)
  assert.equal(result.outcome.status, 'applied')
  assert.equal(result.outcome.result?.processedAt, '2026-09-06T16:01:00.000Z')
  assert.equal(result.team.players.length, 1)
  assert.deepEqual(result.team.players[0], {
    ...star,
    price: 25,
    revenue: 0,
    status: PlayerInTeamStatus.Active,
    position: FantaSoccerRole.Tribune,
  })
})

test('rejects forged actor and stale duplicate without mutating canonical team', () => {
  const forged = applyAuctionAssignmentOutcome({
    group: group(), outcome: outcome({ actor: ALICE }), team: team(), player: star,
    processedAt: new Date('2026-09-06T16:01:00Z'),
  })
  assert.equal(forged.changed, false)
  assert.equal(forged.outcome.status, 'rejected')
  assert.match(forged.outcome.result?.message ?? '', /Admin|SuperAdmin/)
  assert.equal(forged.team.players.length, 0)

  const existing = {
    ...star,
    price: 10,
    revenue: 10,
    status: PlayerInTeamStatus.Active,
    position: FantaSoccerRole.Forward,
  }
  const duplicate = applyAuctionAssignmentOutcome({
    group: group(), outcome: outcome(), team: team([existing]), player: star,
    processedAt: new Date('2026-09-06T16:01:00Z'),
  })
  assert.equal(duplicate.changed, false)
  assert.equal(duplicate.outcome.status, 'rejected')
  assert.match(duplicate.outcome.result?.message ?? '', /already active/i)
  assert.equal(duplicate.team.players.length, 1)
})

test('repair outcome replaces only an active same-role canonical player', () => {
  const old = {
    name: 'Old Forward', team: { name: 'Milan', abbreviation: 'MIL' }, role: Role.Forward,
    isActive: true, visible: true, price: 30, revenue: 30,
    status: PlayerInTeamStatus.Active, position: FantaSoccerRole.Forward,
  }
  const repaired = applyAuctionAssignmentOutcome({
    group: group(),
    outcome: outcome({ kind: AuctionKind.Repairing, substitutedPlayerKey: 'oldforward' }),
    team: team([old]),
    player: star,
    processedAt: new Date('2026-09-06T16:01:00Z'),
  })
  assert.equal(repaired.outcome.status, 'applied')
  assert.equal(repaired.team.players.find(player => player.name === 'Old Forward')?.status, PlayerInTeamStatus.SoldWithNoReturnedPrice)
  assert.equal(repaired.team.players.find(player => player.name === 'Old Forward')?.revenue, 0)
  assert.equal(repaired.team.players.find(player => player.name === 'Star Forward')?.status, PlayerInTeamStatus.Active)

  const wrongRole = {
    ...old,
    name: 'Old Defender',
    role: Role.Defensor,
    position: FantaSoccerRole.Defensor,
  }
  const rejected = applyAuctionAssignmentOutcome({
    group: group(),
    outcome: outcome({ kind: AuctionKind.Repairing, substitutedPlayerKey: 'olddefender' }),
    team: team([wrongRole]),
    player: star,
    processedAt: new Date('2026-09-06T16:01:00Z'),
  })
  assert.equal(rejected.outcome.status, 'rejected')
  assert.match(rejected.outcome.result?.message ?? '', /same role/i)
})

test('reuses auction budget validation against canonical team state', () => {
  const result = applyAuctionAssignmentOutcome({
    group: group(50), outcome: outcome({ price: 30 }), team: team(), player: star,
    processedAt: new Date('2026-09-06T16:01:00Z'),
  })
  assert.equal(result.changed, false)
  assert.equal(result.outcome.status, 'rejected')
  assert.match(result.outcome.result?.message ?? '', /troppi soldi/i)
})

test('already processed outcomes are idempotent no-ops', () => {
  const applied = outcome({ status: 'applied', result: { processedAt: '2026-09-06T16:01:00.000Z' } })
  const result = applyAuctionAssignmentOutcome({
    group: group(), outcome: applied, team: team(), player: star,
    processedAt: new Date('2026-09-06T17:00:00Z'),
  })
  assert.equal(result.changed, false)
  assert.deepEqual(result.outcome, applied)
})
