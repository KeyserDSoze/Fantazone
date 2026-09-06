import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import {
  GroupHelper,
  applyAuctionAssignmentOutcome,
  getCurrentSeasonYear,
  getPlayerKey,
  type AuctionAssignmentOutcome,
  type Group,
  type RealPlayer,
  type RealPlayers,
  type Team,
} from '@fantazone/domain'
import {
  GROUP_DOCUMENT_PATH,
  auctionAssignmentOutcomeDocumentPath,
  decodeRealPlayers,
  realPlayersDocumentPath,
  seasonTeamDocumentPath,
} from '@fantazone/github'

export type AuctionOutcomeProcessingOptions = {
  groupRepoRoot: string
  platformRepoRoot: string
  season?: number
  now?: Date
}

export type AuctionOutcomeProcessingResult = {
  deferred: boolean
  season: number
  processedOutcomes: number
  appliedOutcomes: number
  rejectedOutcomes: number
  changedTeams: number
}

type PendingOutcome = {
  path: string
  outcome: AuctionAssignmentOutcome
}

type CachedTeam = {
  path: string
  team: Team
}

/**
 * Serial group-Action boundary for realtime auction assignments. The client only
 * appends pending outcomes; this job revalidates them against canonical repository
 * state and lets the managed workflow commit Team + outcome status atomically.
 */
export async function processAuctionOutcomes(
  options: AuctionOutcomeProcessingOptions,
): Promise<AuctionOutcomeProcessingResult> {
  const operationNow = options.now ?? new Date()
  const season = options.season ?? getCurrentSeasonYear(operationNow)
  if (!Number.isInteger(season) || season < 1) throw new Error('Season must be a positive integer')

  const manifest = await readOptionalJson<{ updating?: boolean }>(resolve(options.groupRepoRoot, 'manifest.json'))
  if (manifest?.updating === true) return emptyResult(season, true)

  const group = await readJson<Group>(resolve(options.groupRepoRoot, GROUP_DOCUMENT_PATH))
  const master = await loadMasterPlayers(options.platformRepoRoot, season)
  const playersByKey = new Map(master.players.map(player => [getPlayerKey(player.name), player] as const))
  const pending = await loadPendingOutcomes(options.groupRepoRoot, season)
  const teamCache = new Map<string, CachedTeam>()
  const changedOwners = new Set<string>()
  let appliedOutcomes = 0
  let rejectedOutcomes = 0

  for (const item of pending) {
    let outcome = item.outcome
    const structuralError = validateOutcomeLocation(options.groupRepoRoot, season, item)
    if (structuralError) {
      outcome = rejectOutcome(outcome, operationNow, structuralError)
      await writeJson(item.path, outcome)
      rejectedOutcomes += 1
      continue
    }

    const player = playersByKey.get(getPlayerKey(outcome.playerKey)) ?? null
    if (!player || getPlayerKey(player.name) !== getPlayerKey(outcome.playerKey)) {
      outcome = rejectOutcome(outcome, operationNow, 'Auction player was not found in authoritative Serie A data')
      await writeJson(item.path, outcome)
      rejectedOutcomes += 1
      continue
    }

    const basketId = GroupHelper.getBasketId(group, outcome.owner, season)
    if (!basketId) {
      outcome = rejectOutcome(outcome, operationNow, 'Auction owner has no canonical team for this season')
      await writeJson(item.path, outcome)
      rejectedOutcomes += 1
      continue
    }

    const teamKey = `${basketId}\u0000${normalize(outcome.owner)}`
    let cached = teamCache.get(teamKey)
    if (!cached) {
      const path = resolve(options.groupRepoRoot, seasonTeamDocumentPath(basketId, season, outcome.owner))
      const team = await readOptionalJson<Team>(path)
      if (!team) {
        outcome = rejectOutcome(outcome, operationNow, 'Canonical auction team was not found')
        await writeJson(item.path, outcome)
        rejectedOutcomes += 1
        continue
      }
      cached = { path, team }
      teamCache.set(teamKey, cached)
    }

    const applied = applyAuctionAssignmentOutcome({
      group,
      outcome,
      team: cached.team,
      player,
      processedAt: operationNow,
    })
    await writeJson(item.path, applied.outcome)
    if (applied.outcome.status === 'applied') {
      cached.team = applied.team
      await writeJson(cached.path, cached.team)
      changedOwners.add(normalize(cached.team.owner))
      appliedOutcomes += 1
    } else {
      rejectedOutcomes += 1
    }
  }

  return {
    deferred: false,
    season,
    processedOutcomes: pending.length,
    appliedOutcomes,
    rejectedOutcomes,
    changedTeams: changedOwners.size,
  }
}

async function loadMasterPlayers(root: string, season: number): Promise<RealPlayers> {
  const path = resolve(root, realPlayersDocumentPath(season))
  const value = await readOptionalJson<unknown>(path)
  if (!value) throw new Error(`Serie A players ${season} not found in ${path}`)
  return decodeRealPlayers(value, season)
}

async function loadPendingOutcomes(root: string, season: number): Promise<PendingOutcome[]> {
  const files = await listFiles(resolve(root, `data/groups/seasons/${season}/auctions`), '.json')
  const pending: PendingOutcome[] = []
  for (const path of files.filter(path => path.includes('/outcomes/') || path.includes('\\outcomes\\'))) {
    const outcome = await readOptionalJson<AuctionAssignmentOutcome>(path)
    if (!outcome || outcome.status !== 'pending') continue
    pending.push({ path, outcome })
  }
  return pending.sort((a, b) =>
    a.outcome.assignedAt.localeCompare(b.outcome.assignedAt) ||
    a.outcome.auctionId.localeCompare(b.outcome.auctionId) ||
    a.outcome.sequence - b.outcome.sequence ||
    a.path.localeCompare(b.path),
  )
}

function validateOutcomeLocation(root: string, season: number, item: PendingOutcome): string | null {
  if (item.outcome.version !== 1) return 'Unsupported auction assignment outcome version'
  if (item.outcome.season !== season) return 'Auction outcome season does not match its repository path'
  if (!item.outcome.auctionId?.trim() || !Number.isInteger(item.outcome.sequence) || item.outcome.sequence < 1) {
    return 'Auction outcome id or sequence is invalid'
  }
  const expected = auctionAssignmentOutcomeDocumentPath(season, item.outcome.auctionId, item.outcome.sequence)
  const actual = relative(root, item.path).split('\\').join('/')
  return actual === expected ? null : 'Auction outcome document path does not match its id and sequence'
}

function rejectOutcome(outcome: AuctionAssignmentOutcome, processedAt: Date, message: string): AuctionAssignmentOutcome {
  return {
    ...outcome,
    status: 'rejected',
    result: { processedAt: processedAt.toISOString(), message },
  }
}

async function listFiles(root: string, suffix: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true })
    const nested = await Promise.all(entries.map(async entry => {
      const path = resolve(root, entry.name)
      if (entry.isDirectory()) return listFiles(path, suffix)
      return entry.isFile() && entry.name.endsWith(suffix) ? [path] : []
    }))
    return nested.flat()
  } catch (error) {
    if (isNotFound(error)) return []
    throw error
  }
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

function emptyResult(season: number, deferred: boolean): AuctionOutcomeProcessingResult {
  return { deferred, season, processedOutcomes: 0, appliedOutcomes: 0, rejectedOutcomes: 0, changedTeams: 0 }
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
