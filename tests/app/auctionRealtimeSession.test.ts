import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AuctionKind,
  AuctionStatus,
  AuctionType,
  DefaultLeagueSetting,
  IdentityRole,
  LeagueType,
  Role,
  createAuctionCheckpoint,
  type AuctionCheckpoint,
  type AuctionCommand,
  type AuctionEvent,
  type Group,
  type StatPlayer,
  type Team,
} from '../../src/domain/src/index'
import {
  GitHubAuctionRepository,
  GitHubJsonStore,
  type RepositoryContentClient,
} from '../../src/github/src/index'
import { GroupAuctionHostSession } from '../../src/app/services/groupAuctionHostSession'
import {
  GroupAuctionRealtimeHostController,
  GroupAuctionRealtimePeerController,
  decodeAuctionRealtimeMessage,
  encodeAuctionRealtimeMessage,
  type AuctionRealtimeTextPeer,
} from '../../src/app/services/auctionRealtimeSession'

const HOST = 'host@example.com'
const ALICE = 'alice@example.com'
const BOB = 'bob@example.com'
const SEASON = 15

class FakeContentClient implements RepositoryContentClient {
  readonly files = new Map<string, { sha: string; content: string }>()
  writes = 0

  async tryGetContent(owner: string, repo: string, path: string, ref?: string) {
    return this.files.get(`${owner}/${repo}/${path}@${ref ?? ''}`) ?? null
  }

  async putContent(owner: string, repo: string, path: string, text: string, _message: string, _sha?: string, branch?: string) {
    this.writes += 1
    const sha = `write-${this.writes}`
    this.files.set(`${owner}/${repo}/${path}@${branch ?? ''}`, { sha, content: text })
    return { sha }
  }
}

class TextPeer implements AuctionRealtimeTextPeer {
  readonly sent: string[] = []
  constructor(readonly peerId: string, readonly email: string) {}
  sendText(text: string): void { this.sent.push(text) }
}

test('host binds command actors to peer identity, broadcasts events and keeps bids off GitHub', async () => {
  const client = new FakeContentClient()
  const repository = new GitHubAuctionRepository(
    new GitHubJsonStore(client),
    { owner: 'KeyserDSoze', repo: 'Fantazone.Amici', ref: 'main' },
  )
  const inputGroup = group()
  const player = statPlayer('Star Forward')
  const initial = createAuctionCheckpoint({
    id: 'auction-1', group: inputGroup, leagueId: 'league', season: SEASON, creator: HOST,
    type: AuctionType.Normal, kind: AuctionKind.Starting,
    createdAt: new Date('2026-09-06T18:00:00Z'),
    playerQueues: { [Role.Forward]: ['starforward'] },
  })
  const session = await GroupAuctionHostSession.create(repository, initial, {
    group: inputGroup,
    leagueId: 'league',
    season: SEASON,
    players: [player],
    teams: new Map([
      [ALICE, { basketId: 'main', team: emptyTeam(ALICE, 'Alice FC') }],
      [BOB, { basketId: 'main', team: emptyTeam(BOB, 'Bob FC') }],
    ]),
  })
  const host = new GroupAuctionRealtimeHostController(session, HOST)
  const alice = new TextPeer('alice-device', ALICE)
  const bob = new TextPeer('bob-device', BOB)
  host.attachPeer(alice)
  host.attachPeer(bob)

  await host.dispatchHostCommand(command('show', HOST, { type: 'SHOW_PLAYER', role: Role.Forward }), new Date('2026-09-06T18:00:01Z'))
  assert.equal(client.writes, 2, 'initial checkpoint + durable SHOW_PLAYER checkpoint')
  assert.equal(decodeAuctionRealtimeMessage(alice.sent.at(-1)!).type, 'event')
  assert.equal(decodeAuctionRealtimeMessage(bob.sent.at(-1)!).type, 'event')

  const bidText = encodeAuctionRealtimeMessage({
    version: 1,
    type: 'command',
    command: command('bid-alice', ALICE, { type: 'PLACE_BID', amount: 20 }),
  })
  const bid = await host.receivePeerText('alice-device', bidText, new Date('2026-09-06T18:00:02Z'))
  assert.equal(bid?.status, 'accepted')
  assert.equal(client.writes, 2, 'accepted bids remain realtime-only')
  assert.equal(session.checkpoint.current?.owner, ALICE)
  assert.equal(session.checkpoint.sequence, 2)
  assert.ok(alice.sent.some(text => decodeAuctionRealtimeMessage(text).type === 'command-result'))
  assert.equal(decodeAuctionRealtimeMessage(bob.sent.at(-1)!).type, 'event')

  const spoofed = encodeAuctionRealtimeMessage({
    version: 1,
    type: 'command',
    command: command('spoof', BOB, { type: 'PLACE_BID', amount: 30 }),
  })
  const rejected = await host.receivePeerText('alice-device', spoofed, new Date('2026-09-06T18:00:03Z'))
  assert.equal(rejected, null)
  assert.equal(session.checkpoint.sequence, 2)
  const rejection = decodeAuctionRealtimeMessage(alice.sent.at(-1)!)
  assert.equal(rejection.type, 'command-result')
  if (rejection.type === 'command-result') {
    assert.equal(rejection.status, 'rejected')
    assert.match(rejection.message ?? '', /peer identity/i)
  }
})

test('participant detects sequence gaps and requests a host checkpoint before applying later events', () => {
  const wire = new TextPeer('alice-device', ALICE)
  const events: AuctionEvent[] = []
  const checkpoints: AuctionCheckpoint[] = []
  const gaps: Array<{ expectedSequence: number; receivedSequence: number }> = []
  const peer = new GroupAuctionRealtimePeerController('auction-1', wire, {
    onEvent: event => events.push(event),
    onCheckpoint: checkpoint => checkpoints.push(checkpoint),
    onSequenceGap: gap => gaps.push(gap),
  })

  peer.receiveText(encodeAuctionRealtimeMessage({ version: 1, type: 'event', event: event(2) }))
  assert.deepEqual(gaps, [{ expectedSequence: 1, receivedSequence: 2 }])
  assert.equal(events.length, 0)
  const request = decodeAuctionRealtimeMessage(wire.sent.at(-1)!)
  assert.deepEqual(request, { version: 1, type: 'checkpoint-request', nextSequence: 1 })

  peer.receiveText(encodeAuctionRealtimeMessage({ version: 1, type: 'checkpoint', checkpoint: checkpoint(2) }))
  assert.equal(peer.expectedSequence, 3)
  assert.equal(checkpoints.length, 1)

  peer.receiveText(encodeAuctionRealtimeMessage({ version: 1, type: 'event', event: event(3) }))
  assert.equal(peer.expectedSequence, 4)
  assert.equal(events.length, 1)
  assert.equal(events[0]?.sequence, 3)
})

function command(commandId: string, actor: string, value: Record<string, unknown> & { type: AuctionCommand['type'] }): AuctionCommand {
  return { version: 1, commandId, auctionId: 'auction-1', actor, clientTime: 0, ...value } as AuctionCommand
}

function event(sequence: number): AuctionEvent {
  return {
    version: 1,
    auctionId: 'auction-1',
    sequence,
    commandId: `command-${sequence}`,
    hostTime: '2026-09-06T18:00:00.000Z',
    type: 'STATUS_CHANGED',
    data: { status: AuctionStatus.InProgress },
  }
}

function checkpoint(sequence: number): AuctionCheckpoint {
  return {
    version: 1,
    id: 'auction-1',
    leagueKey: { group: 'friends', league: 'league', year: SEASON },
    creator: HOST,
    createdAt: '2026-09-06T18:00:00.000Z',
    type: AuctionType.Normal,
    kind: AuctionKind.Starting,
    status: AuctionStatus.InProgress,
    current: null,
    winnings: [],
    playerQueues: {},
    participants: [],
    lastShownPlayer: {},
    secondsPerAuction: 10,
    currentRole: Role.Forward,
    sequence,
    recentCommands: [],
    updatedAt: '2026-09-06T18:00:00.000Z',
  }
}

function group(): Group {
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
      years: [{ year: SEASON, type: LeagueType.League, settings: { ...DefaultLeagueSetting } }],
    }],
  }
}

function emptyTeam(owner: string, name: string): Team {
  return { name, owner, additionalOwners: [], players: [], moneyFromRank: 0, lastUpdate: null }
}

function statPlayer(name: string): StatPlayer {
  return {
    name,
    team: { name: 'Roma', abbreviation: 'ROM' },
    role: Role.Forward,
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
