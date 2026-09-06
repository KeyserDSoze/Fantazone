import type { AuctionSessionDescription } from '@fantazone/domain'
import type { AuctionRealtimeTextPeer } from './auctionRealtimeSession'
import type { AuctionRtcNegotiator } from './auctionWebRtcSignaling'

export const AUCTION_DATA_CHANNEL_LABEL = 'fantazone-auction-v1'
export const DEFAULT_AUCTION_ICE_GATHERING_TIMEOUT_MS = 15_000

export const DEFAULT_AUCTION_ICE_SERVERS: readonly BrowserRtcIceServer[] = [
  { urls: ['stun:stun.cloudflare.com:3478'] },
]

export type BrowserRtcIceServer = {
  urls: string | string[]
  username?: string
  credential?: string
}

export type BrowserRtcSessionDescriptionInit = {
  type: 'offer' | 'answer'
  sdp: string
}

export type BrowserRtcDataChannelMessageEvent = {
  data: unknown
}

export type BrowserRtcDataChannelEvent = {
  channel: BrowserRtcDataChannelLike
}

export interface BrowserRtcDataChannelLike {
  readonly label?: string
  readonly readyState: string
  send(data: string): void
  close(): void
  onopen?: (() => void) | null
  onclose?: (() => void) | null
  onerror?: ((event?: unknown) => void) | null
  onmessage?: ((event: BrowserRtcDataChannelMessageEvent) => void) | null
}

export interface BrowserRtcPeerConnectionLike {
  readonly iceGatheringState: string
  readonly connectionState?: string
  readonly localDescription: BrowserRtcSessionDescriptionInit | null
  createDataChannel(label: string, options?: { ordered?: boolean }): BrowserRtcDataChannelLike
  createOffer(): Promise<BrowserRtcSessionDescriptionInit>
  createAnswer(): Promise<BrowserRtcSessionDescriptionInit>
  setLocalDescription(description: BrowserRtcSessionDescriptionInit): Promise<void>
  setRemoteDescription(description: BrowserRtcSessionDescriptionInit): Promise<void>
  close(): void
  onicegatheringstatechange?: (() => void) | null
  onconnectionstatechange?: (() => void) | null
  ondatachannel?: ((event: BrowserRtcDataChannelEvent) => void) | null
  addEventListener?(type: 'icegatheringstatechange', listener: () => void): void
  removeEventListener?(type: 'icegatheringstatechange', listener: () => void): void
}

export type BrowserRtcPeerConnectionFactory = (configuration: {
  iceServers: readonly BrowserRtcIceServer[]
}) => BrowserRtcPeerConnectionLike

export type BrowserAuctionRtcRole = 'host' | 'participant'

export type BrowserAuctionRtcCallbacks = {
  onPeerReady?: (peer: BrowserAuctionRealtimePeer) => void
  onOpen?: (peer: BrowserAuctionRealtimePeer) => void
  onClose?: (peer: BrowserAuctionRealtimePeer) => void
  onText?: (peer: BrowserAuctionRealtimePeer, text: string) => void
  onConnectionState?: (state: string) => void
  onError?: (error: Error) => void
}

export type BrowserAuctionRtcOptions = {
  role: BrowserAuctionRtcRole
  peerId: string
  email: string
  iceServers?: readonly BrowserRtcIceServer[]
  iceGatheringTimeoutMs?: number
  dataChannelLabel?: string
  peerConnectionFactory?: BrowserRtcPeerConnectionFactory
  callbacks?: BrowserAuctionRtcCallbacks
}

/**
 * Concrete browser RTCPeerConnection adapter for the transport-agnostic auction
 * signaling controller. It deliberately publishes only complete, non-trickle SDP:
 * GitHub is the slow rendezvous, not an ICE-candidate message bus.
 */
export class BrowserAuctionRtcNegotiator implements AuctionRtcNegotiator {
  private readonly connection: BrowserRtcPeerConnectionLike
  private readonly timeoutMs: number
  private readonly channelLabel: string
  private readonly callbacks: BrowserAuctionRtcCallbacks
  private peer: BrowserAuctionRealtimePeer | null = null
  private closed = false

  constructor(private readonly options: BrowserAuctionRtcOptions) {
    const peerId = required(options.peerId, 'Peer id')
    const email = normalizeEmail(options.email)
    if (!email.includes('@')) throw new Error('Peer email is not valid')
    if (options.role !== 'host' && options.role !== 'participant') throw new Error('Invalid browser auction RTC role')

    this.timeoutMs = options.iceGatheringTimeoutMs ?? DEFAULT_AUCTION_ICE_GATHERING_TIMEOUT_MS
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) throw new Error('ICE gathering timeout must be positive')
    this.channelLabel = required(options.dataChannelLabel ?? AUCTION_DATA_CHANNEL_LABEL, 'DataChannel label')
    this.callbacks = options.callbacks ?? {}
    const factory = options.peerConnectionFactory ?? defaultBrowserPeerConnectionFactory
    this.connection = factory({ iceServers: options.iceServers ?? DEFAULT_AUCTION_ICE_SERVERS })

    const previousConnectionStateHandler = this.connection.onconnectionstatechange ?? null
    this.connection.onconnectionstatechange = () => {
      previousConnectionStateHandler?.()
      this.callbacks.onConnectionState?.(this.connection.connectionState ?? 'unknown')
    }

    if (options.role === 'host') {
      this.attachDataChannel(this.connection.createDataChannel(this.channelLabel, { ordered: true }), peerId, email)
    } else {
      this.connection.ondatachannel = event => {
        if (event.channel.label && event.channel.label !== this.channelLabel) {
          event.channel.close()
          return
        }
        this.attachDataChannel(event.channel, peerId, email)
      }
    }
  }

  get realtimePeer(): BrowserAuctionRealtimePeer | null {
    return this.peer
  }

  get connectionState(): string {
    return this.connection.connectionState ?? 'unknown'
  }

  async createOffer(): Promise<AuctionSessionDescription> {
    this.assertOpen()
    if (this.options.role !== 'host') throw new Error('Only host RTC negotiators create offers')
    const offer = normalizeDescription(await this.connection.createOffer(), 'offer')
    await this.connection.setLocalDescription(offer)
    return this.completeLocalDescription('offer')
  }

  async acceptOffer(offer: AuctionSessionDescription): Promise<AuctionSessionDescription> {
    this.assertOpen()
    if (this.options.role !== 'participant') throw new Error('Only participant RTC negotiators accept offers')
    const remote = normalizeDescription(offer, 'offer')
    await this.connection.setRemoteDescription(remote)
    const answer = normalizeDescription(await this.connection.createAnswer(), 'answer')
    await this.connection.setLocalDescription(answer)
    return this.completeLocalDescription('answer')
  }

  async acceptAnswer(answer: AuctionSessionDescription): Promise<void> {
    this.assertOpen()
    if (this.options.role !== 'host') throw new Error('Only host RTC negotiators accept answers')
    await this.connection.setRemoteDescription(normalizeDescription(answer, 'answer'))
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.peer?.close()
    this.connection.close()
  }

  private async completeLocalDescription(expectedType: 'offer' | 'answer'): Promise<AuctionSessionDescription> {
    await waitForIceGatheringComplete(this.connection, this.timeoutMs)
    const description = this.connection.localDescription
    if (!description) throw new Error('RTCPeerConnection has no local description after ICE gathering')
    return normalizeDescription(description, expectedType)
  }

  private attachDataChannel(channel: BrowserRtcDataChannelLike, peerId: string, email: string): void {
    if (this.closed) {
      channel.close()
      return
    }
    if (this.peer) {
      channel.close()
      return
    }
    const peer = new BrowserAuctionRealtimePeer(peerId, email, channel, this.callbacks)
    this.peer = peer
    this.callbacks.onPeerReady?.(peer)
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Browser auction RTC negotiator is closed')
  }
}

/** Text bridge consumed directly by GroupAuctionRealtimeHost/PeerController. */
export class BrowserAuctionRealtimePeer implements AuctionRealtimeTextPeer {
  private readonly textListeners = new Set<(text: string) => void>()
  private readonly openListeners = new Set<() => void>()
  private readonly closeListeners = new Set<() => void>()
  private closed = false

  constructor(
    readonly peerId: string,
    readonly email: string,
    private readonly channel: BrowserRtcDataChannelLike,
    callbacks: BrowserAuctionRtcCallbacks = {},
  ) {
    channel.onmessage = event => {
      if (typeof event.data !== 'string') {
        callbacks.onError?.(new Error('Auction DataChannel received a non-text message'))
        return
      }
      callbacks.onText?.(this, event.data)
      for (const listener of this.textListeners) listener(event.data)
    }
    channel.onopen = () => {
      callbacks.onOpen?.(this)
      for (const listener of this.openListeners) listener()
    }
    channel.onclose = () => {
      this.closed = true
      callbacks.onClose?.(this)
      for (const listener of this.closeListeners) listener()
    }
    channel.onerror = event => callbacks.onError?.(new Error('Auction DataChannel error', { cause: event }))
  }

  get readyState(): string {
    return this.channel.readyState
  }

  sendText(text: string): void {
    if (this.closed || this.channel.readyState !== 'open') {
      throw new Error(`Auction DataChannel is not open (${this.channel.readyState})`)
    }
    this.channel.send(text)
  }

  onText(listener: (text: string) => void): () => void {
    this.textListeners.add(listener)
    return () => this.textListeners.delete(listener)
  }

  onOpen(listener: () => void): () => void {
    this.openListeners.add(listener)
    return () => this.openListeners.delete(listener)
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener)
    return () => this.closeListeners.delete(listener)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.channel.close()
  }
}

export async function waitForIceGatheringComplete(
  connection: BrowserRtcPeerConnectionLike,
  timeoutMs = DEFAULT_AUCTION_ICE_GATHERING_TIMEOUT_MS,
): Promise<void> {
  if (connection.iceGatheringState === 'complete') return
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('ICE gathering timeout must be positive')

  await new Promise<void>((resolve, reject) => {
    let settled = false
    const previousHandler = connection.onicegatheringstatechange ?? null

    const cleanup = () => {
      if (connection.removeEventListener && connection.addEventListener) {
        connection.removeEventListener('icegatheringstatechange', handleChange)
      } else if (connection.onicegatheringstatechange === handleChange) {
        connection.onicegatheringstatechange = previousHandler
      }
      clearTimeout(timer)
    }
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      cleanup()
      error ? reject(error) : resolve()
    }
    const handleChange = () => {
      previousHandler?.()
      if (connection.iceGatheringState === 'complete') finish()
    }
    const timer = setTimeout(
      () => finish(new Error(`WebRTC ICE gathering did not complete within ${timeoutMs} ms`)),
      timeoutMs,
    )

    if (connection.addEventListener && connection.removeEventListener) {
      connection.addEventListener('icegatheringstatechange', handleChange)
    } else {
      connection.onicegatheringstatechange = handleChange
    }

    if (connection.iceGatheringState === 'complete') finish()
  })
}

export function isBrowserWebRtcAvailable(): boolean {
  return typeof (globalThis as Record<string, unknown>).RTCPeerConnection === 'function'
}

function defaultBrowserPeerConnectionFactory(configuration: {
  iceServers: readonly BrowserRtcIceServer[]
}): BrowserRtcPeerConnectionLike {
  const constructor = (globalThis as Record<string, unknown>).RTCPeerConnection as
    | (new (configuration: { iceServers: readonly BrowserRtcIceServer[] }) => BrowserRtcPeerConnectionLike)
    | undefined
  if (typeof constructor !== 'function') throw new Error('RTCPeerConnection is not available in this runtime')
  return new constructor(configuration)
}

function normalizeDescription(
  description: AuctionSessionDescription | BrowserRtcSessionDescriptionInit,
  expectedType: 'offer' | 'answer',
): BrowserRtcSessionDescriptionInit {
  if (description.type !== expectedType) throw new Error(`Expected RTC ${expectedType}, found ${description.type}`)
  const sdp = required(description.sdp, 'SDP')
  return { type: expectedType, sdp }
}

function required(value: string, label: string): string {
  const normalized = value?.trim()
  if (!normalized) throw new Error(`${label} is required`)
  return normalized
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}
