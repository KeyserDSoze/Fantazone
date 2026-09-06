import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import {
  getCurrentSeasonYear,
  syncTeamPlayerTransfers,
  type Group,
  type RealPlayers,
  type Team,
} from '@fantazone/domain'
import {
  GROUP_DOCUMENT_PATH,
  decodeRealPlayers,
  realPlayersDocumentPath,
  seasonTeamDocumentPath,
} from '@fantazone/github'

export type GroupPlayerTransferSyncOptions = {
  groupRepoRoot: string
  platformRepoRoot: string
  season?: number
  now?: Date
}

export type GroupPlayerTransferSyncResult = {
  deferred: boolean
  season: number
  inspectedTeams: number
  changedTeams: number
  changedPlayers: number
  missingTeams: number
}

/**
 * Group-owned half of legacy AllPlayersAndAllTeamsJob. The platform owns the
 * authoritative Serie A player master; each group only updates the RealTeam
 * snapshot embedded in active current-season fantasy roster players.
 */
export async function syncGroupPlayerTransfers(
  options: GroupPlayerTransferSyncOptions,
): Promise<GroupPlayerTransferSyncResult> {
  const season = options.season ?? getCurrentSeasonYear(options.now ?? new Date())
  assertSeason(season)

  const manifest = await readOptionalJson<{ updating?: boolean }>(resolve(options.groupRepoRoot, 'manifest.json'))
  if (manifest?.updating === true) return emptyResult(season, true)

  const group = await readJson<Group>(resolve(options.groupRepoRoot, GROUP_DOCUMENT_PATH))
  const master = await loadMaster(options.platformRepoRoot, season)
  let inspectedTeams = 0
  let changedTeams = 0
  let changedPlayers = 0
  let missingTeams = 0

  for (const basket of group.baskets) {
    const yearly = basket.years.find(item => item.year === season)
    if (!yearly) continue

    for (const annualTeam of yearly.teams) {
      inspectedTeams += 1
      const path = resolve(options.groupRepoRoot, seasonTeamDocumentPath(basket.id, season, annualTeam.owner))
      const team = await readOptionalJson<Team>(path)
      if (!team) {
        missingTeams += 1
        continue
      }

      const synced = syncTeamPlayerTransfers(team, master)
      if (synced.changedPlayerKeys.length === 0) continue
      await writeJson(path, synced.team)
      changedTeams += 1
      changedPlayers += synced.changedPlayerKeys.length
    }
  }

  return { deferred: false, season, inspectedTeams, changedTeams, changedPlayers, missingTeams }
}

async function loadMaster(root: string, season: number): Promise<RealPlayers> {
  const path = resolve(root, realPlayersDocumentPath(season))
  const value = await readOptionalJson<unknown>(path)
  if (!value) throw new Error(`Serie A players ${season} not found in ${path}`)
  return decodeRealPlayers(value, season)
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

async function readOptionalJson<T>(path: string): Promise<T | null> {
  try {
    return await readJson<T>(path)
  } catch (error) {
    if (isNotFound(error)) return null
    throw error
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function emptyResult(season: number, deferred: boolean): GroupPlayerTransferSyncResult {
  return { deferred, season, inspectedTeams: 0, changedTeams: 0, changedPlayers: 0, missingTeams: 0 }
}

function assertSeason(season: number): void {
  if (!Number.isInteger(season) || season < 1) throw new Error('Season must be a positive integer')
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
