import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AuctionKind,
  AuctionType,
  DefaultLeagueSetting,
  IdentityRole,
  LeagueType,
  Role,
  createAuctionCheckpoint,
  type AuctionCommand,
  type Group,
  type StatPlayer,
  type Team,
} from '../../src/domain/src/index'
import {
  GitHubAuctionRepository,
  GitHubJsonStore,
  type RepositoryContentClient,
} from '../../src/github/src/index'
import { GroupAuctionHostSession, isAuctionDurableBoundary } from '../../src/app/services/groupAuctionHostSession'

const HOST = 'host@example.com'
const ALICE = 'alice@example.com'
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

test('keeps bids in memory, persists assignment outcome idempotently and resumes dedupe state', async () => {
  const client = new FakeContentClient()
  const repository = new GitHubAuctionRepository(
    new GitHubJsonStore(client),
    { owner: 'KeyserDSoze', repo: 'Fantazone.Amici', ref: 'main' },
  )
  const player = statPlayer('Star Forward')
  const inputGroup = group()
  const initial = createAuctionCheckpoint({
    id: 'auction-1', group: inputGroup, leagueId: 'league', season: SEASON, creator: HOST,
    type: AuctionType.Normal, kind: AuctionKind.Starting,
    createdAt: new Date('2026-09-06T16:00:00Z'),
    playerQueues: { [Role.Forward]: ['starforward'] },
  })
  const teams = new Map([[ALICE, { basketId: 'main', team: emptyTeam() }]])
  const session = await GroupAuctionHostSession.create(repository, initial, {
    group: inputGroup, leagueId: 'league', season: SEASON, players: [player], teams,
  })
  assert.equal(client.writes, 1)

  const shown = session.dispatch(command('show', HOST, { type: 'SHOW_PLAYER', role: Role.Forward }), new Date('2026-09-06T16:00:01Z'))
  assert.equal(isAuctionDurableBoundary(shown), true)
  assert.equal(shown.assignmentOutcome, null)
  assert.equal(client.writes, 1, 'dispatch never commits implicitly')

  const bidCommand = command('bid', ALICE, { type: 'PLACE_BID', amount: 20 })
  const bid = session.dispatch(bidCommand, new Date('2026-09-06T16:00:02Z'))
  assert.equal(isAuctionDurableBoundary(bid), false)
  assert.equal(bid.assignmentOutcome, null)
  assert.equal(session.checkpoint.sequence, 2)
  assert.equal(client.writes, 1, 'bid remains realtime-only until a periodic/durable checkpoint')

  const persistedBid = await session.persistCheckpoint()
  assert.equal(client.writes, 2)
  assert.equal(persistedBid.value.current?.price, 20)

  const assigned = session.dispatch(command('assign', HOST, { type: 'ASSIGN_CURRENT' }), new Date('2026-09-06T16:00:03Z'))
  assert.equal(isAuctionDurableBoundary(assigned), true)
  assert.equal(session.currentTeams.get(ALICE)?.team.players[0]?.name, 'Star Forward')
  assert.deepEqual(assigned.assignmentOutcome, {
    version: 1,
    auctionId: 'auction-1',
    sequence: 3,
    leagueId: 'league',
    season: SEASON,
    kind: AuctionKind.Starting,
    actor: HOST,
    owner: ALICE,
    playerKey: 'starforward',
    price: 20,
    substitutedPlayerKey: null,
    assignedAt: '2026-09-06T16:00:03.000Z',
    status: 'pending',
  })
  assert.equal(client.writes, 2, 'assignment dispatch itself remains transport-only')

  const durable = await session.persistDurableResult(assigned)
  assert.equal(client.writes, 4, 'checkpoint is committed before one append-only assignment outcome')
  assert.equal(durable.checkpoint?.value.sequence, 3)
  assert.deepEqual(durable.assignmentOutcome?.value, assigned.assignmentOutcome)

  const retried = await session.persistDurableResult(assigned)
  assert.equal(client.writes, 5, 'retry checkpoints again but does not duplicate the create-only outcome')
  assert.deepEqual(retried.assignmentOutcome?.value, assigned.assignmentOutcome)

  const fresh = await repository.getCheckpoint(SEASON, 'auction-1', { refresh: true })
  assert.ok(fresh)
  assert.equal(fresh.value.sequence, 3)
  const resumed = GroupAuctionHostSession.resume(repository, fresh, {
    group: inputGroup,
    leagueId: 'league',
    season: SEASON,
    players: [player],
    teams: session.currentTeams,
  })
  const duplicate = resumed.dispatch(bidCommand, new Date('2026-09-06T16:01:00Z'))
  assert.equal(duplicate.status, 'duplicate')
  assert.equal(duplicate.checkpoint.sequence, 3)
  assert.equal(duplicate.assignmentOutcome, null)
})

function command(commandId: string, actor: string, value: Record<string, unknown> & { type: AuctionCommand['type'] }): AuctionCommand {
  return { version: 1, commandId, auctionId: 'auction-1', actor, clientTime: 0, ...value } as AuctionCommand
}

function group(): Group {
  return {
    id: 'friends', name: 'Friends',
    users: [
      { username: 'Host', email: HOST, role: IdentityRole.Admin },
      { username: 'Alice', email: ALICE, role: IdentityRole.Participant },
    ],
    baskets: [{ id: 'main', name: 'Main', years: [{ year: SEASON, teams: [{ name: 'Alice FC', owner: ALICE, additionalOwners: [] }] }] }],
    leagues: [{
      id: 'league', name: 'League', isMain: true, type: LeagueType.League, basketsId: ['main'],
      years: [{ year: SEASON, type: LeagueType.League, settings: { ...DefaultLeagueSetting } }],
    }],
  }
}

function emptyTeam(): Team {
  return { name: 'Alice FC', owner: ALICE, additionalOwners: [], players: [], moneyFromRank: 0, lastUpdate: null }
}

function statPlayer(name: string): StatPlayer {
  return {
    name, team: { name: 'Roma', abbreviation: 'ROM' }, role: Role.Forward, isActive: true, visible: true,
    summatory: 0, fantaSummatory: 0, withVote: 0, withoutVote: 0, noPlayed: 0, withSpecial: 0,
    goals: 0, penalties: 0, assists: 0, stoppedPenalties: 0, sufferedGoals: 0, wrongedPenalties: 0,
    ownGoals: 0, yellowCards: 0, redCards: 0, enoughVotes: 0, manOfTheMatch: 0, injured: 0, games: [],
  }
}
