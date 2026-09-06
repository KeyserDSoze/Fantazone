import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createAuctionSignalingRoom,
  createEmptyAuctionPeerIndex,
  upsertAuctionSignalingPeer,
  type AuctionSessionDescriptionSignal,
  type AuctionSignalingPeerIndex,
} from '../../src/domain/src/index'
import { AuctionBrowserHostSession } from '../../src/app/services/auctionBrowserHostSession'
import type {
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

  async publishRoom() { return snapshot(this.room, 'room') }
  async getPeerIndex() { return snapshot(this.peerIndex, 'peers') }
  async publishDescription(_room: unknown, signal: AuctionSessionDescriptionSignal) {
    this.descriptions.set(`${signal.peerId}:${signal.kind}`, signal)
    return snapshot(signal, `${signal.peerId}:${signal.kind}`)
  }
  async getDescription(_room: unknown, peerId: string, kind: 'offer' | 'answer') {
    const value = this.descriptions.get(`${peerId}:${kind}`)
    return value ? snapshot(value, `${peerId}:${kind}`) : null
  }
}

class FakeDataChannel implements BrowserRtcDataChannelLike {
  label = 'fantazone-auction-v1'
  readyState = 'connecting'
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: ((event?: unknown) => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  readonly sent: string[] = []

  send(data: string): void { this.sent.push(data) }
  close(): void { this.readyState = 'closed'; this.onclose?.() }
  emitText(text: string): void { this.onmessage?.({ data: text }) }
}

class FakePeerConnection implements BrowserRtcPeerConnectionLike {
  iceGatheringState = 'complete'
  connectionState = 'new'
  localDescription: BrowserRtcSessionDescriptionInit | null = null
  onicegatheringstatechange: (() => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  ondatachannel = null
  readonly channel = new FakeDataChannel()
  remoteDescription: BrowserRtcSessionDescriptionInit | null = null
  closed = false

  createDataChannel(): BrowserRtcDataChannelLike { return this.channel }
  async createOffer(): Promise<BrowserRtcSessionDescriptionInit> { return { type: 'offer', sdp: 'host-offer' } }
  async createAnswer(): Promise<BrowserRtcSessionDescriptionInit> { throw new Error('host does not create answer') }
  async setLocalDescription(description: BrowserRtcSessionDescriptionInit): Promise<void> { this.localDescription = description }
  async setRemoteDescription(description: BrowserRtcSessionDescriptionInit): Promise<void> { this.remoteDescription = description }
  close(): void { this.closed = true; this.channel.close() }
}

class FakeRealtimeHost {
  readonly attached: string[] = []
  readonly detached: string[] = []
  readonly messages: Array<{ peerId: string; text: string }> = []

  attachPeer(peer: { peerId: string }): void { this.attached.push(peer.peerId) }
  detachPeer(peerId: string): void { this.detached.push(peerId) }
  async receivePeerText(peerId: string, text: string): Promise<null> {
    this.messages.push({ peerId, text })
    return null
  }
}

test('host wires DataChannel text to realtime controller and replaces it on generation restart', async () => {
  const repository = new FakeSignalingRepository()
  repository.peerIndex = upsertAuctionSignalingPeer(repository.peerIndex, {
    peerId: 'alice-device', email: 'alice@example.com', at: new Date('2026-09-06T19:00:01Z'),
  })
  const pcs: FakePeerConnection[] = []
  const realtime = new FakeRealtimeHost()
  const host = new AuctionBrowserHostSession({
    repository: repository as any,
    room: repository.room,
    realtime: realtime as any,
    rtc: {
      peerConnectionFactory: () => {
        const pc = new FakePeerConnection()
        pcs.push(pc)
        return pc
      },
    },
  })

  const started = await host.start()
  assert.deepEqual(started, { discoveredPeers: ['alice-device'], restartedPeers: [], answeredPeers: [] })
  assert.deepEqual(realtime.attached, ['alice-device'])
  assert.equal(repository.descriptions.get('alice-device:offer')?.generation, 1)

  pcs[0]?.channel.emitText('{"version":1,"type":"checkpoint-request","nextSequence":1}')
  await tick()
  assert.deepEqual(realtime.messages, [{
    peerId: 'alice-device',
    text: '{"version":1,"type":"checkpoint-request","nextSequence":1}',
  }])

  repository.peerIndex = upsertAuctionSignalingPeer(repository.peerIndex, {
    peerId: 'alice-device', email: 'alice@example.com', restart: true,
  })
  const restarted = await host.pollSignaling()
  assert.deepEqual(restarted, { discoveredPeers: [], restartedPeers: ['alice-device'], answeredPeers: [] })
  assert.equal(pcs.length, 2)
  assert.equal(pcs[0]?.closed, true)
  assert.equal(repository.descriptions.get('alice-device:offer')?.generation, 2)
  assert.deepEqual(realtime.attached, ['alice-device', 'alice-device'])
  assert.ok(realtime.detached.includes('alice-device'))
})

function snapshot<T>(value: T, sha: string) {
  return { value: JSON.parse(JSON.stringify(value)) as T, sha, fromCache: false }
}

async function tick(): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, 0))
}
