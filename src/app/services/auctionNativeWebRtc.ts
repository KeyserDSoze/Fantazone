import {
  BrowserAuctionRtcNegotiator,
  type BrowserAuctionRtcOptions,
  type BrowserRtcIceServer,
  type BrowserRtcPeerConnectionFactory,
  type BrowserRtcPeerConnectionLike,
} from './auctionBrowserWebRtc'
import type { AuctionRtcNegotiator, AuctionRtcNegotiatorFactory } from './auctionWebRtcSignaling'

/**
 * Structural subset exported by `react-native-webrtc` that Fantazone needs.
 * Keeping this boundary structural means CI and the web bundle do not need to load
 * the native module. The real package is injected by the native entry point/dev build.
 */
export type ReactNativeWebRtcModuleLike = {
  RTCPeerConnection: new (configuration?: {
    iceServers?: Array<{
      urls?: string | string[]
      url?: string
      username?: string
      credential?: string
    }>
  }) => BrowserRtcPeerConnectionLike
}

export type NativeAuctionRtcOptions = Omit<BrowserAuctionRtcOptions, 'peerConnectionFactory'> & {
  webRtcModule: ReactNativeWebRtcModuleLike
}

/**
 * Adapts react-native-webrtc's RTCPeerConnection constructor to the exact structural
 * contract already exercised by BrowserAuctionRtcNegotiator. The upstream native
 * constructor sanitizes/mutates its ICE configuration, so clone every server first.
 */
export function createReactNativeWebRtcPeerConnectionFactory(
  webRtcModule: ReactNativeWebRtcModuleLike,
): BrowserRtcPeerConnectionFactory {
  assertWebRtcModule(webRtcModule)
  return configuration => new webRtcModule.RTCPeerConnection({
    iceServers: cloneIceServers(configuration.iceServers),
  })
}

/**
 * Native iOS/Android negotiator. Signaling, non-trickle ICE, DataChannel text bridge,
 * connection-state callbacks and reconnect orchestration are shared with the web
 * implementation instead of being reimplemented per platform.
 */
export function createNativeAuctionRtcNegotiator(options: NativeAuctionRtcOptions): AuctionRtcNegotiator {
  const { webRtcModule, ...rtcOptions } = options
  return new BrowserAuctionRtcNegotiator({
    ...rtcOptions,
    peerConnectionFactory: createReactNativeWebRtcPeerConnectionFactory(webRtcModule),
  })
}

/** Factory shape consumed directly by the host/participant signaling coordinators. */
export function createNativeAuctionRtcNegotiatorFactory(
  webRtcModule: ReactNativeWebRtcModuleLike,
): AuctionRtcNegotiatorFactory {
  const peerConnectionFactory = createReactNativeWebRtcPeerConnectionFactory(webRtcModule)
  return peer => new BrowserAuctionRtcNegotiator({
    role: 'host',
    peerId: peer.peerId,
    email: peer.email,
    peerConnectionFactory,
  })
}

/**
 * Lower-level factory for BrowserAuctionHost/ParticipantConnectionCoordinator, which
 * supplies role, callbacks and ICE options dynamically for every peer generation.
 */
export function createNativeAuctionBrowserNegotiatorFactory(
  webRtcModule: ReactNativeWebRtcModuleLike,
): (options: BrowserAuctionRtcOptions) => AuctionRtcNegotiator {
  const peerConnectionFactory = createReactNativeWebRtcPeerConnectionFactory(webRtcModule)
  return options => new BrowserAuctionRtcNegotiator({ ...options, peerConnectionFactory })
}

function cloneIceServers(servers: readonly BrowserRtcIceServer[]): Array<{
  urls: string | string[]
  username?: string
  credential?: string
}> {
  return servers.map(server => ({
    urls: Array.isArray(server.urls) ? [...server.urls] : server.urls,
    ...(server.username === undefined ? {} : { username: server.username }),
    ...(server.credential === undefined ? {} : { credential: server.credential }),
  }))
}

function assertWebRtcModule(value: ReactNativeWebRtcModuleLike): void {
  if (!value || typeof value.RTCPeerConnection !== 'function') {
    throw new Error('react-native-webrtc RTCPeerConnection is not available')
  }
}
