import {
  createAuctionSessionDescriptionSignal,
  type AuctionSessionDescription,
  type AuctionSignalingPeer,
  type AuctionSignalingRoom,
} from '@fantazone/domain'
import { GitHubAuctionSignalingRepository } from '@fantazone/github'

const PEER_HEARTBEAT_INTERVAL_MS = 30_000

export interface AuctionRtcNegotiator {
  /** Returns a complete non-trickle SDP offer after ICE gathering is finished. */
  createOffer(): Promise<AuctionSessionDescription>
  /** Applies a host offer and returns a complete non-trickle answer. */
  acceptOffer(offer: AuctionSessionDescription): Promise<AuctionSessionDescription>
  /** Applies the participant answer to the host-side peer connection. */
  acceptAnswer(answer: AuctionSessionDescription): Promise<void>
  close?(): void
}

export type AuctionRtcNegotiatorFactory = (peer: AuctionSignalingPeer) => AuctionRtcNegotiator

export type AuctionHostSignalingPollResult = {
  discoveredPeers: string[]
  answeredPeers: string[]
}

type HostPeerState = {
  peer: AuctionSignalingPeer
  negotiator: AuctionRtcNegotiator
  answerApplied: boolean
}

/** Host-side slow rendezvous. Poll only until each DataChannel is established. */
export class AuctionWebRtcHostSignalingController {
  private readonly peers = new Map<string, HostPeerState>()

  constructor(
    private readonly repository: GitHubAuctionSignalingRepository,
    readonly room: AuctionSignalingRoom,
    private readonly createNegotiator: AuctionRtcNegotiatorFactory,
  ) {}

  async start(): Promise<void> {
    await this.repository.publishRoom(this.room)
  }

  async poll(): Promise<AuctionHostSignalingPollResult> {
    const index = await this.repository.getPeerIndex(this.room)
    const discoveredPeers: string[] = []
    const answeredPeers: string[] = []

    for (const peer of index?.value.peers ?? []) {
      let state = this.peers.get(peer.peerId)
      if (!state) {
        const negotiator = this.createNegotiator(peer)
        const offer = await negotiator.createOffer()
        if (offer.type !== 'offer') throw new Error('Host negotiator did not create an SDP offer')
        await this.repository.publishDescription(this.room, createAuctionSessionDescriptionSignal({
          room: this.room,
          peerId: peer.peerId,
          kind: 'offer',
          sdp: offer.sdp,
        }))
        state = { peer: { ...peer }, negotiator, answerApplied: false }
        this.peers.set(peer.peerId, state)
        discoveredPeers.push(peer.peerId)
      } else {
        state.peer = { ...peer }
      }

      if (state.answerApplied) continue
      const answer = await this.repository.getDescription(this.room, peer.peerId, 'answer')
      if (!answer) continue
      await state.negotiator.acceptAnswer(answer.value.description)
      state.answerApplied = true
      answeredPeers.push(peer.peerId)
    }

    return { discoveredPeers, answeredPeers }
  }

  closePeer(peerId: string): void {
    this.peers.get(peerId)?.negotiator.close?.()
    this.peers.delete(peerId)
  }

  close(): void {
    for (const state of this.peers.values()) state.negotiator.close?.()
    this.peers.clear()
  }
}

export type AuctionParticipantSignalingPollResult = {
  offerAccepted: boolean
  answerPublished: boolean
}

/** Participant-side rendezvous for one device/peer id. */
export class AuctionWebRtcParticipantSignalingController {
  private acceptedOfferFingerprint: string | null = null
  private lastHeartbeatAt = Number.NEGATIVE_INFINITY

  constructor(
    private readonly repository: GitHubAuctionSignalingRepository,
    readonly room: AuctionSignalingRoom,
    readonly peer: { peerId: string; email: string },
    private readonly negotiator: AuctionRtcNegotiator,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async join(): Promise<void> {
    const at = this.now()
    await this.repository.upsertPeer(this.room, {
      peerId: this.peer.peerId,
      email: this.peer.email,
      at,
    })
    this.lastHeartbeatAt = at.getTime()
  }

  async poll(): Promise<AuctionParticipantSignalingPollResult> {
    const now = this.now()
    if (now.getTime() - this.lastHeartbeatAt >= PEER_HEARTBEAT_INTERVAL_MS) {
      await this.repository.upsertPeer(this.room, {
        peerId: this.peer.peerId,
        email: this.peer.email,
        at: now,
      })
      this.lastHeartbeatAt = now.getTime()
    }

    const offer = await this.repository.getDescription(this.room, this.peer.peerId, 'offer')
    if (!offer) return { offerAccepted: false, answerPublished: false }

    const fingerprint = `${offer.value.createdAt}\n${offer.value.description.sdp}`
    if (this.acceptedOfferFingerprint === fingerprint) {
      return { offerAccepted: false, answerPublished: false }
    }

    const answer = await this.negotiator.acceptOffer(offer.value.description)
    if (answer.type !== 'answer') throw new Error('Participant negotiator did not create an SDP answer')
    await this.repository.publishDescription(this.room, createAuctionSessionDescriptionSignal({
      room: this.room,
      peerId: this.peer.peerId,
      kind: 'answer',
      sdp: answer.sdp,
      now,
    }))
    this.acceptedOfferFingerprint = fingerprint
    return { offerAccepted: true, answerPublished: true }
  }

  close(): void {
    this.negotiator.close?.()
  }
}
