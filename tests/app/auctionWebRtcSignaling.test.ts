import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createAuctionSessionDescriptionSignal,
  createAuctionSignalingRoom,
  createEmptyAuctionPeerIndex,
  upsertAuctionSignalingPeer,
  type AuctionSessionDescription,
  type AuctionSessionDescriptionSignal,
  type AuctionSignalingPeerIndex,
} from '../../src/domain/src/index'
import {
  AuctionWebRtcHostSignalingController,
  AuctionWebRtcParticipantSignalingController,
  type AuctionRtcNegotiator,
} from '../../src/app/services/auctionWebRtcSignaling'

class FakeSignalingRepository {
  readonly room = createAuctionSignalingRoom({
    auctionId: 'auction-1', sessionId: 'session-1', hostPeerId: 'host', hostEmail: 'host@example.com',
    now: new Date('2026-09-06T18:00:00Z'), ttlMs: 60_000,
  })
  peerIndex: AuctionSignalingPeerIndex = createEmptyAuctionPeerIndex(this.room)
  readonly descriptions = new Map<string, AuctionSessionDescriptionSignal>()
  roomPublished = 0
  peerWrites = 0

  async publishRoom() {
    this.roomPublished += 1
    return snapshot(this.room, 'room')
  }

  async getPeerIndex() {
    return snapshot(this.peerIndex, 'peers')
  }

  async upsertPeer(_room: unknown, input: { peerId: string; email: string; at?: Date; restart?: boolean }) {
    this.peerWrites += 1
    this.peerIndex = upsertAuctionSignalingPeer(this.peerIndex, input)
    return snapshot(this.peerIndex, 'peers')
  }

  async publishDescription(_room: unknown, signal: AuctionSessionDescriptionSignal) {
    this.descriptions.set(`${signal.peerId}:${signal.kind}`, signal)
    return snapshot(signal, `${signal.peerId}:${signal.kind}`)
  }

  async getDescription(_room: unknown, peerId: string, kind: 'offer' | 'answer') {
    const value = this.descriptions.get(`${peerId}:${kind}`)
    return value ? snapshot(value, `${peerId}:${kind}`) : null
  }
}

class FakeNegotiator implements AuctionRtcNegotiator {
  offers = 0
  acceptedOffers = 0
  acceptedAnswers = 0
  closed = false

  async createOffer(): Promise<AuctionSessionDescription> {
    this.offers += 1
    return { type: 'offer', sdp: `offer-${this.offers}` }
  }

  async acceptOffer(offer: AuctionSessionDescription): Promise<AuctionSessionDescription> {
    assert.equal(offer.type, 'offer')
    this.acceptedOffers += 1
    return { type: 'answer', sdp: `answer-${this.acceptedOffers}` }
  }

  async acceptAnswer(answer: AuctionSessionDescription): Promise<void> {
    assert.equal(answer.type, 'answer')
    this.acceptedAnswers += 1
  }

  close(): void {
    this.closed = true
  }
}

test('host discovers each peer once, publishes one offer and applies one same-generation answer', async () => {
  const repository = new FakeSignalingRepository()
  repository.peerIndex = upsertAuctionSignalingPeer(repository.peerIndex, {
    peerId: 'alice-device', email: 'alice@example.com', at: new Date('2026-09-06T18:00:01Z'),
  })
  const negotiators: FakeNegotiator[] = []
  const host = new AuctionWebRtcHostSignalingController(
    repository as any,
    repository.room,
    () => {
      const negotiator = new FakeNegotiator()
      negotiators.push(negotiator)
      return negotiator
    },
  )

  await host.start()
  const first = await host.poll()
  assert.deepEqual(first, { discoveredPeers: ['alice-device'], restartedPeers: [], answeredPeers: [] })
  assert.equal(repository.roomPublished, 1)
  assert.equal(negotiators[0]?.offers, 1)
  assert.equal(repository.descriptions.get('alice-device:offer')?.generation, 1)
  assert.equal(repository.descriptions.get('alice-device:offer')?.description.sdp, 'offer-1')

  repository.descriptions.set('alice-device:answer', createAuctionSessionDescriptionSignal({
    room: repository.room,
    peerId: 'alice-device',
    generation: 1,
    kind: 'answer',
    sdp: 'answer-from-alice',
    now: new Date('2026-09-06T18:00:03Z'),
  }))
  const second = await host.poll()
  assert.deepEqual(second, { discoveredPeers: [], restartedPeers: [], answeredPeers: ['alice-device'] })
  assert.equal(negotiators[0]?.acceptedAnswers, 1)

  const third = await host.poll()
  assert.deepEqual(third, { discoveredPeers: [], restartedPeers: [], answeredPeers: [] })
  assert.equal(negotiators[0]?.acceptedAnswers, 1)
})

test('generation change closes the old host connection, republishes offer and ignores stale answer', async () => {
  const repository = new FakeSignalingRepository()
  repository.peerIndex = upsertAuctionSignalingPeer(repository.peerIndex, {
    peerId: 'alice-device', email: 'alice@example.com', at: new Date('2026-09-06T18:00:01Z'),
  })
  const negotiators: FakeNegotiator[] = []
  const host = new AuctionWebRtcHostSignalingController(repository as any, repository.room, () => {
    const value = new FakeNegotiator()
    negotiators.push(value)
    return value
  })

  await host.poll()
  repository.descriptions.set('alice-device:answer', createAuctionSessionDescriptionSignal({
    room: repository.room,
    peerId: 'alice-device',
    generation: 1,
    kind: 'answer',
    sdp: 'old-answer',
  }))
  repository.peerIndex = upsertAuctionSignalingPeer(repository.peerIndex, {
    peerId: 'alice-device', email: 'alice@example.com', restart: true,
  })

  const restarted = await host.poll()
  assert.deepEqual(restarted, { discoveredPeers: [], restartedPeers: ['alice-device'], answeredPeers: [] })
  assert.equal(negotiators.length, 2)
  assert.equal(negotiators[0]?.closed, true)
  assert.equal(negotiators[1]?.acceptedAnswers, 0, 'generation-1 answer must not be applied to generation 2')
  assert.equal(repository.descriptions.get('alice-device:offer')?.generation, 2)

  repository.descriptions.set('alice-device:answer', createAuctionSessionDescriptionSignal({
    room: repository.room,
    peerId: 'alice-device',
    generation: 2,
    kind: 'answer',
    sdp: 'new-answer',
  }))
  const answered = await host.poll()
  assert.deepEqual(answered, { discoveredPeers: [], restartedPeers: [], answeredPeers: ['alice-device'] })
  assert.equal(negotiators[1]?.acceptedAnswers, 1)
})

test('participant throttles heartbeats, answers current generation and can request a fresh generation', async () => {
  const repository = new FakeSignalingRepository()
  const firstNegotiator = new FakeNegotiator()
  let now = new Date('2026-09-06T18:00:01Z')
  const participant = new AuctionWebRtcParticipantSignalingController(
    repository as any,
    repository.room,
    { peerId: 'alice-device', email: 'alice@example.com' },
    firstNegotiator,
    () => now,
  )

  await participant.join()
  assert.equal(participant.generation, 1)
  assert.equal(repository.peerIndex.peers[0]?.lastSeenAt, '2026-09-06T18:00:01.000Z')
  assert.equal(repository.peerWrites, 1)
  const empty = await participant.poll()
  assert.deepEqual(empty, { offerAccepted: false, answerPublished: false })
  assert.equal(repository.peerWrites, 1, 'polling does not create one Git commit per read')

  repository.descriptions.set('alice-device:offer', createAuctionSessionDescriptionSignal({
    room: repository.room,
    peerId: 'alice-device',
    generation: 1,
    kind: 'offer',
    sdp: 'host-offer',
    now: new Date('2026-09-06T18:00:02Z'),
  }))
  now = new Date('2026-09-06T18:00:03Z')
  const answered = await participant.poll()
  assert.deepEqual(answered, { offerAccepted: true, answerPublished: true })
  assert.equal(firstNegotiator.acceptedOffers, 1)
  assert.equal(repository.descriptions.get('alice-device:answer')?.generation, 1)
  assert.equal(repository.descriptions.get('alice-device:answer')?.description.sdp, 'answer-1')

  const replacement = new FakeNegotiator()
  now = new Date('2026-09-06T18:00:04Z')
  assert.equal(await participant.restart(replacement), 2)
  assert.equal(firstNegotiator.closed, true)
  assert.equal(participant.generation, 2)

  const staleOffer = await participant.poll()
  assert.deepEqual(staleOffer, { offerAccepted: false, answerPublished: false })
  assert.equal(replacement.acceptedOffers, 0)

  repository.descriptions.set('alice-device:offer', createAuctionSessionDescriptionSignal({
    room: repository.room,
    peerId: 'alice-device',
    generation: 2,
    kind: 'offer',
    sdp: 'host-offer-2',
    now: new Date('2026-09-06T18:00:05Z'),
  }))
  now = new Date('2026-09-06T18:00:06Z')
  const reanswered = await participant.poll()
  assert.deepEqual(reanswered, { offerAccepted: true, answerPublished: true })
  assert.equal(replacement.acceptedOffers, 1)
  assert.equal(repository.descriptions.get('alice-device:answer')?.generation, 2)

  now = new Date('2026-09-06T18:00:37Z')
  await participant.poll()
  assert.equal(repository.peerIndex.peers[0]?.lastSeenAt, '2026-09-06T18:00:37.000Z')
  assert.equal(repository.peerIndex.peers[0]?.generation, 2)
})

function snapshot<T>(value: T, sha: string) {
  return { value: JSON.parse(JSON.stringify(value)) as T, sha, fromCache: false }
}
