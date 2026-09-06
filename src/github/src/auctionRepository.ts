import type { AuctionCheckpoint } from '@fantazone/domain'
import type { GroupRepositoryTarget } from './repositoryTarget'
import {
  GitHubJsonStore,
  type RepositoryJsonReadOptions,
  type RepositoryJsonSnapshot,
  type RepositoryJsonWriteOptions,
} from './repositoryStore'

/** Durable host checkpoint. Realtime bid traffic is intentionally not stored here. */
export function auctionCheckpointDocumentPath(season: number, auctionId: string): string {
  validateSeason(season)
  validateSegment(auctionId, 'Auction id')
  return `data/groups/seasons/${season}/auctions/${encodeURIComponent(auctionId.trim())}/checkpoint.json`
}

/** Slow rendezvous only; once WebRTC is connected peers stop polling these documents. */
export function auctionSignalDocumentPath(auctionId: string, peerId: string, kind: 'offer' | 'answer'): string {
  validateSegment(auctionId, 'Auction id')
  validateSegment(peerId, 'Peer id')
  return `realtime/auctions/${encodeURIComponent(auctionId.trim())}/signaling/${encodeURIComponent(peerId.trim())}/${kind}.json`
}

export class GitHubAuctionRepository {
  constructor(
    private readonly store: GitHubJsonStore,
    private readonly repository: GroupRepositoryTarget,
  ) {}

  async getCheckpoint(
    season: number,
    auctionId: string,
    options: RepositoryJsonReadOptions = {},
  ): Promise<RepositoryJsonSnapshot<AuctionCheckpoint> | null> {
    return this.store.tryReadJson<AuctionCheckpoint>(
      this.location(auctionCheckpointDocumentPath(season, auctionId)),
      options,
    )
  }

  async createCheckpoint(checkpoint: AuctionCheckpoint): Promise<RepositoryJsonSnapshot<AuctionCheckpoint>> {
    validateCheckpoint(checkpoint)
    return this.store.writeJson(
      this.location(auctionCheckpointDocumentPath(checkpoint.leagueKey.year, checkpoint.id)),
      checkpoint,
      `auction: create ${checkpoint.id}`,
      { createOnly: true },
    )
  }

  async writeCheckpoint(
    checkpoint: AuctionCheckpoint,
    options: RepositoryJsonWriteOptions = {},
  ): Promise<RepositoryJsonSnapshot<AuctionCheckpoint>> {
    validateCheckpoint(checkpoint)
    return this.store.writeJson(
      this.location(auctionCheckpointDocumentPath(checkpoint.leagueKey.year, checkpoint.id)),
      checkpoint,
      `auction: checkpoint ${checkpoint.id} #${checkpoint.sequence}`,
      options,
    )
  }

  private location(path: string) {
    return { ...this.repository, path }
  }
}

function validateCheckpoint(checkpoint: AuctionCheckpoint): void {
  if (checkpoint.version !== 1) throw new Error('Unsupported auction checkpoint version')
  validateSegment(checkpoint.id, 'Auction id')
  validateSeason(checkpoint.leagueKey.year)
  if (!Number.isInteger(checkpoint.sequence) || checkpoint.sequence < 0) {
    throw new Error('Auction checkpoint sequence must be a non-negative integer')
  }
}

function validateSeason(season: number): void {
  if (!Number.isInteger(season) || season < 1) throw new Error('Season must be a positive integer')
}

function validateSegment(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} is required`)
}
