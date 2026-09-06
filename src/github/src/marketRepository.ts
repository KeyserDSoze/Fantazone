import type { MarketCommand, MarketWrapper } from '@fantazone/domain'
import type { GroupRepositoryTarget } from './repositoryTarget'
import { GitHubJsonStore, type RepositoryJsonReadOptions } from './repositoryStore'

export function marketDocumentPath(leagueId: string, season: number): string {
  validateSegment(leagueId, 'League id')
  validateSeason(season)
  return `data/groups/seasons/${season}/markets/${encodeURIComponent(leagueId.trim())}/state.json`
}

export function marketCommandDocumentPath(leagueId: string, season: number, commandId: string): string {
  validateSegment(leagueId, 'League id')
  validateSegment(commandId, 'Command id')
  validateSeason(season)
  return `data/groups/seasons/${season}/markets/${encodeURIComponent(leagueId.trim())}/commands/${encodeURIComponent(commandId.trim())}.json`
}

export class GitHubMarketRepository {
  constructor(
    private readonly store: GitHubJsonStore,
    private readonly repository: GroupRepositoryTarget,
  ) {}

  async getMarket(leagueId: string, season: number, options: RepositoryJsonReadOptions = {}): Promise<MarketWrapper> {
    const snapshot = await this.store.tryReadJson<MarketWrapper>(this.location(marketDocumentPath(leagueId, season)), options)
    return snapshot?.value ?? { markets: [] }
  }

  async getCommand(leagueId: string, season: number, commandId: string, options: RepositoryJsonReadOptions = {}): Promise<MarketCommand | null> {
    const snapshot = await this.store.tryReadJson<MarketCommand>(
      this.location(marketCommandDocumentPath(leagueId, season, commandId)),
      options,
    )
    return snapshot?.value ?? null
  }

  async submitCommand(command: MarketCommand): Promise<string> {
    const snapshot = await this.store.writeJson(
      this.location(marketCommandDocumentPath(command.leagueId, command.season, command.id)),
      command,
      `market: ${command.kind} ${command.id}`,
      { createOnly: true },
    )
    return snapshot.sha
  }

  private location(path: string) {
    return { ...this.repository, path }
  }
}

function validateSeason(season: number): void {
  if (!Number.isInteger(season) || season < 1) throw new Error('Season must be a positive integer')
}

function validateSegment(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} is required`)
}
