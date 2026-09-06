import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createAuctionSessionDescriptionSignal,
  createAuctionSignalingRoom,
  type AuctionSignalingPeerIndex,
} from '../../src/domain/src/index'
import {
  AuctionSignalingRoomBusyError,
  AuctionSignalingSessionChangedError,
  GitHubApiError,
  GitHubAuctionSignalingRepository,
  GitHubJsonStore,
  auctionSignalDocumentPath,
  auctionSignalingPeerIndexDocumentPath,
  auctionSignalingRoomDocumentPath,
  type RepositoryContentClient,
} from '../../src/github/src/index'

type StoredFile = { sha: string; content: string }

class FakeContentClient implements RepositoryContentClient {
  readonly files = new Map<string, StoredFile>()
  writes = 0
  conflictPeerIndexOnce = false

  async tryGetContent(owner: string, repo: string, path: string, ref?: string): Promise<StoredFile | null> {
    return this.files.get(key(owner, repo, path, ref)) ?? null
  }

  async putContent(
    owner: string,
    repo: string,
    path: string,
    text: string,
    _message: string,
    sha?: string,
    branch?: string,
  ): Promise<{ sha: string }> {
    const fileKey = key(owner, repo, path, branch)
    const existing = this.files.get(fileKey)

    if (path.endsWith('/peers.json') && this.conflictPeerIndexOnce) {
      this.conflictPeerIndexOnce = false
      const attempted = JSON.parse(text) as AuctionSignalingPeerIndex
      const concurrent: AuctionSignalingPeerIndex = {
        ...attempted,
        peers: [{
          peerId: 'bob-device',
          email: 'bob@example.com',
          joinedAt: '2026-09-06T18:00:01.000Z',
          lastSeenAt: '2026-09-06T18:00:01.000Z',
          generation: 1,
        }],
      }
      this.files.set(fileKey, { sha: 'peer-index-concurrent', content: JSON.stringify(concurrent) })
      throw new GitHubApiError(409, 'synthetic peer join race')
    }

    if (existing && sha !== existing.sha) throw new GitHubApiError(409, 'stale sha')
    if (!existing && sha) throw new GitHubApiError(409, 'unexpected sha')
    this.writes += 1
    const nextSha = `write-${this.writes}`
    this.files.set(fileKey, { sha: nextSha, content: text })
    return { sha: nextSha }
  }
}

const target = { owner: 'KeyserDSoze', repo: 'Fantazone.Amici', ref: 'main' }

function room(sessionId = 'session-1', now = new Date('2026-09-06T18:00:00Z')) {
  return createAuctionSignalingRoom({
    auctionId: 'auction-1',
    sessionId,
    hostPeerId: 'host-device',
    hostEmail: 'host@example.com',
    now,
    ttlMs: 60_000,
  })
}

test('uses session-scoped realtime paths for room, peers and SDP', () => {
  assert.equal(auctionSignalingRoomDocumentPath('auction 1'), 'realtime/auctions/auction%201/room.json')
  assert.equal(
    auctionSignalingPeerIndexDocumentPath('auction 1', 'session/1'),
    'realtime/auctions/auction%201/signaling/session%2F1/peers.json',
  )
  assert.equal(
    auctionSignalDocumentPath('auction 1', 'session/1', 'peer/alice', 'offer'),
    'realtime/auctions/auction%201/signaling/session%2F1/peer%2Falice/offer.json',
  )
})

test('does not let a second host steal an active room but permits replacing an expired room', async () => {
  let now = new Date('2026-09-06T18:00:10Z')
  const client = new FakeContentClient()
  const repository = new GitHubAuctionSignalingRepository(new GitHubJsonStore(client), target, () => now)
  await repository.publishRoom(room('session-1'))

  await assert.rejects(
    repository.publishRoom(room('session-2', new Date('2026-09-06T18:00:10Z'))),
    AuctionSignalingRoomBusyError,
  )

  now = new Date('2026-09-06T18:01:01Z')
  const replacement = await repository.publishRoom(room('session-2', now))
  assert.equal(replacement.value.sessionId, 'session-2')
})

test('retries a concurrent peer-index write and preserves both joins', async () => {
  const client = new FakeContentClient()
  const activeRoom = room()
  const repository = new GitHubAuctionSignalingRepository(
    new GitHubJsonStore(client),
    target,
    () => new Date('2026-09-06T18:00:10Z'),
  )
  await repository.publishRoom(activeRoom)
  client.conflictPeerIndexOnce = true

  const written = await repository.upsertPeer(activeRoom, {
    peerId: 'alice-device',
    email: 'alice@example.com',
    at: new Date('2026-09-06T18:00:02Z'),
  })

  assert.deepEqual(written.value.peers.map(peer => peer.peerId).sort(), ['alice-device', 'bob-device'])
  assert.equal((await repository.getPeerIndex(activeRoom))?.value.peers.length, 2)
})

test('publishes and refreshes SDP only inside the current room session', async () => {
  const client = new FakeContentClient()
  const activeRoom = room()
  const repository = new GitHubAuctionSignalingRepository(
    new GitHubJsonStore(client),
    target,
    () => new Date('2026-09-06T18:00:10Z'),
  )
  await repository.publishRoom(activeRoom)

  const offer = createAuctionSessionDescriptionSignal({
    room: activeRoom,
    peerId: 'alice-device',
    generation: 1,
    kind: 'offer',
    sdp: 'v=0 offer',
    now: new Date('2026-09-06T18:00:03Z'),
  })
  await repository.publishDescription(activeRoom, offer)
  assert.equal((await repository.getDescription(activeRoom, 'alice-device', 'offer'))?.value.description.sdp, 'v=0 offer')

  const staleRoom = room('session-old')
  await assert.rejects(
    repository.getDescription(staleRoom, 'alice-device', 'offer'),
    AuctionSignalingSessionChangedError,
  )
})

function key(owner: string, repo: string, path: string, ref?: string): string {
  return `${owner}/${repo}/${path}@${ref ?? ''}`
}
