import type { AuctionSignalingPeer, AuctionSignalingRoom } from '@fantazone/domain'
import type { GitHubAuctionSignalingRepository } from '@fantazone/github'
import {
  BrowserAuctionRtcNegotiator,
  type BrowserAuctionRtcOptions,
} from './auctionBrowserWebRtc'
import { GroupAuctionRealtimeHostController } from './auctionRealtimeSession'
import {
  AuctionWebRtcHostSignalingController,
  type AuctionHostSignalingPollResult,
} from './auctionWebRtcSignaling'

export type AuctionBrowserHostSessionOptions = {
  repository: GitHubAuctionSignalingRepository
  room: AuctionSignalingRoom
  realtime: GroupAuctionRealtimeHostController
  rtc?: Omit<BrowserAuctionRtcOptions, 'role' | 'peerId' | 'email' | 'callbacks'>
  onError?: (error: Error) => void
}

/**
 * Browser host bridge from slow GitHub signaling to the authoritative realtime host.
 * One RTCPeerConnection is owned per signaling peer generation. DataChannels are
 * attached/detached automatically; bids and events never pass through GitHub.
 */
export class AuctionBrowserHostSession {
  private readonly signaling: AuctionWebRtcHostSignalingController
  private readonly detachByPeer = new Map<string, () => void>()
  private closed = false

  constructor(private readonly options: AuctionBrowserHostSessionOptions) {
    this.signaling = new AuctionWebRtcHostSignalingController(
      options.repository,
      options.room,
      peer => this.createNegotiator(peer),
    )
  }

  async start(): Promise<AuctionHostSignalingPollResult> {
    this.assertOpen()
    await this.signaling.start()
    return this.signaling.poll()
  }

  async pollSignaling(): Promise<AuctionHostSignalingPollResult> {
    this.assertOpen()
    return this.signaling.poll()
  }

  closePeer(peerId: string): void {
    this.detachByPeer.get(peerId)?.()
    this.detachByPeer.delete(peerId)
    this.options.realtime.detachPeer(peerId)
    this.signaling.closePeer(peerId)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const detach of this.detachByPeer.values()) detach()
    this.detachByPeer.clear()
    this.signaling.close()
  }

  private createNegotiator(peer: AuctionSignalingPeer): BrowserAuctionRtcNegotiator {
    return new BrowserAuctionRtcNegotiator({
      ...(this.options.rtc ?? {}),
      role: 'host',
      peerId: peer.peerId,
      email: peer.email,
      callbacks: {
        onPeerReady: realtimePeer => {
          this.detachByPeer.get(peer.peerId)?.()
          this.options.realtime.attachPeer(realtimePeer)
          const detachText = realtimePeer.onText(text => {
            void this.options.realtime.receivePeerText(peer.peerId, text).catch(error => {
              this.options.onError?.(toError(error))
            })
          })
          const detachClose = realtimePeer.onClose(() => {
            this.options.realtime.detachPeer(peer.peerId)
          })
          this.detachByPeer.set(peer.peerId, () => {
            detachText()
            detachClose()
            this.options.realtime.detachPeer(peer.peerId)
          })
        },
        onError: error => this.options.onError?.(error),
      },
    })
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Auction browser host session is closed')
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
