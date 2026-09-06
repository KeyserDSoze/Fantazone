import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AuctionKind,
  AuctionStatus,
  AuctionType,
  DefaultLeagueSetting,
  FantaSoccerRole,
  IdentityRole,
  LeagueType,
  PlayerInTeamStatus,
  Role,
  consumeAuctionEventSequence,
  createAuctionCheckpoint,
  processAuctionCommand,
  validatePlayerAssignment,
  type AuctionCheckpoint,
  type AuctionCommand,
  type AuctionHostContext,
  type Group,
  type StatPlayer,
  type Team,
} from '../../src/domain/src/index'

const SEASON = 15
const HOST = 'host@example.com'
const ALICE = 'alice@example.com'
const BOB = 'bob@example.com'

const star = statPlayer('Star Forward', Role.Forward)
const oldForward = statPlayer('Old Forward', Role.Forward)

function group(startingMoney = 1000): Group {
  return {
    id: 'friends',
    name: 'Friends',
    users: [
      { username: 'Host', email: HOST, role: IdentityRole.Admin },
      { username: 'Alice', email: ALICE, role: IdentityRole.Participant },
      { username: 'Bob', email: BOB, role: IdentityRole.Participant },
    ],
    baskets: [{
      id: 'main',
      name: 'Main',
      years: [{ year: SEASON, teams: [
        { name: 'Alice FC', owner: ALICE, additionalOwners: [] },
        { name: 'Bob FC', owner: BOB, additionalOwners: [] },
      ] }],
    }],
    leagues: [{
      id: 'league',
      name: 'League',
      isMain: true,
      type: LeagueType.League,
      basketsId: ['main'],
      years: [{
        year: SEASON,
        type: LeagueType.League,
        settings: { ...DefaultLeagueSetting, startingMoney },
      }],
    }],
  }
}

function team(owner: string, players: Team['players'] = []): Team {
  return { name: owner === ALICE ? 'Alice FC' : 'Bob FC', owner, additionalOwners: [], players, moneyFromRank: 0, lastUpdate: null }
}

function checkpoint(kind = AuctionKind.Starting, inputGroup = group()): AuctionCheckpoint {
  return createAuctionCheckpoint({
    id: 'auction-1',
    group: inputGroup,
    leagueId: 'league',
    season: SEASON,
    creator: HOST,
    type: AuctionType.Normal,
    kind,
    createdAt: new Date('2026-09-06T16:00:00Z'),
    secondsPerAuction: 10,
    playerQueues: { [Role.Forward]: ['starforward'] },
  })
}

function context(
  at: string,
  inputGroup = group(),
  alice = team(ALICE),
  bob = team(BOB),
  players: StatPlayer[] = [star],
): AuctionHostContext {
  return {
    group: inputGroup,
    leagueId: 'league',
    season: SEASON,
    players,
    teams: new Map([
      [ALICE, { basketId: 'main', team: alice }],
      [BOB, { basketId: 'main', team: bob }],
    ]),
    now: new Date(at),
  }
}

function command(commandId: string, actor: string, value: Omit<AuctionCommand, 'version' | 'commandId' | 'auctionId' | 'actor' | 'clientTime'>): AuctionCommand {
  return {
    version: 1,
    commandId,
    auctionId: 'auction-1',
    actor,
    clientTime: 0,
    ...value,
  } as AuctionCommand
}

test('creates a readable checkpoint with group participants and normalized queues', () => {
  const state = createAuctionCheckpoint({
    id: 'auction-1', group: group(), leagueId: 'league', season: SEASON, creator: HOST,
    type: AuctionType.RandomList, kind: AuctionKind.Starting,
    createdAt: new Date('2026-09-06T16:00:00Z'),
    playerQueues: { [Role.Forward]: [' StarForward ', 'starforward'] },
  })

  assert.equal(state.version, 1)
  assert.equal(state.status, AuctionStatus.NotStarted)
  assert.equal(state.sequence, 0)
  assert.deepEqual(state.participants.map(item => item.owner), [ALICE, BOB])
  assert.deepEqual(state.playerQueues[Role.Forward], [{ playerKey: 'starforward', isShown: false }])
})

test('serializes show, bid and assignment with monotonic events and command idempotency', () => {
  const initial = checkpoint()
  const shown = processAuctionCommand(initial, command('show-1', HOST, { type: 'SHOW_PLAYER', role: Role.Forward }), context('2026-09-06T16:00:01Z'))
  assert.equal(shown.status, 'accepted')
  assert.equal(shown.event?.sequence, 1)
  assert.equal(shown.checkpoint.current?.player.name, 'Star Forward')
  assert.equal(initial.current, null, 'reducer must not mutate the input checkpoint')

  const bid = processAuctionCommand(
    shown.checkpoint,
    command('bid-1', ALICE, { type: 'PLACE_BID', amount: 25 }),
    { ...context('2026-09-06T16:00:02Z'), teams: shown.teams },
  )
  assert.equal(bid.status, 'accepted')
  assert.equal(bid.event?.sequence, 2)
  assert.equal(bid.checkpoint.current?.owner, ALICE)
  assert.equal(bid.checkpoint.current?.biddingStartedAt, '2026-09-06T16:00:02.000Z')

  const duplicate = processAuctionCommand(
    bid.checkpoint,
    command('bid-1', ALICE, { type: 'PLACE_BID', amount: 99 }),
    { ...context('2026-09-06T16:00:03Z'), teams: bid.teams },
  )
  assert.equal(duplicate.status, 'duplicate')
  assert.equal(duplicate.checkpoint.sequence, 2)
  assert.equal(duplicate.checkpoint.current?.price, 25)
  assert.equal(duplicate.event, null)

  const assigned = processAuctionCommand(
    bid.checkpoint,
    command('assign-1', HOST, { type: 'ASSIGN_CURRENT' }),
    { ...context('2026-09-06T16:00:04Z'), teams: bid.teams },
  )
  assert.equal(assigned.status, 'accepted')
  assert.equal(assigned.event?.sequence, 3)
  assert.deepEqual(assigned.changedTeamOwners, [ALICE])
  assert.equal(assigned.checkpoint.current, null)
  assert.deepEqual(assigned.checkpoint.winnings, [{ playerKey: 'starforward', owner: ALICE, price: 25 }])
  const player = assigned.teams.get(ALICE)?.team.players[0]
  assert.equal(player?.name, 'Star Forward')
  assert.equal(player?.price, 25)
  assert.equal(player?.revenue, 0)
  assert.equal(player?.status, PlayerInTeamStatus.Active)
  assert.equal(player?.position, FantaSoccerRole.Tribune)
})

test('preserves legacy timer grace and pause rules', () => {
  const shown = processAuctionCommand(checkpoint(), command('show', HOST, { type: 'SHOW_PLAYER', role: Role.Forward }), context('2026-09-06T16:00:00Z'))
  const first = processAuctionCommand(
    shown.checkpoint,
    command('alice', ALICE, { type: 'PLACE_BID', amount: 10 }),
    { ...context('2026-09-06T16:00:01Z'), teams: shown.teams },
  )
  const tooLate = processAuctionCommand(
    first.checkpoint,
    command('bob-late', BOB, { type: 'PLACE_BID', amount: 11 }),
    { ...context('2026-09-06T16:00:14Z'), teams: first.teams },
  )
  assert.equal(tooLate.status, 'rejected')
  assert.match(tooLate.message ?? '', /expired/i)
  assert.equal(tooLate.checkpoint.sequence, 2)

  const paused = processAuctionCommand(
    first.checkpoint,
    command('pause', HOST, { type: 'PAUSE' }),
    { ...context('2026-09-06T16:00:02Z'), teams: first.teams },
  )
  const participantBid = processAuctionCommand(
    paused.checkpoint,
    command('bob-paused', BOB, { type: 'PLACE_BID', amount: 11 }),
    { ...context('2026-09-06T16:00:03Z'), teams: paused.teams },
  )
  assert.equal(participantBid.status, 'rejected')
  assert.match(participantBid.message ?? '', /paused/i)

  const hostBid = processAuctionCommand(
    paused.checkpoint,
    command('host-bid', HOST, { type: 'PLACE_BID', amount: 11, bidderEmail: BOB }),
    { ...context('2026-09-06T16:00:03Z'), teams: paused.teams },
  )
  assert.equal(hostBid.status, 'accepted')
  assert.equal(hostBid.checkpoint.current?.owner, BOB)
})

test('enforces legacy role limits and reserves one credit for every remaining roster slot', () => {
  const sixForwards = Array.from({ length: 6 }, (_, index) => ({
    name: `Forward ${index}`,
    team: { name: 'Roma', abbreviation: 'ROM' },
    role: Role.Forward,
    isActive: true,
    visible: true,
    price: 1,
    revenue: 1,
    status: PlayerInTeamStatus.Active,
    position: FantaSoccerRole.Forward,
  }))
  assert.throws(() => validatePlayerAssignment(DefaultLeagueSetting, star, team(ALICE, sixForwards), 1, null), /Troppi attaccanti/)

  const lowBudget = { ...DefaultLeagueSetting, startingMoney: 50 }
  assert.throws(() => validatePlayerAssignment(lowBudget, star, team(ALICE), 30, null), /troppi soldi/i)
  assert.doesNotThrow(() => validatePlayerAssignment(lowBudget, star, team(ALICE), 26, null))
})

test('repairing assignment deactivates the selected same-role player without refund', () => {
  const existing = {
    name: oldForward.name,
    team: { ...oldForward.team },
    role: oldForward.role,
    isActive: true,
    visible: true,
    price: 40,
    revenue: 40,
    status: PlayerInTeamStatus.Active,
    position: FantaSoccerRole.Forward,
  }
  const baseContext = context('2026-09-06T16:00:00Z', group(), team(ALICE, [existing]), team(BOB), [star, oldForward])
  const shown = processAuctionCommand(checkpoint(AuctionKind.Repairing), command('show', HOST, { type: 'SHOW_PLAYER', role: Role.Forward }), baseContext)
  const bid = processAuctionCommand(
    shown.checkpoint,
    command('bid', ALICE, { type: 'PLACE_BID', amount: 15, substitutedPlayerKey: 'oldforward' }),
    { ...baseContext, now: new Date('2026-09-06T16:00:01Z'), teams: shown.teams },
  )
  const assigned = processAuctionCommand(
    bid.checkpoint,
    command('assign', HOST, { type: 'ASSIGN_CURRENT' }),
    { ...baseContext, now: new Date('2026-09-06T16:00:02Z'), teams: bid.teams },
  )

  const players = assigned.teams.get(ALICE)?.team.players ?? []
  assert.equal(players.find(player => player.name === 'Old Forward')?.status, PlayerInTeamStatus.SoldWithNoReturnedPrice)
  assert.equal(players.find(player => player.name === 'Old Forward')?.revenue, 0)
  assert.equal(players.find(player => player.name === 'Star Forward')?.status, PlayerInTeamStatus.Active)
})

test('peer cursor detects duplicates and sequence gaps', () => {
  const event = { version: 1 as const, auctionId: 'auction-1', sequence: 4, commandId: 'x', hostTime: '2026-09-06T16:00:00Z', type: 'STATUS_CHANGED' as const, data: {} }
  assert.deepEqual(consumeAuctionEventSequence(4, event), { status: 'applied', nextSequence: 5 })
  assert.deepEqual(consumeAuctionEventSequence(5, event), { status: 'duplicate', nextSequence: 5 })
  assert.deepEqual(consumeAuctionEventSequence(3, event), { status: 'gap', expectedSequence: 3, receivedSequence: 4 })
})

function statPlayer(name: string, role: Role): StatPlayer {
  return {
    name,
    team: { name: 'Roma', abbreviation: 'ROM' },
    role,
    isActive: true,
    visible: true,
    summatory: 0,
    fantaSummatory: 0,
    withVote: 0,
    withoutVote: 0,
    noPlayed: 0,
    withSpecial: 0,
    goals: 0,
    penalties: 0,
    assists: 0,
    stoppedPenalties: 0,
    sufferedGoals: 0,
    wrongedPenalties: 0,
    ownGoals: 0,
    yellowCards: 0,
    redCards: 0,
    enoughVotes: 0,
    manOfTheMatch: 0,
    injured: 0,
    games: [],
  }
}
