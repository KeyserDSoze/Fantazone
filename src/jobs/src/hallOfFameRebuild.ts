import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import {
  GroupHelper,
  buildHallOfFame,
  getCurrentSeasonYear,
  hydrateSeasonTeamDocument,
  type Calendar,
  type Group,
  type HallOfFame,
  type HallOfFameSeasonInput,
  type Rank,
  type RealPlayers,
  type Team,
} from '@fantazone/domain'
import {
  GROUP_DOCUMENT_PATH,
  calendarDocumentPath,
  decodeRealPlayers,
  hallOfFameDocumentPath,
  realPlayersDocumentPath,
  seasonRankDocumentPath,
  seasonTeamDocumentPath,
} from '@fantazone/github'

export type HallOfFameRebuildOptions = {
  groupRepoRoot: string
  platformRepoRoot: string
  now?: Date
}

export type HallOfFameLeagueRebuildResult = {
  leagueId: string
  seasons: number[]
  path: string
  hallOfFame: HallOfFame
}

export type HallOfFameRebuildResult = {
  currentSeason: number
  leagues: HallOfFameLeagueRebuildResult[]
}

/** Group-owned filesystem job replacing legacy HallOfFameJob. */
export async function rebuildGroupHallOfFame(options: HallOfFameRebuildOptions): Promise<HallOfFameRebuildResult> {
  const currentSeason = getCurrentSeasonYear(options.now ?? new Date())
  const group = await readJson<Group>(resolve(options.groupRepoRoot, GROUP_DOCUMENT_PATH))
  const leagues: HallOfFameLeagueRebuildResult[] = []
  const masters = new Map<number, RealPlayers>()

  for (const league of group.leagues) {
    const seasons: HallOfFameSeasonInput[] = []
    for (const annual of [...league.years].sort((a, b) => b.year - a.year)) {
      const rank = await readOptionalJson<Rank>(resolve(options.groupRepoRoot, seasonRankDocumentPath(league.id, annual.year)))
      const calendar = await readOptionalJson<Calendar>(resolve(options.groupRepoRoot, calendarDocumentPath(league.id, annual.year)))
      if (!rank || !calendar) continue

      let master = masters.get(annual.year)
      if (!master) {
        master = await loadMasterPlayers(options.platformRepoRoot, annual.year)
        masters.set(annual.year, master)
      }
      seasons.push({
        year: annual.year,
        leagueType: GroupHelper.getAnnualType(league, annual.year),
        rank,
        calendar,
        teamsByOwner: await loadTeamsForSeason(options.groupRepoRoot, group, annual.year, master),
      })
    }

    const hallOfFame = buildHallOfFame({ group, leagueId: league.id, currentSeason, seasons })
    const path = resolve(options.groupRepoRoot, hallOfFameDocumentPath(league.id))
    await writeJson(path, hallOfFame)
    leagues.push({ leagueId: league.id, seasons: seasons.map(item => item.year), path, hallOfFame })
  }

  return { currentSeason, leagues }
}

async function loadMasterPlayers(root: string, season: number): Promise<RealPlayers> {
  const path = resolve(root, realPlayersDocumentPath(season))
  const value = await readOptionalJson<unknown>(path)
  if (!value) throw new Error(`Serie A players ${season} not found in ${path}`)
  return decodeRealPlayers(value, season)
}

async function loadTeamsForSeason(root: string, group: Group, season: number, master: RealPlayers): Promise<Map<string, Team>> {
  const result = new Map<string, Team>()
  const owners = new Set<string>()
  for (const basket of group.baskets) {
    const annual = basket.years.find(item => item.year === season)
    for (const team of annual?.teams ?? []) owners.add(team.owner)
  }

  for (const owner of owners) {
    const basketId = GroupHelper.getBasketId(group, owner, season)
    if (!basketId) continue
    const value = await readOptionalJson<unknown>(resolve(root, seasonTeamDocumentPath(basketId, season, owner)))
    if (value) result.set(normalize(owner), hydrateSeasonTeamDocument(value, master))
  }
  return result
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

async function readOptionalJson<T>(path: string): Promise<T | null> {
  try { return await readJson<T>(path) } catch (error) {
    if (isNotFound(error)) return null
    throw error
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function normalize(value: string): string { return value.trim().toLowerCase() }
function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
