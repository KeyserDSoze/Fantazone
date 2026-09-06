import {
  createActiveAuctionPointer,
  type ActiveAuctionPointer,
  type AuctionCheckpoint,
} from '@fantazone/domain'
import {
  GitHubAuctionRepository,
  RepositoryWriteConflictError,
  type RepositoryJsonSnapshot,
} from '@fantazone/github'

export type ActiveGroupAuction = {
  pointer: RepositoryJsonSnapshot<ActiveAuctionPointer>
  checkpoint: RepositoryJsonSnapshot<AuctionCheckpoint>
}

export class ActiveAuctionCheckpointMissingError extends Error {
  constructor(
    public readonly pointer: ActiveAuctionPointer,
  ) {
    super(`L'asta attiva '${pointer.auctionId}' non ha un checkpoint disponibile.`)
    this.name = 'ActiveAuctionCheckpointMissingError'
  }
}

export class ActiveAuctionCheckpointMismatchError extends Error {
  constructor(
    public readonly pointer: ActiveAuctionPointer,
    public readonly checkpoint: AuctionCheckpoint,
  ) {
    super(`Il checkpoint '${checkpoint.id}' non corrisponde alla lega/stagione dell'asta attiva.`)
    this.name = 'ActiveAuctionCheckpointMismatchError'
  }
}

/**
 * UI-facing auction discovery boundary. Screens work with league/year + auction id;
 * repository paths and pointer validation stay inside this service.
 */
export class GroupAuctionDiscoveryService {
  constructor(
    private readonly repository: GitHubAuctionRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getActiveAuction(
    leagueId: string,
    season: number,
    options: { refresh?: boolean } = { refresh: true },
  ): Promise<ActiveGroupAuction | null> {
    const pointer = await this.repository.getActiveAuction(season, leagueId, {
      refresh: options.refresh !== false,
    })
    if (!pointer || !pointer.value.auctionId) return null

    const checkpoint = await this.repository.getCheckpoint(
      season,
      pointer.value.auctionId,
      { refresh: options.refresh !== false },
    )
    if (!checkpoint) throw new ActiveAuctionCheckpointMissingError(pointer.value)
    this.assertCheckpoint(pointer.value, checkpoint.value)
    return { pointer, checkpoint }
  }

  /** Activate only a checkpoint that already exists durably in the repository. */
  async activateCheckpoint(
    checkpoint: AuctionCheckpoint,
    options: { expectedPointerSha?: string } = {},
  ): Promise<RepositoryJsonSnapshot<ActiveAuctionPointer>> {
    const durable = await this.repository.getCheckpoint(
      checkpoint.leagueKey.year,
      checkpoint.id,
      { refresh: true },
    )
    if (!durable) {
      throw new Error(`Il checkpoint '${checkpoint.id}' deve essere salvato prima di attivare l'asta.`)
    }
    if (!sameAuctionIdentity(durable.value, checkpoint)) {
      throw new Error(`Il checkpoint salvato per '${checkpoint.id}' non corrisponde alla sessione richiesta.`)
    }

    const pointer = createActiveAuctionPointer({
      leagueId: checkpoint.leagueKey.league,
      season: checkpoint.leagueKey.year,
      auctionId: checkpoint.id,
      updatedAt: this.now(),
    })
    const current = await this.repository.getActiveAuction(
      pointer.season,
      pointer.leagueId,
      { refresh: true },
    )

    const expectedSha = options.expectedPointerSha ?? current?.sha
    if (current && current.value.auctionId && current.value.auctionId !== checkpoint.id && !options.expectedPointerSha) {
      throw new RepositoryWriteConflictError({
        owner: '', repo: '', path: `active-auction:${pointer.leagueId}`,
      }, 409)
    }

    return this.repository.writeActiveAuction(
      pointer,
      expectedSha ? { expectedSha } : { createOnly: true },
    )
  }

  async clearActiveAuction(
    leagueId: string,
    season: number,
    options: { expectedPointerSha?: string } = {},
  ): Promise<RepositoryJsonSnapshot<ActiveAuctionPointer>> {
    const current = await this.repository.getActiveAuction(season, leagueId, { refresh: true })
    const pointer = createActiveAuctionPointer({
      leagueId,
      season,
      auctionId: null,
      updatedAt: this.now(),
    })
    const expectedSha = options.expectedPointerSha ?? current?.sha
    return this.repository.writeActiveAuction(
      pointer,
      expectedSha ? { expectedSha } : { createOnly: true },
    )
  }

  private assertCheckpoint(pointer: ActiveAuctionPointer, checkpoint: AuctionCheckpoint): void {
    if (
      checkpoint.id !== pointer.auctionId ||
      checkpoint.leagueKey.league !== pointer.leagueId ||
      checkpoint.leagueKey.year !== pointer.season
    ) {
      throw new ActiveAuctionCheckpointMismatchError(pointer, checkpoint)
    }
  }
}

function sameAuctionIdentity(left: AuctionCheckpoint, right: AuctionCheckpoint): boolean {
  return left.id === right.id &&
    left.leagueKey.group === right.leagueKey.group &&
    left.leagueKey.league === right.leagueKey.league &&
    left.leagueKey.year === right.leagueKey.year &&
    left.creator === right.creator &&
    left.createdAt === right.createdAt
}
