import {
  createEmptyAuctionPeerIndex,
  isAuctionSignalingRoomExpired,
  upsertAuctionSignalingPeer,
  validateAuctionSessionDescriptionSignal,
  validateAuctionSignalingPeerIndex,
  validateAuctionSignalingRoom,
  type AuctionSessionDescriptionSignal,
  type AuctionSignalingPeerIndex,
  type AuctionSignalingRoom,
} from '@fantazone/domain'
import type { GroupRepositoryTarget } from './repositoryTarget'
import {
  GitHubJsonStore,
  RepositoryWriteConflictError,
  type RepositoryJsonSnapshot,
} from './repositoryStore'

const MAX_PEER_INDEX_WRITE_ATTEMPTS = 6

export class AuctionSignalingSessionChangedError extends Error {
  constructor(public readonly auctionId: string, public readonly expectedSessionId: string) {
    super(`Auction signaling session '${expectedSessionId}' is no longer current for '${auctionId}'`)
    this.name = 'AuctionSignalingSessionChangedError'
  }
}

export class AuctionSignalingRoomBusyError extends Error {
  constructor(public readonly room: AuctionSignalingRoom) {
    super(`Auction signaling room '${room.auctionId}' already has an active host session`)
    this.name = 'AuctionSignalingRoomBusyError'
  }
}

export function auctionSignalingRoomDocumentPath(auctionId: string): string {
  return `${auctionRealtimeRoot(auctionId)}/room.json`
}

export function auctionSignalingPeerIndexDocumentPath(auctionId: string, sessionId: string): string {
  return `${auctionSignalingSessionRoot(auctionId, sessionId)}/peers.json`
}

export function auctionSignalDocumentPath(
  auctionId: string,
  sessionId: string,
  peerId: string,
  kind: 'offer' | 'answer',
): string {
  validateSegment(peerId, 'Peer id')
  return `${auctionSignalingSessionRoot(auctionId, sessionId)}/${encodeURIComponent(peerId.trim())}/${kind}.json`
}

/**
 * Slow GitHub rendezvous for WebRTC only. Every read is refreshed and every write
 * lives under realtime/, so the group manifest/cache revision is not advanced.
 */
export class GitHubAuctionSignalingRepository {
  constructor(
    private readonly store: GitHubJsonStore,
    private readonly repository: GroupRepositoryTarget,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getRoom(auctionId: string): Promise<RepositoryJsonSnapshot<AuctionSignalingRoom> | null> {
    const snapshot = await this.store.tryReadJson<AuctionSignalingRoom>(
      this.location(auctionSignalingRoomDocumentPath(auctionId)),
      { refresh: true },
    )
    if (!snapshot) return null
    validateAuctionSignalingRoom(snapshot.value)
    return snapshot
  }

  /**
   * Publishes the current room. An unexpired different session cannot be stolen;
   * the same host session may refresh its room document, and an expired room may be replaced.
   */
  async publishRoom(room: AuctionSignalingRoom): Promise<RepositoryJsonSnapshot<AuctionSignalingRoom>> {
    validateAuctionSignalingRoom(room)
    const location = this.location(auctionSignalingRoomDocumentPath(room.auctionId))
    const current = await this.getRoom(room.auctionId)
    if (
      current &&
      current.value.sessionId !== room.sessionId &&
      !isAuctionSignalingRoomExpired(current.value, this.now())
    ) {
      throw new AuctionSignalingRoomBusyError(current.value)
    }

    return this.store.writeJson(
      location,
      room,
      `auction: signaling room ${room.auctionId}`,
      current ? { expectedSha: current.sha } : { createOnly: true },
    )
  }

  async getPeerIndex(room: AuctionSignalingRoom): Promise<RepositoryJsonSnapshot<AuctionSignalingPeerIndex> | null> {
    await this.assertCurrentRoom(room)
    const snapshot = await this.store.tryReadJson<AuctionSignalingPeerIndex>(
      this.location(auctionSignalingPeerIndexDocumentPath(room.auctionId, room.sessionId)),
      { refresh: true },
    )
    if (!snapshot) return null
    validateAuctionSignalingPeerIndex(snapshot.value)
    this.assertPeerIndexSession(room, snapshot.value)
    return snapshot
  }

  /** Optimistic retry keeps concurrent participants and reconnect generations lossless. */
  async upsertPeer(
    room: AuctionSignalingRoom,
    input: { peerId: string; email: string; at?: Date; restart?: boolean },
  ): Promise<RepositoryJsonSnapshot<AuctionSignalingPeerIndex>> {
    await this.assertCurrentRoom(room)
    const location = this.location(auctionSignalingPeerIndexDocumentPath(room.auctionId, room.sessionId))

    for (let attempt = 0; attempt < MAX_PEER_INDEX_WRITE_ATTEMPTS; attempt += 1) {
      const current = await this.store.tryReadJson<AuctionSignalingPeerIndex>(location, { refresh: true })
      const base = current?.value ?? createEmptyAuctionPeerIndex(room)
      validateAuctionSignalingPeerIndex(base)
      this.assertPeerIndexSession(room, base)
      const next = upsertAuctionSignalingPeer(base, input)

      try {
        return await this.store.writeJson(
          location,
          next,
          `auction: signaling peer ${input.peerId}${input.restart ? ' reconnect' : ''}`,
          current ? { expectedSha: current.sha } : { createOnly: true },
        )
      } catch (error) {
        if (!(error instanceof RepositoryWriteConflictError) || attempt === MAX_PEER_INDEX_WRITE_ATTEMPTS - 1) throw error
      }
    }

    throw new Error('Unable to update auction signaling peers')
  }

  async publishDescription(
    room: AuctionSignalingRoom,
    signal: AuctionSessionDescriptionSignal,
  ): Promise<RepositoryJsonSnapshot<AuctionSessionDescriptionSignal>> {
    await this.assertCurrentRoom(room)
    validateAuctionSessionDescriptionSignal(signal)
    this.assertSignalSession(room, signal)
    const location = this.location(auctionSignalDocumentPath(room.auctionId, room.sessionId, signal.peerId, signal.kind))
    const current = await this.store.tryReadJson<AuctionSessionDescriptionSignal>(location, { refresh: true })
    return this.store.writeJson(
      location,
      signal,
      `auction: signaling ${signal.kind} ${signal.peerId}`,
      current ? { expectedSha: current.sha } : { createOnly: true },
    )
  }

  async getDescription(
    room: AuctionSignalingRoom,
    peerId: string,
    kind: 'offer' | 'answer',
  ): Promise<RepositoryJsonSnapshot<AuctionSessionDescriptionSignal> | null> {
    await this.assertCurrentRoom(room)
    const snapshot = await this.store.tryReadJson<AuctionSessionDescriptionSignal>(
      this.location(auctionSignalDocumentPath(room.auctionId, room.sessionId, peerId, kind)),
      { refresh: true },
    )
    if (!snapshot) return null
    validateAuctionSessionDescriptionSignal(snapshot.value)
    this.assertSignalSession(room, snapshot.value)
    if (snapshot.value.peerId !== peerId || snapshot.value.kind !== kind) {
      throw new Error('Auction signaling description path does not match its payload')
    }
    return snapshot
  }

  private async assertCurrentRoom(room: AuctionSignalingRoom): Promise<void> {
    validateAuctionSignalingRoom(room)
    const current = await this.getRoom(room.auctionId)
    if (
      !current ||
      current.value.sessionId !== room.sessionId ||
      isAuctionSignalingRoomExpired(current.value, this.now())
    ) {
      throw new AuctionSignalingSessionChangedError(room.auctionId, room.sessionId)
    }
  }

  private assertPeerIndexSession(room: AuctionSignalingRoom, index: AuctionSignalingPeerIndex): void {
    if (index.auctionId !== room.auctionId || index.sessionId !== room.sessionId) {
      throw new AuctionSignalingSessionChangedError(room.auctionId, room.sessionId)
    }
  }

  private assertSignalSession(room: AuctionSignalingRoom, signal: AuctionSessionDescriptionSignal): void {
    if (signal.auctionId !== room.auctionId || signal.sessionId !== room.sessionId) {
      throw new AuctionSignalingSessionChangedError(room.auctionId, room.sessionId)
    }
  }

  private location(path: string) {
    return { ...this.repository, path }
  }
}

function auctionRealtimeRoot(auctionId: string): string {
  validateSegment(auctionId, 'Auction id')
  return `realtime/auctions/${encodeURIComponent(auctionId.trim())}`
}

function auctionSignalingSessionRoot(auctionId: string, sessionId: string): string {
  validateSegment(sessionId, 'Session id')
  return `${auctionRealtimeRoot(auctionId)}/signaling/${encodeURIComponent(sessionId.trim())}`
}

function validateSegment(value: string, label: string): void {
  if (!value?.trim()) throw new Error(`${label} is required`)
}
