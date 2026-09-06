import type { AuctionCheckpoint } from '@fantazone/domain'
import type { GitHubAuctionSignalingRepository } from '@fantazone/github'
import {
  BrowserAuctionRtcNegotiator,
  type BrowserAuctionRtcOptions,
} from './auctionBrowserWebRtc'
import {
  GroupAuctionRealtimePeerController,
  type AuctionRealtimePeerCallbacks,
} from './auctionRealtimeSession'
import { AuctionWebRtcParticipantSignalingController } from './auctionWebRtcSignaling'

export const DEFAULT_AUCTION_DISCONNECTED_GRACE_MS = 5_000

export type AuctionBrowserParticipantConnectionStatus =
  | 'idle'
  | 'signaling'
  | 'connected'
  | 'reconnecting'
  | 'closed'

export type AuctionBrowserParticipantSessionCallbacks = AuctionRealtimePeerCallbacks & {
  onStatus?: (status: AuctionBrowserParticipantConnectionStatus) => void
  onError?: (error: Error) => void
}

export type AuctionBrowserParticipantSessionOptions = {
  repository: GitHubAuctionSignalingRepository
  room: ConstructorParameters<typeof AuctionWebRtcParticipantSignalingController>[1]
  peerId: string
  email: string
  checkpoint?: AuctionCheckpoint
  rtc?: Omit<BrowserAuctionRtcOptions, 'role' | 'peerId' | 'email' | 'callbacks'>
  disconnectedGraceMs?: number
  callbacks?: AuctionBrowserParticipantSessionCallbacks
  now?: () => Date
  setTimeoutFn?: (callback: () => void, delayMs: number) => unknown
  clearTimeoutFn?: (handle: unknown) => void
}

/**
 * Browser participant lifecycle coordinator.
 *
 * GitHub is polled only while negotiating/reconnecting. Once a DataChannel opens,
 * realtime messages flow peer-to-peer. A failed connection restarts immediately;
 * a transient disconnected state gets a short grace period first. Reconnection keeps
 * the same peer id, increments its signaling generation, and requests an authoritative
 * checkpoint as soon as the replacement DataChannel opens.
 */
export class AuctionBrowserParticipantSession {
  private readonly callbacks: AuctionBrowserParticipantSessionCallbacks
  private readonly disconnectedGraceMs: number
  private readonly setTimeoutFn: (callback: () => void, delayMs: number) => unknown
  private readonly clearTimeoutFn: (handle: unknown) => void
  private readonly now: () => Date
  private signaling: AuctionWebRtcParticipantSignalingController
  private negotiator: BrowserAuctionRtcNegotiator
  private realtime: GroupAuctionRealtimePeerController | null = null
  private detachText: (() => void) | null = null
  private detachOpen: (() => void) | null = null
  private disconnectTimer: unknown | null = null
  private restartPromise: Promise<void> | null = null
  private status: AuctionBrowserParticipantConnectionStatus = 'idle'
  private closed = false

  constructor(private readonly options: AuctionBrowserParticipantSessionOptions) {
    this.callbacks = options.callbacks ?? {}
    this.disconnectedGraceMs = options.disconnectedGraceMs ?? DEFAULT_AUCTION_DISCONNECTED_GRACE_MS
    if (!Number.isFinite(this.disconnectedGraceMs) || this.disconnectedGraceMs < 0) {
      throw new Error('Auction disconnected grace must be a non-negative number')
    }
    this.setTimeoutFn = options.setTimeoutFn ?? ((callback, delayMs) => setTimeout(callback, delayMs))
    this.clearTimeoutFn = options.clearTimeoutFn ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>))
    this.now = options.now ?? (() => new Date())

    this.negotiator = this.createNegotiator()
    this.signaling = new AuctionWebRtcParticipantSignalingController(
      options.repository,
      options.room,
      { peerId: options.peerId, email: options.email },
      this.negotiator,
      this.now,
    )
  }

  get connectionStatus(): AuctionBrowserParticipantConnectionStatus {
    return this.status
  }

  get generation(): number {
    return this.signaling.generation
  }

  get realtimeController(): GroupAuctionRealtimePeerController | null {
    return this.realtime
  }

  async start(): Promise<void> {
    this.assertOpen()
    this.setStatus('signaling')
    await this.signaling.join()
    await this.signaling.poll()
  }

  /** Poll GitHub only while waiting for an offer/answer or during recovery. */
  async pollSignaling(): Promise<void> {
    this.assertOpen()
    await this.signaling.poll()
  }

  async restartNow(): Promise<void> {
    this.assertOpen()
    if (this.restartPromise) return this.restartPromise
    this.restartPromise = this.performRestart().finally(() => {
      this.restartPromise = null
    })
    return this.restartPromise
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.clearDisconnectTimer()
    this.detachRealtimePeer()
    this.signaling.close()
    this.setStatus('closed')
  }

  private createNegotiator(): BrowserAuctionRtcNegotiator {
    return new BrowserAuctionRtcNegotiator({
      ...(this.options.rtc ?? {}),
      role: 'participant',
      peerId: this.options.peerId,
      email: this.options.email,
      callbacks: {
        onPeerReady: peer => this.attachRealtimePeer(peer),
        onConnectionState: state => this.handleConnectionState(state),
        onError: error => this.callbacks.onError?.(error),
      },
    })
  }

  private attachRealtimePeer(peer: NonNullable<BrowserAuctionRtcNegotiator['realtimePeer']>): void {
    this.detachRealtimePeer()
    const realtime = new GroupAuctionRealtimePeerController(
      this.options.room.auctionId,
      peer,
      this.callbacks,
      this.options.checkpoint,
    )
    this.realtime = realtime
    this.detachText = peer.onText(text => {
      try {
        realtime.receiveText(text)
      } catch (error) {
        this.callbacks.onError?.(toError(error))
      }
    })
    this.detachOpen = peer.onOpen(() => {
      this.clearDisconnectTimer()
      this.setStatus('connected')
      try {
        realtime.requestCheckpoint()
      } catch (error) {
        this.callbacks.onError?.(toError(error))
      }
    })
  }

  private detachRealtimePeer(): void {
    this.detachText?.()
    this.detachOpen?.()
    this.detachText = null
    this.detachOpen = null
    this.realtime = null
  }

  private handleConnectionState(state: string): void {
    if (this.closed) return
    switch (state) {
      case 'connected':
        this.clearDisconnectTimer()
        this.setStatus('connected')
        return
      case 'failed':
        this.clearDisconnectTimer()
        void this.restartNow().catch(error => this.callbacks.onError?.(toError(error)))
        return
      case 'disconnected':
        if (this.disconnectTimer !== null) return
        this.disconnectTimer = this.setTimeoutFn(() => {
          this.disconnectTimer = null
          void this.restartNow().catch(error => this.callbacks.onError?.(toError(error)))
        }, this.disconnectedGraceMs)
        return
      case 'closed':
        if (!this.closed) void this.restartNow().catch(error => this.callbacks.onError?.(toError(error)))
        return
      default:
        return
    }
  }

  private async performRestart(): Promise<void> {
    this.clearDisconnectTimer()
    this.setStatus('reconnecting')
    this.detachRealtimePeer()
    const replacement = this.createNegotiator()
    await this.signaling.restart(replacement)
    this.negotiator = replacement
    await this.signaling.poll()
  }

  private clearDisconnectTimer(): void {
    if (this.disconnectTimer === null) return
    this.clearTimeoutFn(this.disconnectTimer)
    this.disconnectTimer = null
  }

  private setStatus(status: AuctionBrowserParticipantConnectionStatus): void {
    if (this.status === status) return
    this.status = status
    this.callbacks.onStatus?.(status)
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Auction browser participant session is closed')
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
