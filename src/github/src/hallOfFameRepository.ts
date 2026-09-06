import type { HallOfFame } from '@fantazone/domain'
import { GitHubJsonStore, type RepositoryJsonReadOptions } from './repositoryStore'
import type { GroupRepositoryTarget } from './repositoryTarget'

export class GitHubHallOfFameRepository {
  constructor(
    private readonly store: GitHubJsonStore,
    private readonly repository: GroupRepositoryTarget,
  ) {}

  async getHallOfFame(
    leagueId: string,
    options: RepositoryJsonReadOptions = {},
  ): Promise<HallOfFame | null> {
    const snapshot = await this.store.tryReadJson<HallOfFame>(this.location(leagueId), options)
    return snapshot?.value ?? null
  }

  async writeHallOfFame(leagueId: string, hallOfFame: HallOfFame): Promise<HallOfFame> {
    const snapshot = await this.store.writeJson(
      this.location(leagueId),
      hallOfFame,
      `data: rebuild Hall of Fame ${leagueId}`,
    )
    return snapshot.value
  }

  private location(leagueId: string) {
    return {
      ...this.repository,
      path: hallOfFameDocumentPath(leagueId),
    }
  }
}

export function hallOfFameDocumentPath(leagueId: string): string {
  const normalized = leagueId.trim()
  if (!normalized) throw new Error('League id is required')
  return `data/groups/leagues/${encodeURIComponent(normalized)}/hall-of-fame.json`
}
