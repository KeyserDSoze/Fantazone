import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AuctionKind,
  AuctionStatus,
  AuctionType,
  Role,
  createActiveAuctionPointer,
  type ActiveAuctionPointer,
  type AuctionCheckpoint,
} from '../../src/domain/src/index'
import {
  GitHubAuctionRepository,
  GitHubJsonStore,
  RepositoryWriteConflictError,
  type RepositoryContentClient,
  type RepositoryJsonSnapshot,
} from '../../src/github/src/index'
import {
  ActiveAuctionAlreadyExistsError,
  ActiveAuctionCheckpointMismatchError,
  ActiveAuctionCheckpointMissingError,
  GroupAuctionDiscoveryService,
} from '../../src/app/services/groupAuctionDiscovery'

class FakeContentClient implements RepositoryContentClient {
  readonly files = new Map<string, { sha: string; content: string }>()
  writes = 0

  async tryGetContent(owner: string, repo: string, path: string, ref?: string) {
    return this.files.get(`${owner}/${repo}/${path}@${ref ?? ''}`) ?? null
  }

  async putContent(owner: string, repo: string, path: string, text: string, _message: string, sha?: string, branch?: string) {
    const key = `${owner}/${repo}/${path}@${branch ?? ''}`
    const existing = this.files.get(key)
    if (existing && existing.sha !== sha) throw new Error('stale sha')
    if (!existing && sha) throw new Error('unexpected sha')
    this.writes += 1
    const nextSha = `write-${this.writes}`
    this.files.set(key, { sha: nextSha, content: text })
    return { sha: nextSha }
  }
}

class ActivationRaceRepository {
  activeReads = 0
  writes = 0

  constructor(
    private readonly durableCheckpoint: AuctionCheckpoint,
    private readonly winner: RepositoryJsonSnapshot<ActiveAuctionPointer> | null,
  ) {}

  async getCheckpoint() {
    return snapshot(this.durableCheckpoint, 'checkpoint-sha')
  }

  async getActiveAuction() {
    this.activeReads += 1
    return this.activeReads === 1 ? null : this.winner
  }

  async writeActiveAuction() {
    this.writes += 1
    throw new RepositoryWriteConflictError(
      { owner: 'KeyserDSoze', repo: 'Fantazone.Amici', ref: 'main', path: 'data/groups/seasons/15/auctions/active/league.json' },
      409,
    )
  }
}

const target = { owner: 'KeyserDSoze', repo: 'Fantazone.Amici', ref: 'main' }

function checkpoint(id = 'auction-1', league = 'league', season = 15): AuctionCheckpoint {
  return {
    version: 1,
    id,
    leagueKey: { group: 'friends', league, year: season },
    creator: 'host@example.com',
    createdAt: '2026-09-06T20:00:00.000Z',
    type: AuctionType.Normal,
    kind: AuctionKind.Starting,
    status: AuctionStatus.Paused,
    current: null,
    winnings: [],
    playerQueues: { [Role.Forward]: [] },
    participants: [],
    lastShownPlayer: { [Role.Forward]: null },
    secondsPerAuction: 10,
    currentRole: Role.Forward,
    sequence: 0,
    recentCommands: [],
    updatedAt: '2026-09-06T20:00:00.000Z',
  }
}

test('returns null when a league has no active auction', async () => {
  const service = serviceWith(new FakeContentClient())
  assert.equal(await service.getActiveAuction('league', 15), null)
})

test('activates a durable checkpoint and resolves it through the pointer', async () => {
  const client = new FakeContentClient()
  const repository = new GitHubAuctionRepository(new GitHubJsonStore(client), target)
  const service = new GroupAuctionDiscoveryService(repository, () => new Date('2026-09-06T20:01:00Z'))
  const cp = checkpoint()
  await repository.createCheckpoint(cp)

  const pointer = await service.activateCheckpoint(cp)
  assert.equal(pointer.value.auctionId, 'auction-1')
  const active = await service.getActiveAuction('league', 15)
  assert.ok(active)
  assert.equal(active.checkpoint.value.id, 'auction-1')
  assert.equal(active.pointer.value.updatedAt, '2026-09-06T20:01:00.000Z')
})

test('rejects a dangling active pointer', async () => {
  const client = new FakeContentClient()
  const repository = new GitHubAuctionRepository(new GitHubJsonStore(client), target)
  await repository.writeActiveAuction(createActiveAuctionPointer({
    leagueId: 'league', season: 15, auctionId: 'missing',
  }))
  const service = new GroupAuctionDiscoveryService(repository)
  await assert.rejects(service.getActiveAuction('league', 15), ActiveAuctionCheckpointMissingError)
})

test('rejects a pointer whose checkpoint belongs to another league', async () => {
  const client = new FakeContentClient()
  const repository = new GitHubAuctionRepository(new GitHubJsonStore(client), target)
  await repository.createCheckpoint(checkpoint('auction-1', 'other-league'))
  await repository.writeActiveAuction(createActiveAuctionPointer({
    leagueId: 'league', season: 15, auctionId: 'auction-1',
  }))
  const service = new GroupAuctionDiscoveryService(repository)
  await assert.rejects(service.getActiveAuction('league', 15), ActiveAuctionCheckpointMismatchError)
})

test('does not replace another active auction implicitly and can clear with SHA', async () => {
  const client = new FakeContentClient()
  const repository = new GitHubAuctionRepository(new GitHubJsonStore(client), target)
  const service = new GroupAuctionDiscoveryService(repository)
  const first = checkpoint('auction-1')
  const second = checkpoint('auction-2')
  await repository.createCheckpoint(first)
  await repository.createCheckpoint(second)
  const active = await service.activateCheckpoint(first)

  await assert.rejects(service.activateCheckpoint(second), ActiveAuctionAlreadyExistsError)
  const cleared = await service.clearActiveAuction('league', 15, { expectedPointerSha: active.sha })
  assert.equal(cleared.value.auctionId, null)
})

test('converges when another device wins the pointer race with the same auction', async () => {
  const cp = checkpoint('auction-same')
  const winner = snapshot(createActiveAuctionPointer({
    leagueId: 'league',
    season: 15,
    auctionId: cp.id,
    updatedAt: new Date('2026-09-06T20:02:00Z'),
  }), 'winner-sha')
  const repository = new ActivationRaceRepository(cp, winner)
  const service = new GroupAuctionDiscoveryService(repository as unknown as GitHubAuctionRepository)

  const activated = await service.activateCheckpoint(cp)

  assert.equal(activated.sha, 'winner-sha')
  assert.equal(activated.value.auctionId, cp.id)
  assert.equal(repository.writes, 1)
  assert.equal(repository.activeReads, 2)
})

test('surfaces the canonical competing auction when another device wins the pointer race', async () => {
  const cp = checkpoint('auction-requested')
  const winner = snapshot(createActiveAuctionPointer({
    leagueId: 'league',
    season: 15,
    auctionId: 'auction-winner',
    updatedAt: new Date('2026-09-06T20:02:00Z'),
  }), 'winner-sha')
  const repository = new ActivationRaceRepository(cp, winner)
  const service = new GroupAuctionDiscoveryService(repository as unknown as GitHubAuctionRepository)

  await assert.rejects(service.activateCheckpoint(cp), error => {
    assert.ok(error instanceof ActiveAuctionAlreadyExistsError)
    assert.equal(error.pointer.auctionId, 'auction-winner')
    assert.equal(error.requestedAuctionId, 'auction-requested')
    return true
  })
  assert.equal(repository.activeReads, 2)
})

test('preserves the original write conflict when no canonical pointer appears after the race', async () => {
  const cp = checkpoint('auction-missing-winner')
  const repository = new ActivationRaceRepository(cp, null)
  const service = new GroupAuctionDiscoveryService(repository as unknown as GitHubAuctionRepository)

  await assert.rejects(service.activateCheckpoint(cp), RepositoryWriteConflictError)
  assert.equal(repository.activeReads, 2)
})

function serviceWith(client: FakeContentClient) {
  return new GroupAuctionDiscoveryService(new GitHubAuctionRepository(new GitHubJsonStore(client), target))
}

function snapshot<T>(value: T, sha: string): RepositoryJsonSnapshot<T> {
  return { value: JSON.parse(JSON.stringify(value)) as T, sha, fromCache: false }
}
