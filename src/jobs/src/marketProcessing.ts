import { execFileSync } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, resolve, relative } from 'node:path'
import {
  emptyMarketWrapper,
  encodeSeasonTeamDocument,
  expirePendingMarkets,
  getCurrentSeasonYear,
  hydrateSeasonTeamDocument,
  processMarketCommand,
  type Group,
  type MarketCommand,
  type MarketTeams,
  type MarketWrapper,
  type RealPlayers,
} from '@fantazone/domain'
import {
  GROUP_DOCUMENT_PATH,
  decodeRealPlayers,
  marketDocumentPath,
  realPlayersDocumentPath,
  seasonTeamDocumentPath,
} from '@fantazone/github'

export type MarketProcessingOptions = {
  groupRepoRoot: string
  platformRepoRoot: string
  season?: number
  now?: Date
}

export type MarketProcessingResult = {
  deferred: boolean
  season: number
  processedCommands: number
  appliedCommands: number
  rejectedCommands: number
  expiredMarkets: number
  changedTeams: number
  changedMarketDocuments: number
}

type PendingCommand = {
  path: string
  command: MarketCommand
  committedAt: Date
}

/**
 * Group-owned replacement for legacy MarketManager writes + MarketJob expiry.
 * Commands are append-only client writes; the Action serializes and revalidates
 * them against canonical Group/Team/Market state. Git commit time is authoritative.
 */
export async function processGroupMarket(options: MarketProcessingOptions): Promise<MarketProcessingResult> {
  const operationNow = options.now ?? new Date()
  const season = options.season ?? getCurrentSeasonYear(operationNow)
  if (!Number.isInteger(season) || season < 1) throw new Error('Season must be a positive integer')

  const manifest = await readOptionalJson<{ updating?: boolean }>(resolve(options.groupRepoRoot, 'manifest.json'))
  if (manifest?.updating === true) return emptyResult(season, true)

  const group = await readJson<Group>(resolve(options.groupRepoRoot, GROUP_DOCUMENT_PATH))
  const master = await loadMasterPlayers(options.platformRepoRoot, season)
  let teams = await loadSeasonTeams(options.groupRepoRoot, group, season, master)
  const commands = await loadPendingCommands(options.groupRepoRoot, season)
  const marketStates = new Map<string, MarketWrapper>()
  const originalStates = new Map<string, string>()
  const changedOwners = new Set<string>()
  let appliedCommands = 0
  let rejectedCommands = 0

  for (const pending of commands) {
    const leagueId = pending.command.leagueId
    const state = await loadMarketState(options.groupRepoRoot, leagueId, season, marketStates, originalStates)
    const result = processMarketCommand({
      group,
      leagueId,
      season,
      command: pending.command,
      market: state,
      teams,
      now: pending.committedAt,
      currentSeason: getCurrentSeasonYear(pending.committedAt),
    })
    marketStates.set(leagueId, result.market)
    teams = result.teams
    for (const owner of result.changedTeams) changedOwners.add(owner)
    await writeJson(pending.path, result.command)
    if (result.command.status === 'applied') appliedCommands += 1
    else if (result.command.status === 'rejected') rejectedCommands += 1
  }

  for (const statePath of await listFiles(resolve(options.groupRepoRoot, `data/groups/seasons/${season}/markets`), 'state.json')) {
    const leagueId = decodeLeagueIdFromStatePath(options.groupRepoRoot, season, statePath)
    if (leagueId) await loadMarketState(options.groupRepoRoot, leagueId, season, marketStates, originalStates)
  }

  let expiredMarkets = 0
  let changedMarketDocuments = 0
  for (const [leagueId, state] of marketStates) {
    const beforeStatuses = new Map(state.markets.map(market => [market.id, market.status]))
    expirePendingMarkets(state, operationNow)
    expiredMarkets += state.markets.filter(market => beforeStatuses.get(market.id) !== market.status).length
    if (stableJson(state) === originalStates.get(leagueId)) continue
    await writeJson(resolve(options.groupRepoRoot, marketDocumentPath(leagueId, season)), state)
    changedMarketDocuments += 1
  }

  for (const owner of changedOwners) {
    const entry = teams.get(owner)
    if (!entry) continue
    await writeJson(
      resolve(options.groupRepoRoot, seasonTeamDocumentPath(entry.basketId, season, entry.team.owner)),
      encodeSeasonTeamDocument(entry.team),
    )
  }

  return {
    deferred: false,
    season,
    processedCommands: commands.length,
    appliedCommands,
    rejectedCommands,
    expiredMarkets,
    changedTeams: changedOwners.size,
    changedMarketDocuments,
  }
}

async function loadMasterPlayers(root: string, season: number): Promise<RealPlayers> {
  const path = resolve(root, realPlayersDocumentPath(season))
  const value = await readOptionalJson<unknown>(path)
  if (!value) throw new Error(`Serie A players ${season} not found in ${path}`)
  return decodeRealPlayers(value, season)
}

async function loadSeasonTeams(root: string, group: Group, season: number, master: RealPlayers): Promise<MarketTeams> {
  const result: MarketTeams = new Map()
  for (const basket of group.baskets) {
    const yearly = basket.years.find(year => year.year === season)
    if (!yearly) continue
    for (const annualTeam of yearly.teams) {
      const value = await readOptionalJson<unknown>(resolve(root, seasonTeamDocumentPath(basket.id, season, annualTeam.owner)))
      if (value) result.set(normalize(annualTeam.owner), { basketId: basket.id, team: hydrateSeasonTeamDocument(value, master) })
    }
  }
  return result
}

async function loadPendingCommands(root: string, season: number): Promise<PendingCommand[]> {
  const files = await listFiles(resolve(root, `data/groups/seasons/${season}/markets`), '.json')
  const pending: PendingCommand[] = []
  for (const path of files.filter(path => path.includes('/commands/') || path.includes('\\commands\\'))) {
    const command = await readOptionalJson<MarketCommand>(path)
    if (!command || command.version !== 1 || command.status !== 'pending') continue
    const repoPath = relative(root, path).split('\\').join('/')
    pending.push({ path, command, committedAt: commandCreationTime(root, repoPath, command.requestedAt) })
  }
  return pending.sort((a, b) => a.committedAt.getTime() - b.committedAt.getTime() || a.path.localeCompare(b.path))
}

async function loadMarketState(
  root: string,
  leagueId: string,
  season: number,
  states: Map<string, MarketWrapper>,
  originals: Map<string, string>,
): Promise<MarketWrapper> {
  const cached = states.get(leagueId)
  if (cached) return cached
  const state = await readOptionalJson<MarketWrapper>(resolve(root, marketDocumentPath(leagueId, season))) ?? emptyMarketWrapper()
  states.set(leagueId, state)
  originals.set(leagueId, stableJson(state))
  return state
}

function commandCreationTime(root: string, path: string, fallbackText: string): Date {
  try {
    const output = execFileSync('git', ['log', '--diff-filter=A', '-1', '--format=%cI', '--', path], { cwd: root, encoding: 'utf8' }).trim()
    const value = new Date(output)
    if (output && Number.isFinite(value.getTime())) return value
  } catch { /* local fixture fallback */ }
  const fallback = new Date(fallbackText)
  if (!Number.isFinite(fallback.getTime())) throw new Error(`Invalid requestedAt for market command ${path}`)
  return fallback
}

function decodeLeagueIdFromStatePath(root: string, season: number, path: string): string | null {
  const repoPath = relative(root, path).split('\\').join('/')
  const match = new RegExp(`^data/groups/seasons/${season}/markets/([^/]+)/state\\.json$`).exec(repoPath)
  if (!match) return null
  try { return decodeURIComponent(match[1]) } catch { return null }
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
  try { return await readJson<T>(path) } catch (error) {
    if (isNotFound(error)) return null
    throw error
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function emptyResult(season: number, deferred: boolean): MarketProcessingResult {
  return { deferred, season, processedCommands: 0, appliedCommands: 0, rejectedCommands: 0, expiredMarkets: 0, changedTeams: 0, changedMarketDocuments: 0 }
}

function stableJson(value: unknown): string { return JSON.stringify(value) }
function normalize(value: string): string { return value.trim().toLowerCase() }
function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
