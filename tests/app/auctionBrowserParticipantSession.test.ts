import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createAuctionSessionDescriptionSignal,
  createAuctionSignalingRoom,
  createEmptyAuctionPeerIndex,
  upsertAuctionSignalingPeer,
  type AuctionSessionDescriptionSignal,
  type AuctionSignalingPeerIndex,
} from '../../src/domain/src/index'
import {
  AuctionBrowserParticipantSession,
  type AuctionBrowserParticipantConnectionStatus,
} from '../../src/app/services/auctionBrowserParticipantSession'
import type {
  BrowserRtcDataChannelEvent,
  BrowserRtcDataChannelLike,
  BrowserRtcPeerConnectionLike,
  BrowserRtcSessionDescriptionInit,
} from '../../src/app/services/auctionBrowserWebRtc'

class FakeSignalingRepository {
  readonly room = createAuctionSignalingRoom({
    auctionId: 'auction-1', sessionId: 'session-1', hostPeerId: 'host', hostEmail: 'host@example.com',
    now: new Date('2026-09-06T19:00:00Z'), ttlMs: 60_000,
  })
  peerIndex: AuctionSignalingPeerIndex = createEmptyAuctionPeerIndex(this.room)
  readonly descriptions = new Map<string, AuctionSessionDescriptionSignal>()

  async upsertPeer(_room: unknown, input: { peerId: string; email: string; at?: Date; restart?: boolean }) {
    this.peerIndex = upsertAuctionSignalingPeer(this.peerIndex, input)
    return snapshot(this.peerIndex, `peer-${this.peerIndex.peers[0]?.generation ?? 0}`)
  }

  async getDescription(_room: unknown, peerId: string, kind: 'offer' | 'answer') {
    const value = this.descriptions.get(`${peerId}:${kind}`)
    return value ? snapshot(value, `${peerId}:${kind}:${value.generation}`) : null
  }

  async publishDescription(_room: unknown, signal: AuctionSessionDescriptionSignal) {
    this.descriptions.set(`${signal.peerId}:${signal.kind}`, signal)
    return snapshot(signal, `${signal.peerId}:${signal.kind}:${signal.generation}`)
  }
}

class FakeDataChannel implements BrowserRtcDataChannelLike {
  label = 'fantazone-auction-v1'
  readyState = 'connecting'
  readonly sent: string[] = []
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: ((event?: unknown) => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null

  send(data: string): void { this.sent.push(data) }
  close(): void { this.readyState = 'closed'; this.onclose?.() }
  open(): void { this.readyState = 'open'; this.onopen?.() }
}

class FakePeerConnection implements BrowserRtcPeerConnectionLike {
  iceGatheringState = 'complete'
  connectionState = 'new'
  localDescription: BrowserRtcSessionDescriptionInit | null = null
  onicegatheringstatechange: (() => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  ondatachannel: ((event: BrowserRtcDataChannelEvent) => void) | null = null
  remoteDescription: BrowserRtcSessionDescriptionInit | null = null
  closed = false

  createDataChannel(): BrowserRtcDataChannelLike { throw new Error('participant does not create DataChannel') }
  async createOffer(): Promise<BrowserRtcSessionDescriptionInit> { throw new Error('participant does not create offers') }
  async createAnswer(): Promise<BrowserRtcSessionDescriptionInit> { return { type: 'answer', sdp: 'answer-sdp' } }
  async setLocalDescription(description: BrowserRtcSessionDescriptionInit): Promise<void> { this.localDescription = description }
  async setRemoteDescription(description: BrowserRtcSessionDescriptionInit): Promise<void> { this.remoteDescription = description }
  close(): void { this.closed = true; this.connectionState = 'closed'; this.onconnectionstatechange?.() }

  emitChannel(channel: FakeDataChannel): void { this.ondatachannel?.({ channel }) }
  setState(state: string): void { this.connectionState = state; this.onconnectionstatechange?.() }
}

test('reconnects a failed browser participant with the same peer id and next generation', async () => {
  const repository = new FakeSignalingRepository()
  const pcs: FakePeerConnection[] = []
  const statuses: AuctionBrowserParticipantConnectionStatus[] = []
  let now = new Date('2026-09-06T19:00:01Z')

  const session = new AuctionBrowserParticipantSession({
    repository: repository as any,
    room: repository.room,
    peerId: 'alice-device',
    email: 'alice@example.com',
    now: () => now,
    callbacks: { onStatus: status => statuses.push(status) },
    rtc: {
      peerConnectionFactory: () => {
        const pc = new FakePeerConnection()
        pcs.push(pc)
        return pc
      },
    },
  })

  await session.start()
  assert.equal(session.generation, 1)
  assert.equal(pcs.length, 1)

  repository.descriptions.set('alice-device:offer', createAuctionSessionDescriptionSignal({
    room: repository.room,
    peerId: 'alice-device',
    generation: 1,
    kind: 'offer',
    sdp: 'offer-1',
    now,
  }))
  await session.pollSignaling()
  assert.equal(repository.descriptions.get('alice-device:answer')?.generation, 1)
  assert.equal(pcs[0]?.remoteDescription?.sdp, 'offer-1')

  const firstChannel = new FakeDataChannel()
  pcs[0]?.emitChannel(firstChannel)
  firstChannel.open()
  assert.equal(session.connectionStatus, 'connected')
  assert.match(firstChannel.sent[0] ?? '', /checkpoint-request/)

  now = new Date('2026-09-06T19:00:10Z')
  pcs[0]?.setState('failed')
  await tick()
  await tick()

  assert.equal(session.generation, 2)
  assert.equal(pcs.length, 2)
  assert.equal(repository.peerIndex.peers[0]?.peerId, 'alice-device')
  assert.equal(repository.peerIndex.peers[0]?.generation, 2)
  assert.equal(pcs[0]?.closed, true)
  assert.ok(statuses.includes('reconnecting'))

  repository.descriptions.set('alice-device:offer', createAuctionSessionDescriptionSignal({
    room: repository.room,
    peerId: 'alice-device',
    generation: 2,
    kind: 'offer',
    sdp: 'offer-2',
    now,
  }))
  await session.pollSignaling()
  assert.equal(repository.descriptions.get('alice-device:answer')?.generation, 2)
  assert.equal(pcs[1]?.remoteDescription?.sdp, 'offer-2')

  const secondChannel = new FakeDataChannel()
  pcs[1]?.emitChannel(secondChannel)
  secondChannel.open()
  assert.equal(session.connectionStatus, 'connected')
  assert.match(secondChannel.sent[0] ?? '', /checkpoint-request/)
})

test('waits through transient disconnected state and cancels restart if connection recovers', async () => {
  const repository = new FakeSignalingRepository()
  const pcs: FakePeerConnection[] = []
  let scheduled: (() => void) | null = null
  let cleared = false

  const session = new AuctionBrowserParticipantSession({
    repository: repository as any,
    room: repository.room,
    peerId: 'alice-device',
    email: 'alice@example.com',
    disconnectedGraceMs: 5_000,
    setTimeoutFn: callback => { scheduled = callback; return 'timer' },
    clearTimeoutFn: () => { cleared = true; scheduled = null },
    rtc: {
      peerConnectionFactory: () => {
        const pc = new FakePeerConnection()
        pcs.push(pc)
        return pc
      },
    },
  })

  await session.start()
  pcs[0]?.setState('disconnected')
  assert.ok(scheduled)
  assert.equal(session.generation, 1)

  pcs[0]?.setState('connected')
  assert.equal(cleared, true)
  assert.equal(scheduled, null)
  assert.equal(session.generation, 1)
  assert.equal(pcs.length, 1)
})

function snapshot<T>(value: T, sha: string) {
  return { value: JSON.parse(JSON.stringify(value)) as T, sha, fromCache: false }
}

async function tick(): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, 0))
}
