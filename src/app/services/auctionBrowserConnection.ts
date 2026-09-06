import type { AuctionCheckpoint, AuctionCommand, AuctionSignalingPeer, AuctionSignalingRoom } from '@fantazone/domain'
import { GitHubAuctionSignalingRepository } from '@fantazone/github'
import {
  BrowserAuctionRtcNegotiator,
  type BrowserAuctionRtcCallbacks,
  type BrowserAuctionRtcOptions,
  type BrowserAuctionRealtimePeer,
  type BrowserRtcIceServer,
  type BrowserRtcPeerConnectionFactory,
} from './auctionBrowserWebRtc'
import {
  GroupAuctionRealtimePeerController,
  type AuctionRealtimePeerCallbacks,
  type AuctionRealtimeTextPeer,
  type GroupAuctionRealtimeHostController,
} from './auctionRealtimeSession'
import {
  AuctionWebRtcHostSignalingController,
  AuctionWebRtcParticipantSignalingController,
  type AuctionRtcNegotiator,
} from './auctionWebRtcSignaling'

export const DEFAULT_AUCTION_SIGNALING_POLL_INTERVAL_MS = 5_000
export const DEFAULT_AUCTION_DISCONNECT_GRACE_MS = 5_000

type BrowserNegotiatorFactory = (options: BrowserAuctionRtcOptions) => AuctionRtcNegotiator

type RealtimeHostBoundary = Pick<
  GroupAuctionRealtimeHostController,
  'attachPeer' | 'detachPeer' | 'receivePeerText' | 'close'
>

export type BrowserAuctionConnectionCallbacks = {
  onOpen?: (peerId: string) => void
  onClose?: (peerId: string) => void
  onConnectionState?: (peerId: string, state: string) => void
  onError?: (error: Error) => void
}

type SharedBrowserRtcOptions = {
  iceServers?: readonly BrowserRtcIceServer[]
  iceGatheringTimeoutMs?: number
  dataChannelLabel?: string
  peerConnectionFactory?: BrowserRtcPeerConnectionFactory
  negotiatorFactory?: BrowserNegotiatorFactory
  signalingPollIntervalMs?: number
}

export type BrowserAuctionHostConnectionOptions = SharedBrowserRtcOptions & {
  repository: GitHubAuctionSignalingRepository
  room: AuctionSignalingRoom
  realtime: RealtimeHostBoundary
  callbacks?: BrowserAuctionConnectionCallbacks
}

/**
 * Browser host wiring: GitHub discovers peers, RTCPeerConnection establishes one
 * ordered DataChannel, and the channel is attached to the authoritative realtime
 * host controller. GitHub remains only the slow rendezvous path.
 */
export class BrowserAuctionHostConnectionCoordinator {
  private readonly signaling: AuctionWebRtcHostSignalingController
  private readonly callbacks: BrowserAuctionConnectionCallbacks
  private readonly pollIntervalMs: number
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private pollPromise: Promise<void> | null = null
  private closed = false

  constructor(private readonly options: BrowserAuctionHostConnectionOptions) {
    this.callbacks = options.callbacks ?? {}
    this.pollIntervalMs = validateInterval(
      options.signalingPollIntervalMs ?? DEFAULT_AUCTION_SIGNALING_POLL_INTERVAL_MS,
      'Signaling poll interval',
    )
    const factory = options.negotiatorFactory ?? (value => new BrowserAuctionRtcNegotiator(value))
    this.signaling = new AuctionWebRtcHostSignalingController(
      options.repository,
      options.room,
      peer => factory(this.hostRtcOptions(peer)),
    )
  }

  async start(): Promise<void> {
    this.assertOpen()
    await this.signaling.start()
    this.ensurePolling()
    await this.pollNow()
  }

  async pollNow(): Promise<void> {
    this.assertOpen()
    if (this.pollPromise) return this.pollPromise
    this.pollPromise = this.signaling.poll()
      .then(() => undefined)
      .catch(error => {
        this.reportError(error)
        throw error
      })
      .finally(() => {
        this.pollPromise = null
      })
    return this.pollPromise
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.stopPolling()
    this.signaling.close()
    this.options.realtime.close()
  }

  private hostRtcOptions(peer: AuctionSignalingPeer): BrowserAuctionRtcOptions {
    return {
      role: 'host',
      peerId: peer.peerId,
      email: peer.email,
      iceServers: this.options.iceServers,
      iceGatheringTimeoutMs: this.options.iceGatheringTimeoutMs,
      dataChannelLabel: this.options.dataChannelLabel,
      peerConnectionFactory: this.options.peerConnectionFactory,
      callbacks: {
        onPeerReady: realtimePeer => this.options.realtime.attachPeer(realtimePeer),
        onOpen: realtimePeer => this.callbacks.onOpen?.(realtimePeer.peerId),
        onClose: realtimePeer => {
          this.options.realtime.detachPeer(realtimePeer.peerId)
          this.callbacks.onClose?.(realtimePeer.peerId)
        },
        onText: (realtimePeer, text) => {
          void this.options.realtime.receivePeerText(realtimePeer.peerId, text).catch(error => this.reportError(error))
        },
        onConnectionState: state => this.callbacks.onConnectionState?.(peer.peerId, state),
        onError: error => this.reportError(error),
      },
    }
  }

  private ensurePolling(): void {
    if (this.closed || this.pollTimer) return
    this.pollTimer = setInterval(() => {
      void this.pollNow().catch(() => undefined)
    }, this.pollIntervalMs)
  }

  private stopPolling(): void {
    if (!this.pollTimer) return
    clearInterval(this.pollTimer)
    this.pollTimer = null
  }

  private reportError(error: unknown): void {
    this.callbacks.onError?.(asError(error))
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Browser auction host connection coordinator is closed')
  }
}

export type BrowserAuctionParticipantConnectionOptions = SharedBrowserRtcOptions & {
  repository: GitHubAuctionSignalingRepository
  room: AuctionSignalingRoom
  peer: { peerId: string; email: string }
  auctionId: string
  checkpoint?: AuctionCheckpoint
  realtimeCallbacks?: AuctionRealtimePeerCallbacks
  callbacks?: BrowserAuctionConnectionCallbacks
  disconnectGraceMs?: number
  now?: () => Date
}

/**
 * Browser participant wiring with reconnect generation. Signaling polling stops once
 * the DataChannel opens. A failed connection immediately restarts; a transient
 * disconnected state gets a grace period. Every reopened channel asks the host for
 * a canonical checkpoint before continuing.
 */
export class BrowserAuctionParticipantConnectionCoordinator {
  private readonly callbacks: BrowserAuctionConnectionCallbacks
  private readonly pollIntervalMs: number
  private readonly disconnectGraceMs: number
  private readonly signaling: AuctionWebRtcParticipantSignalingController
  private readonly negotiatorFactory: BrowserNegotiatorFactory
  private currentNegotiator: AuctionRtcNegotiator
  private realtime: GroupAuctionRealtimePeerController | null = null
  private latestCheckpoint: AuctionCheckpoint | undefined
  private currentTransport: AuctionRealtimeTextPeer | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pollPromise: Promise<void> | null = null
  private restartPromise: Promise<number> | null = null
  private closed = false

  constructor(private readonly options: BrowserAuctionParticipantConnectionOptions) {
    this.callbacks = options.callbacks ?? {}
    this.pollIntervalMs = validateInterval(
      options.signalingPollIntervalMs ?? DEFAULT_AUCTION_SIGNALING_POLL_INTERVAL_MS,
      'Signaling poll interval',
    )
    this.disconnectGraceMs = validateInterval(
      options.disconnectGraceMs ?? DEFAULT_AUCTION_DISCONNECT_GRACE_MS,
      'Disconnect grace',
    )
    this.latestCheckpoint = options.checkpoint ? cloneJson(options.checkpoint) : undefined
    this.negotiatorFactory = options.negotiatorFactory ?? (value => new BrowserAuctionRtcNegotiator(value))
    this.currentNegotiator = this.createNegotiator()
    this.signaling = new AuctionWebRtcParticipantSignalingController(
      options.repository,
      options.room,
      options.peer,
      this.currentNegotiator,
      options.now,
    )
  }

  get generation(): number {
    return this.signaling.generation
  }

  get connected(): boolean {
    return Boolean(this.currentTransport && transportReadyState(this.currentTransport) === 'open')
  }

  async start(): Promise<void> {
    this.assertOpen()
    await this.signaling.join()
    this.ensurePolling()
    await this.pollNow()
  }

  async pollNow(): Promise<void> {
    this.assertOpen()
    if (this.pollPromise) return this.pollPromise
    this.pollPromise = this.signaling.poll()
      .then(() => undefined)
      .catch(error => {
        this.reportError(error)
        throw error
      })
      .finally(() => {
        this.pollPromise = null
      })
    return this.pollPromise
  }

  sendCommand(command: AuctionCommand): void {
    this.assertOpen()
    if (!this.realtime || !this.connected) throw new Error('Auction realtime channel is not connected')
    this.realtime.sendCommand(command)
  }

  async restartNow(): Promise<number> {
    this.assertOpen()
    if (this.restartPromise) return this.restartPromise
    this.restartPromise = this.performRestart().finally(() => {
      this.restartPromise = null
    })
    return this.restartPromise
  }

  async waitForReconnect(): Promise<void> {
    await this.restartPromise
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.stopPolling()
    this.clearDisconnectTimer()
    this.signaling.close()
    const transport = this.currentTransport
    this.currentTransport = null
    this.realtime = null
    transport?.close?.()
  }

  private async performRestart(): Promise<number> {
    this.clearDisconnectTimer()
    const previousTransport = this.currentTransport
    this.currentTransport = null
    this.realtime = null
    previousTransport?.close?.()
    const next = this.createNegotiator()
    this.currentNegotiator = next
    const generation = await this.signaling.restart(next)
    this.ensurePolling()
    await this.pollNow()
    return generation
  }

  private createNegotiator(): AuctionRtcNegotiator {
    return this.negotiatorFactory({
      role: 'participant',
      peerId: this.options.peer.peerId,
      email: this.options.peer.email,
      iceServers: this.options.iceServers,
      iceGatheringTimeoutMs: this.options.iceGatheringTimeoutMs,
      dataChannelLabel: this.options.dataChannelLabel,
      peerConnectionFactory: this.options.peerConnectionFactory,
      callbacks: this.participantRtcCallbacks(),
    })
  }

  private participantRtcCallbacks(): BrowserAuctionRtcCallbacks {
    return {
      onPeerReady: peer => {
        this.currentTransport = peer
        const realtimeCallbacks: AuctionRealtimePeerCallbacks = {
          ...this.options.realtimeCallbacks,
          onCheckpoint: checkpoint => {
            this.latestCheckpoint = cloneJson(checkpoint)
            this.options.realtimeCallbacks?.onCheckpoint?.(cloneJson(checkpoint))
          },
        }
        this.realtime = new GroupAuctionRealtimePeerController(
          this.options.auctionId,
          peer,
          realtimeCallbacks,
          this.latestCheckpoint,
        )
      },
      onOpen: peer => {
        if (this.currentTransport !== peer || !this.realtime) return
        this.clearDisconnectTimer()
        this.stopPolling()
        this.realtime.requestCheckpoint()
        this.callbacks.onOpen?.(peer.peerId)
      },
      onClose: peer => {
        if (this.currentTransport !== peer || this.closed) return
        this.callbacks.onClose?.(peer.peerId)
        this.scheduleReconnect()
      },
      onText: (peer, text) => {
        if (this.currentTransport !== peer || !this.realtime) return
        try {
          this.realtime.receiveText(text)
        } catch (error) {
          this.reportError(error)
        }
      },
      onConnectionState: state => {
        this.callbacks.onConnectionState?.(this.options.peer.peerId, state)
        this.handleConnectionState(state)
      },
      onError: error => this.reportError(error),
    }
  }

  private handleConnectionState(state: string): void {
    if (this.closed) return
    switch (state) {
      case 'connected':
        this.clearDisconnectTimer()
        return
      case 'failed':
        this.clearDisconnectTimer()
        void this.restartNow().catch(error => this.reportError(error))
        return
      case 'disconnected':
        this.scheduleReconnect()
        return
      case 'closed':
        return
      default:
        return
    }
  }

  private scheduleReconnect(): void {
    if (this.closed || this.restartPromise || this.disconnectTimer) return
    this.disconnectTimer = setTimeout(() => {
      this.disconnectTimer = null
      void this.restartNow().catch(error => this.reportError(error))
    }, this.disconnectGraceMs)
  }

  private ensurePolling(): void {
    if (this.closed || this.pollTimer) return
    this.pollTimer = setInterval(() => {
      void this.pollNow().catch(() => undefined)
    }, this.pollIntervalMs)
  }

  private stopPolling(): void {
    if (!this.pollTimer) return
    clearInterval(this.pollTimer)
    this.pollTimer = null
  }

  private clearDisconnectTimer(): void {
    if (!this.disconnectTimer) return
    clearTimeout(this.disconnectTimer)
    this.disconnectTimer = null
  }

  private reportError(error: unknown): void {
    this.callbacks.onError?.(asError(error))
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Browser auction participant connection coordinator is closed')
  }
}

function validateInterval(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive`)
  return value
}

function transportReadyState(peer: AuctionRealtimeTextPeer): string {
  return (peer as BrowserAuctionRealtimePeer).readyState ?? 'open'
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
