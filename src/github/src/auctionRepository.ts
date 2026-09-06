import type { AuctionAssignmentOutcome, AuctionCheckpoint } from '@fantazone/domain'
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

/** Append-only durable assignment outcome. One accepted assignment maps to one sequence file. */
export function auctionAssignmentOutcomeDocumentPath(season: number, auctionId: string, sequence: number): string {
  validateSeason(season)
  validateSegment(auctionId, 'Auction id')
  if (!Number.isInteger(sequence) || sequence < 1) throw new Error('Auction outcome sequence must be a positive integer')
  return `data/groups/seasons/${season}/auctions/${encodeURIComponent(auctionId.trim())}/outcomes/${sequence}.json`
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

  async getAssignmentOutcome(
    season: number,
    auctionId: string,
    sequence: number,
    options: RepositoryJsonReadOptions = {},
  ): Promise<RepositoryJsonSnapshot<AuctionAssignmentOutcome> | null> {
    return this.store.tryReadJson<AuctionAssignmentOutcome>(
      this.location(auctionAssignmentOutcomeDocumentPath(season, auctionId, sequence)),
      options,
    )
  }

  async submitAssignmentOutcome(
    outcome: AuctionAssignmentOutcome,
  ): Promise<RepositoryJsonSnapshot<AuctionAssignmentOutcome>> {
    validateOutcome(outcome)
    return this.store.writeJson(
      this.location(auctionAssignmentOutcomeDocumentPath(outcome.season, outcome.auctionId, outcome.sequence)),
      outcome,
      `auction: assignment ${outcome.auctionId} #${outcome.sequence}`,
      { createOnly: true },
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

function validateOutcome(outcome: AuctionAssignmentOutcome): void {
  if (outcome.version !== 1) throw new Error('Unsupported auction assignment outcome version')
  validateSegment(outcome.auctionId, 'Auction id')
  validateSegment(outcome.leagueId, 'League id')
  validateSegment(outcome.actor, 'Auction actor')
  validateSegment(outcome.owner, 'Auction owner')
  validateSegment(outcome.playerKey, 'Player key')
  validateSeason(outcome.season)
  if (!Number.isInteger(outcome.sequence) || outcome.sequence < 1) throw new Error('Auction outcome sequence must be a positive integer')
  if (outcome.status !== 'pending') throw new Error('Only pending auction outcomes may be submitted by the realtime host')
}

function validateSeason(season: number): void {
  if (!Number.isInteger(season) || season < 1) throw new Error('Season must be a positive integer')
}

function validateSegment(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} is required`)
}
