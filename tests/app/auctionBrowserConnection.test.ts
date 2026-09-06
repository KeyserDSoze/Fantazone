import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createAuctionSessionDescriptionSignal,
  createAuctionSignalingRoom,
  createEmptyAuctionPeerIndex,
  upsertAuctionSignalingPeer,
  type AuctionCheckpoint,
  type AuctionSessionDescription,
  type AuctionSessionDescriptionSignal,
  type AuctionSignalingPeerIndex,
} from '../../src/domain/src/index'
import type { GitHubAuctionSignalingRepository } from '../../src/github/src/index'
import {
  BrowserAuctionHostConnectionCoordinator,
  BrowserAuctionParticipantConnectionCoordinator,
} from '../../src/app/services/auctionBrowserConnection'
import type {
  BrowserAuctionRtcCallbacks,
  BrowserAuctionRtcOptions,
} from '../../src/app/services/auctionBrowserWebRtc'
import type { AuctionRtcNegotiator } from '../../src/app/services/auctionWebRtcSignaling'

const room = createAuctionSignalingRoom({
  auctionId: 'auction-1',
  sessionId: 'session-1',
  hostPeerId: 'host-device',
  hostEmail: 'host@example.com',
  now: new Date('2026-09-06T18:00:00Z'),
  ttlMs: 60 * 60 * 1000,
})

class FakeSignalingRepository {
  peerIndex: AuctionSignalingPeerIndex = createEmptyAuctionPeerIndex(room)
  readonly descriptions = new Map<string, AuctionSessionDescriptionSignal>()
  roomWrites = 0

  async publishRoom() {
    this.roomWrites += 1
    return snapshot(room, 'room')
  }

  async getPeerIndex() {
    return snapshot(this.peerIndex, 'peers')
  }

  async upsertPeer(_room: unknown, input: { peerId: string; email: string; at?: Date; restart?: boolean }) {
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

class FakeTransport {
  readonly sent: string[] = []
  readyState = 'open'
  closed = false

  constructor(readonly peerId: string, readonly email: string) {}

  sendText(text: string): void {
    if (this.readyState !== 'open') throw new Error('transport closed')
    this.sent.push(text)
  }

  close(): void {
    this.closed = true
    this.readyState = 'closed'
  }
}

class FakeNegotiator implements AuctionRtcNegotiator {
  readonly transport: FakeTransport
  offers = 0
  answers = 0
  appliedAnswers = 0
  closed = false

  constructor(readonly options: BrowserAuctionRtcOptions) {
    this.transport = new FakeTransport(options.peerId, options.email.trim().toLowerCase())
    if (options.role === 'host') options.callbacks?.onPeerReady?.(this.transport as any)
  }

  async createOffer(): Promise<AuctionSessionDescription> {
    this.offers += 1
    return { type: 'offer', sdp: `offer-${this.options.peerId}-${this.offers}` }
  }

  async acceptOffer(offer: AuctionSessionDescription): Promise<AuctionSessionDescription> {
    assert.equal(offer.type, 'offer')
    this.answers += 1
    this.options.callbacks?.onPeerReady?.(this.transport as any)
    this.options.callbacks?.onOpen?.(this.transport as any)
    return { type: 'answer', sdp: `answer-${this.options.peerId}-${this.answers}` }
  }

  async acceptAnswer(answer: AuctionSessionDescription): Promise<void> {
    assert.equal(answer.type, 'answer')
    this.appliedAnswers += 1
  }

  close(): void {
    this.closed = true
    this.transport.close()
  }
}

test('host coordinator wires signaling peers to the realtime host and recreates a peer on generation change', async () => {
  const repository = new FakeSignalingRepository()
  repository.peerIndex = upsertAuctionSignalingPeer(repository.peerIndex, {
    peerId: 'alice-device', email: 'alice@example.com', at: new Date('2026-09-06T18:00:01Z'),
  })
  const negotiators: FakeNegotiator[] = []
  const attached: string[] = []
  const received: Array<{ peerId: string; text: string }> = []
  const realtime = {
    attachPeer(peer: { peerId: string }) { attached.push(peer.peerId) },
    detachPeer() {},
    async receivePeerText(peerId: string, text: string) { received.push({ peerId, text }); return null },
    close() {},
  }
  const coordinator = new BrowserAuctionHostConnectionCoordinator({
    repository: repository as unknown as GitHubAuctionSignalingRepository,
    room,
    realtime: realtime as any,
    signalingPollIntervalMs: 60_000,
    negotiatorFactory: options => {
      const negotiator = new FakeNegotiator(options)
      negotiators.push(negotiator)
      return negotiator
    },
  })

  await coordinator.start()
  assert.equal(repository.roomWrites, 1)
  assert.deepEqual(attached, ['alice-device'])
  assert.equal(repository.descriptions.get('alice-device:offer')?.generation, 0)

  repository.descriptions.set('alice-device:answer', createAuctionSessionDescriptionSignal({
    room,
    peerId: 'alice-device',
    generation: 0,
    kind: 'answer',
    sdp: 'answer-generation-0',
  }))
  await coordinator.pollNow()
  assert.equal(negotiators[0]?.appliedAnswers, 1)

  negotiators[0]?.options.callbacks?.onText?.(negotiators[0]!.transport as any, 'hello host')
  await Promise.resolve()
  assert.deepEqual(received, [{ peerId: 'alice-device', text: 'hello host' }])

  repository.peerIndex = upsertAuctionSignalingPeer(repository.peerIndex, {
    peerId: 'alice-device', email: 'alice@example.com', restart: true, at: new Date('2026-09-06T18:00:10Z'),
  })
  await coordinator.pollNow()
  assert.equal(negotiators.length, 2)
  assert.equal(negotiators[0]?.closed, true)
  assert.equal(repository.descriptions.get('alice-device:offer')?.generation, 1)
  assert.deepEqual(attached, ['alice-device', 'alice-device'])

  coordinator.close()
})

test('participant reconnects on failed state, increments generation and requests a checkpoint after every reopened channel', async () => {
  const repository = new FakeSignalingRepository()
  const negotiators: FakeNegotiator[] = []
  const checkpoints: number[] = []
  const coordinator = new BrowserAuctionParticipantConnectionCoordinator({
    repository: repository as unknown as GitHubAuctionSignalingRepository,
    room,
    peer: { peerId: 'alice-device', email: 'alice@example.com' },
    auctionId: 'auction-1',
    checkpoint: checkpoint(4),
    signalingPollIntervalMs: 60_000,
    disconnectGraceMs: 10,
    realtimeCallbacks: { onCheckpoint: value => checkpoints.push(value.sequence) },
    negotiatorFactory: options => {
      const negotiator = new FakeNegotiator(options)
      negotiators.push(negotiator)
      return negotiator
    },
  })

  await coordinator.start()
  assert.equal(coordinator.generation, 0)
  repository.descriptions.set('alice-device:offer', createAuctionSessionDescriptionSignal({
    room,
    peerId: 'alice-device',
    generation: 0,
    kind: 'offer',
    sdp: 'offer-generation-0',
  }))
  await coordinator.pollNow()

  assert.equal(coordinator.connected, true)
  assert.equal(negotiators[0]?.transport.sent.length, 1)
  assert.equal(JSON.parse(negotiators[0]!.transport.sent[0]!).type, 'checkpoint-request')

  const freshCheckpoint = checkpoint(7)
  negotiators[0]?.options.callbacks?.onText?.(
    negotiators[0]!.transport as any,
    JSON.stringify({ version: 1, type: 'checkpoint', checkpoint: freshCheckpoint }),
  )
  assert.deepEqual(checkpoints, [7])

  negotiators[0]?.options.callbacks?.onConnectionState?.('failed')
  await coordinator.waitForReconnect()
  assert.equal(coordinator.generation, 1)
  assert.equal(negotiators.length, 2)
  assert.equal(negotiators[0]?.closed, true)
  assert.equal(coordinator.connected, false)

  repository.descriptions.set('alice-device:offer', createAuctionSessionDescriptionSignal({
    room,
    peerId: 'alice-device',
    generation: 1,
    kind: 'offer',
    sdp: 'offer-generation-1',
  }))
  await coordinator.pollNow()
  assert.equal(coordinator.connected, true)
  assert.equal(JSON.parse(negotiators[1]!.transport.sent[0]!).type, 'checkpoint-request')
  assert.equal(JSON.parse(negotiators[1]!.transport.sent[0]!).nextSequence, 8)

  coordinator.sendCommand({
    version: 1,
    commandId: 'bid-1',
    auctionId: 'auction-1',
    actor: 'alice@example.com',
    clientTime: 1,
    type: 'PLACE_BID',
    amount: 20,
  })
  assert.equal(JSON.parse(negotiators[1]!.transport.sent.at(-1)!).type, 'command')

  coordinator.close()
})

function checkpoint(sequence: number): AuctionCheckpoint {
  return { version: 1, id: 'auction-1', sequence } as AuctionCheckpoint
}

function snapshot<T>(value: T, sha: string) {
  return { value: JSON.parse(JSON.stringify(value)) as T, sha, fromCache: false }
}
