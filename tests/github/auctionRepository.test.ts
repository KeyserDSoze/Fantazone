import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AuctionKind,
  AuctionStatus,
  AuctionType,
  Role,
  type AuctionAssignmentOutcome,
  type AuctionCheckpoint,
} from '../../src/domain/src/index'
import {
  GitHubAuctionRepository,
  GitHubJsonStore,
  RepositoryWriteConflictError,
  auctionAssignmentOutcomeDocumentPath,
  auctionCheckpointDocumentPath,
  type RepositoryContentClient,
} from '../../src/github/src/index'

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

const target = { owner: 'KeyserDSoze', repo: 'Fantazone.Amici', ref: 'main' }

function checkpoint(sequence = 0): AuctionCheckpoint {
  return {
    version: 1,
    id: 'asta amici',
    leagueKey: { group: 'friends', league: 'league', year: 15 },
    creator: 'host@example.com',
    createdAt: '2026-09-06T16:00:00.000Z',
    type: AuctionType.Normal,
    kind: AuctionKind.Starting,
    status: AuctionStatus.Paused,
    current: null,
    winnings: [],
    playerQueues: { [Role.Forward]: [{ playerKey: 'starforward', isShown: false }] },
    participants: [{ owner: 'alice@example.com', teamName: 'Alice FC' }],
    lastShownPlayer: { [Role.Forward]: null },
    secondsPerAuction: 10,
    currentRole: Role.Forward,
    sequence,
    recentCommands: [],
    updatedAt: '2026-09-06T16:00:00.000Z',
  }
}

function outcome(): AuctionAssignmentOutcome {
  return {
    version: 1,
    auctionId: 'asta amici',
    sequence: 8,
    leagueId: 'league',
    season: 15,
    kind: AuctionKind.Starting,
    actor: 'host@example.com',
    owner: 'alice@example.com',
    playerKey: 'starforward',
    price: 25,
    substitutedPlayerKey: null,
    assignedAt: '2026-09-06T16:06:00.000Z',
    status: 'pending',
  }
}

test('stores one season-scoped durable checkpoint and updates it with optimistic SHA', async () => {
  const client = new FakeContentClient()
  const repository = new GitHubAuctionRepository(new GitHubJsonStore(client), target)
  const created = await repository.createCheckpoint(checkpoint())

  const path = auctionCheckpointDocumentPath(15, 'asta amici')
  assert.equal(path, 'data/groups/seasons/15/auctions/asta%20amici/checkpoint.json')
  assert.equal(created.sha, 'write-1')
  assert.equal((await repository.getCheckpoint(15, 'asta amici'))?.value.sequence, 0)

  const next = { ...checkpoint(7), updatedAt: '2026-09-06T16:05:00.000Z' }
  const written = await repository.writeCheckpoint(next, { expectedSha: created.sha })
  assert.equal(written.sha, 'write-2')
  assert.equal((await repository.getCheckpoint(15, 'asta amici'))?.value.sequence, 7)
})

test('assignment outcomes are append-only create-only documents keyed by accepted sequence', async () => {
  const client = new FakeContentClient()
  const repository = new GitHubAuctionRepository(new GitHubJsonStore(client), target)
  const pending = outcome()

  const created = await repository.submitAssignmentOutcome(pending)
  assert.equal(created.sha, 'write-1')
  assert.equal(
    auctionAssignmentOutcomeDocumentPath(15, 'asta amici', 8),
    'data/groups/seasons/15/auctions/asta%20amici/outcomes/8.json',
  )
  assert.deepEqual((await repository.getAssignmentOutcome(15, 'asta amici', 8))?.value, pending)
  await assert.rejects(repository.submitAssignmentOutcome(pending), RepositoryWriteConflictError)
  await assert.rejects(
    repository.submitAssignmentOutcome({ ...pending, status: 'applied', result: { processedAt: '2026-09-06T16:07:00Z' } }),
    /Only pending auction outcomes/,
  )
})

test('createCheckpoint remains create-only', async () => {
  const client = new FakeContentClient()
  const repository = new GitHubAuctionRepository(new GitHubJsonStore(client), target)
  await repository.createCheckpoint(checkpoint())
  await assert.rejects(repository.createCheckpoint(checkpoint()), RepositoryWriteConflictError)
})
