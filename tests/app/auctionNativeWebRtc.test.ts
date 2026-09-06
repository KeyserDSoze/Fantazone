import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createNativeAuctionBrowserNegotiatorFactory,
  createNativeAuctionRtcNegotiator,
  createReactNativeWebRtcPeerConnectionFactory,
  type ReactNativeWebRtcModuleLike,
} from '../../src/app/services/auctionNativeWebRtc'
import type {
  BrowserRtcDataChannelLike,
  BrowserRtcPeerConnectionLike,
  BrowserRtcSessionDescriptionInit,
} from '../../src/app/services/auctionBrowserWebRtc'

class FakeDataChannel implements BrowserRtcDataChannelLike {
  readyState = 'open'
  readonly sent: string[] = []
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: ((event?: unknown) => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null

  constructor(readonly label = 'fantazone-auction-v1') {}
  send(data: string): void { this.sent.push(data) }
  close(): void { this.readyState = 'closed'; this.onclose?.() }
}

class FakeNativePeerConnection implements BrowserRtcPeerConnectionLike {
  static configurations: unknown[] = []
  iceGatheringState = 'complete'
  connectionState = 'new'
  localDescription: BrowserRtcSessionDescriptionInit | null = null
  remoteDescription: BrowserRtcSessionDescriptionInit | null = null
  onicegatheringstatechange: (() => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  ondatachannel: ((event: { channel: BrowserRtcDataChannelLike }) => void) | null = null
  readonly channel = new FakeDataChannel()
  closed = false

  constructor(configuration?: unknown) {
    FakeNativePeerConnection.configurations.push(configuration)
    // Mimic react-native-webrtc sanitizing/mutating its received ICE config.
    const first = (configuration as { iceServers?: Array<{ urls?: string | string[] }> } | undefined)?.iceServers?.[0]
    if (first) first.urls = ['mutated-by-native']
  }

  createDataChannel(): BrowserRtcDataChannelLike { return this.channel }
  async createOffer(): Promise<BrowserRtcSessionDescriptionInit> { return { type: 'offer', sdp: 'native-offer' } }
  async createAnswer(): Promise<BrowserRtcSessionDescriptionInit> { return { type: 'answer', sdp: 'native-answer' } }
  async setLocalDescription(description: BrowserRtcSessionDescriptionInit): Promise<void> { this.localDescription = { ...description } }
  async setRemoteDescription(description: BrowserRtcSessionDescriptionInit): Promise<void> { this.remoteDescription = { ...description } }
  close(): void { this.closed = true; this.connectionState = 'closed' }
}

function nativeModule(): ReactNativeWebRtcModuleLike {
  return { RTCPeerConnection: FakeNativePeerConnection }
}

test('adapts react-native-webrtc constructor and protects shared ICE configuration from native mutation', () => {
  FakeNativePeerConnection.configurations = []
  const source = [{ urls: ['stun:one.example:3478', 'stun:two.example:3478'], username: 'u', credential: 'p' }]
  const factory = createReactNativeWebRtcPeerConnectionFactory(nativeModule())

  const connection = factory({ iceServers: source })
  assert.ok(connection instanceof FakeNativePeerConnection)
  assert.deepEqual(source, [{ urls: ['stun:one.example:3478', 'stun:two.example:3478'], username: 'u', credential: 'p' }])
  assert.deepEqual(FakeNativePeerConnection.configurations[0], {
    iceServers: [{ urls: ['mutated-by-native'], username: 'u', credential: 'p' }],
  })
})

test('reuses the tested auction negotiator contract on native host and participant roles', async () => {
  const host = createNativeAuctionRtcNegotiator({
    role: 'host',
    peerId: 'alice-device',
    email: 'alice@example.com',
    webRtcModule: nativeModule(),
  })
  assert.deepEqual(await host.createOffer(), { type: 'offer', sdp: 'native-offer' })
  await host.acceptAnswer({ type: 'answer', sdp: 'participant-answer' })

  const participant = createNativeAuctionRtcNegotiator({
    role: 'participant',
    peerId: 'alice-device',
    email: 'alice@example.com',
    webRtcModule: nativeModule(),
  })
  assert.deepEqual(
    await participant.acceptOffer({ type: 'offer', sdp: 'host-offer' }),
    { type: 'answer', sdp: 'native-answer' },
  )
})

test('builds the dynamic coordinator factory without importing a native module in web or CI', async () => {
  const factory = createNativeAuctionBrowserNegotiatorFactory(nativeModule())
  const host = factory({ role: 'host', peerId: 'bob-device', email: 'bob@example.com' })
  assert.deepEqual(await host.createOffer(), { type: 'offer', sdp: 'native-offer' })
})

test('rejects a missing native RTCPeerConnection implementation explicitly', () => {
  assert.throws(
    () => createReactNativeWebRtcPeerConnectionFactory({} as ReactNativeWebRtcModuleLike),
    /RTCPeerConnection is not available/i,
  )
})
