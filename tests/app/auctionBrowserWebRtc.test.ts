import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AUCTION_DATA_CHANNEL_LABEL,
  BrowserAuctionRtcNegotiator,
  waitForIceGatheringComplete,
  type BrowserAuctionRealtimePeer,
  type BrowserRtcDataChannelLike,
  type BrowserRtcPeerConnectionLike,
  type BrowserRtcSessionDescriptionInit,
} from '../../src/app/services/auctionBrowserWebRtc'

class FakeDataChannel implements BrowserRtcDataChannelLike {
  readyState = 'connecting'
  readonly sent: string[] = []
  closed = false
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: ((event?: unknown) => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null

  constructor(readonly label = AUCTION_DATA_CHANNEL_LABEL) {}

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.closed = true
    this.readyState = 'closed'
    this.onclose?.()
  }

  open(): void {
    this.readyState = 'open'
    this.onopen?.()
  }

  receive(data: unknown): void {
    this.onmessage?.({ data })
  }
}

class FakePeerConnection implements BrowserRtcPeerConnectionLike {
  iceGatheringState = 'new'
  connectionState = 'new'
  localDescription: BrowserRtcSessionDescriptionInit | null = null
  remoteDescription: BrowserRtcSessionDescriptionInit | null = null
  onicegatheringstatechange: (() => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  ondatachannel: ((event: { channel: BrowserRtcDataChannelLike }) => void) | null = null
  readonly listeners = new Set<() => void>()
  readonly channels: Array<{ label: string; ordered: boolean | undefined; channel: FakeDataChannel }> = []
  closed = false

  createDataChannel(label: string, options?: { ordered?: boolean }): BrowserRtcDataChannelLike {
    const channel = new FakeDataChannel(label)
    this.channels.push({ label, ordered: options?.ordered, channel })
    return channel
  }

  async createOffer(): Promise<BrowserRtcSessionDescriptionInit> {
    return { type: 'offer', sdp: 'offer-before-ice' }
  }

  async createAnswer(): Promise<BrowserRtcSessionDescriptionInit> {
    return { type: 'answer', sdp: 'answer-before-ice' }
  }

  async setLocalDescription(description: BrowserRtcSessionDescriptionInit): Promise<void> {
    this.localDescription = { ...description }
    this.iceGatheringState = 'gathering'
  }

  async setRemoteDescription(description: BrowserRtcSessionDescriptionInit): Promise<void> {
    this.remoteDescription = { ...description }
  }

  addEventListener(_type: 'icegatheringstatechange', listener: () => void): void {
    this.listeners.add(listener)
  }

  removeEventListener(_type: 'icegatheringstatechange', listener: () => void): void {
    this.listeners.delete(listener)
  }

  completeIce(sdp?: string): void {
    if (this.localDescription && sdp) this.localDescription = { ...this.localDescription, sdp }
    this.iceGatheringState = 'complete'
    this.onicegatheringstatechange?.()
    for (const listener of [...this.listeners]) listener()
  }

  setConnectionState(state: string): void {
    this.connectionState = state
    this.onconnectionstatechange?.()
  }

  emitDataChannel(channel: BrowserRtcDataChannelLike): void {
    this.ondatachannel?.({ channel })
  }

  close(): void {
    this.closed = true
    this.connectionState = 'closed'
  }
}

test('host creates one ordered DataChannel before offer and publishes SDP only after ICE completes', async () => {
  const connection = new FakePeerConnection()
  let peer: BrowserAuctionRealtimePeer | null = null
  const negotiator = new BrowserAuctionRtcNegotiator({
    role: 'host',
    peerId: 'alice-device',
    email: 'alice@example.com',
    peerConnectionFactory: () => connection,
    callbacks: { onPeerReady: value => { peer = value } },
  })

  assert.equal(connection.channels.length, 1)
  assert.equal(connection.channels[0]?.label, AUCTION_DATA_CHANNEL_LABEL)
  assert.equal(connection.channels[0]?.ordered, true)
  assert.ok(peer)

  const pending = negotiator.createOffer()
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(connection.iceGatheringState, 'gathering')
  connection.completeIce('offer-with-complete-ice')

  assert.deepEqual(await pending, { type: 'offer', sdp: 'offer-with-complete-ice' })
  assert.deepEqual(connection.localDescription, { type: 'offer', sdp: 'offer-with-complete-ice' })
})

test('participant receives the negotiated channel, applies offer and returns a complete ICE answer', async () => {
  const connection = new FakePeerConnection()
  const channel = new FakeDataChannel()
  const received: string[] = []
  let peer: BrowserAuctionRealtimePeer | null = null
  const negotiator = new BrowserAuctionRtcNegotiator({
    role: 'participant',
    peerId: 'alice-device',
    email: 'Alice@Example.com',
    peerConnectionFactory: () => connection,
    callbacks: {
      onPeerReady: value => { peer = value },
      onText: (_value, text) => received.push(text),
    },
  })

  connection.emitDataChannel(channel)
  assert.ok(peer)
  assert.equal(peer?.email, 'alice@example.com')
  assert.throws(() => peer?.sendText('too-early'), /not open/i)

  const pending = negotiator.acceptOffer({ type: 'offer', sdp: 'remote-offer' })
  await Promise.resolve()
  await Promise.resolve()
  assert.deepEqual(connection.remoteDescription, { type: 'offer', sdp: 'remote-offer' })
  connection.completeIce('answer-with-complete-ice')
  assert.deepEqual(await pending, { type: 'answer', sdp: 'answer-with-complete-ice' })

  channel.open()
  peer?.sendText('hello host')
  assert.deepEqual(channel.sent, ['hello host'])
  channel.receive('hello peer')
  assert.deepEqual(received, ['hello peer'])
})

test('host applies participant answer as remote description', async () => {
  const connection = new FakePeerConnection()
  const negotiator = new BrowserAuctionRtcNegotiator({
    role: 'host',
    peerId: 'alice-device',
    email: 'alice@example.com',
    peerConnectionFactory: () => connection,
  })

  await negotiator.acceptAnswer({ type: 'answer', sdp: 'participant-answer' })
  assert.deepEqual(connection.remoteDescription, { type: 'answer', sdp: 'participant-answer' })
})

test('forwards browser RTCPeerConnection state changes to the coordinator boundary', () => {
  const connection = new FakePeerConnection()
  const states: string[] = []
  const negotiator = new BrowserAuctionRtcNegotiator({
    role: 'participant',
    peerId: 'alice-device',
    email: 'alice@example.com',
    peerConnectionFactory: () => connection,
    callbacks: { onConnectionState: state => states.push(state) },
  })

  connection.setConnectionState('connected')
  connection.setConnectionState('disconnected')
  connection.setConnectionState('failed')

  assert.deepEqual(states, ['connected', 'disconnected', 'failed'])
  assert.equal(negotiator.connectionState, 'failed')
})

test('rejects incomplete ICE gathering instead of publishing partial SDP', async () => {
  const connection = new FakePeerConnection()
  const negotiator = new BrowserAuctionRtcNegotiator({
    role: 'host',
    peerId: 'alice-device',
    email: 'alice@example.com',
    iceGatheringTimeoutMs: 5,
    peerConnectionFactory: () => connection,
  })

  await assert.rejects(negotiator.createOffer(), /ICE gathering did not complete/i)
})

test('waitForIceGatheringComplete resolves immediately for an already complete connection', async () => {
  const connection = new FakePeerConnection()
  connection.iceGatheringState = 'complete'
  await assert.doesNotReject(waitForIceGatheringComplete(connection, 5))
})

test('closes unexpected participant DataChannels and closes the peer connection idempotently', () => {
  const connection = new FakePeerConnection()
  const negotiator = new BrowserAuctionRtcNegotiator({
    role: 'participant',
    peerId: 'alice-device',
    email: 'alice@example.com',
    peerConnectionFactory: () => connection,
  })
  const wrong = new FakeDataChannel('other-protocol')
  connection.emitDataChannel(wrong)
  assert.equal(wrong.closed, true)
  assert.equal(negotiator.realtimePeer, null)

  negotiator.close()
  negotiator.close()
  assert.equal(connection.closed, true)
})
