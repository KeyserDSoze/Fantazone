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
  type AuctionCheckpoint,
  type Group,
  type Team,
} from '../../src/domain/src/index'
import type { GitHubAuctionRepository } from '../../src/github/src/index'
import { GroupAuctionHostSession } from '../../src/app/services/groupAuctionHostSession'

const HOST = 'host@example.com'
const OWNER = 'owner@example.com'
const SEASON = 15

class DelayedAuctionRepository {
  private sha = 1
  private releaseFirstWrite: (() => void) | null = null
  private firstWriteBlocked: Promise<void> | null = null
  private resolveFirstWriteBlocked: (() => void) | null = null
  readonly expectedShas: string[] = []
  readonly writtenSequences: number[] = []
  inFlight = 0
  maxInFlight = 0
  shouldBlockNextWrite = false

  async createCheckpoint(checkpoint: AuctionCheckpoint) {
    return snapshot(checkpoint, `sha-${this.sha}`)
  }

  blockNextWrite(): void {
    this.shouldBlockNextWrite = true
    this.firstWriteBlocked = new Promise(resolve => { this.resolveFirstWriteBlocked = resolve })
  }

  async waitUntilBlocked(): Promise<void> {
    await this.firstWriteBlocked
  }

  releaseBlockedWrite(): void {
    this.releaseFirstWrite?.()
  }

  async writeCheckpoint(checkpoint: AuctionCheckpoint, options: { expectedSha?: string } = {}) {
    this.inFlight += 1
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight)
    this.expectedShas.push(options.expectedSha ?? '')
    this.writtenSequences.push(checkpoint.sequence)
    try {
      if (this.shouldBlockNextWrite) {
        this.shouldBlockNextWrite = false
        const gate = new Promise<void>(resolve => { this.releaseFirstWrite = resolve })
        this.resolveFirstWriteBlocked?.()
        await gate
      }
      this.sha += 1
      return snapshot(checkpoint, `sha-${this.sha}`)
    } finally {
      this.inFlight -= 1
    }
  }
}

test('overlapping durable boundaries are persisted in order with the SHA produced by the previous write', async () => {
  const group = inputGroup()
  const repository = new DelayedAuctionRepository()
  const initial = createAuctionCheckpoint({
    id: 'auction-queue',
    group,
    leagueId: 'league',
    season: SEASON,
    creator: HOST,
    type: AuctionType.Normal,
    kind: AuctionKind.Starting,
    createdAt: new Date('2026-09-10T10:00:00Z'),
    playerQueues: {},
  })
  const teams = new Map([[OWNER, { basketId: 'main', team: emptyTeam() }]])
  const session = await GroupAuctionHostSession.create(
    repository as unknown as GitHubAuctionRepository,
    initial,
    { group, leagueId: 'league', season: SEASON, players: [], teams },
  )

  const timer = session.dispatch({
    version: 1,
    commandId: 'timer',
    auctionId: initial.id,
    actor: HOST,
    clientTime: 1,
    type: 'SET_TIMER',
    seconds: 20,
  }, new Date('2026-09-10T10:00:01Z'))
  assert.equal(timer.status, 'accepted')

  repository.blockNextWrite()
  const firstPersistence = session.persistDurableResult(timer)
  await repository.waitUntilBlocked()

  const role = session.dispatch({
    version: 1,
    commandId: 'role',
    auctionId: initial.id,
    actor: HOST,
    clientTime: 2,
    type: 'SET_ROLE',
    role: Role.Forward,
  }, new Date('2026-09-10T10:00:02Z'))
  assert.equal(role.status, 'accepted')
  const secondPersistence = session.persistDurableResult(role)

  await Promise.resolve()
  assert.equal(repository.inFlight, 1)
  assert.equal(repository.maxInFlight, 1)
  assert.deepEqual(repository.writtenSequences, [1])

  repository.releaseBlockedWrite()
  const [first, second] = await Promise.all([firstPersistence, secondPersistence])

  assert.equal(repository.maxInFlight, 1, 'the second checkpoint must not overlap the first write')
  assert.deepEqual(repository.writtenSequences, [1, 2])
  assert.deepEqual(repository.expectedShas, ['sha-1', 'sha-2'])
  assert.equal(first.checkpoint?.value.sequence, 1)
  assert.equal(second.checkpoint?.value.sequence, 2)
})

function inputGroup(): Group {
  return {
    id: 'friends',
    name: 'Friends',
    users: [
      { username: 'Host', email: HOST, role: IdentityRole.Admin },
      { username: 'Owner', email: OWNER, role: IdentityRole.Participant },
    ],
    baskets: [{
      id: 'main',
      name: 'Main',
      years: [{ year: SEASON, teams: [{ name: 'Owner FC', owner: OWNER, additionalOwners: [] }] }],
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

function emptyTeam(): Team {
  return {
    name: 'Owner FC',
    owner: OWNER,
    additionalOwners: [],
    players: [],
    moneyFromRank: 0,
    lastUpdate: null,
  }
}

function snapshot<T>(value: T, sha: string) {
  return { value: JSON.parse(JSON.stringify(value)) as T, sha, fromCache: false }
}
