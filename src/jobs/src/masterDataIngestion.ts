import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  Role,
  getCurrentSeasonYear,
  normalizeRealTeam,
  reconcileRealPlayers,
  type RealCalendar,
  type RealPlayer,
  type RealPlayers,
  type RealPlayersReconciliation,
  type RealTeam,
  type RealTeams,
} from '@fantazone/domain'
import {
  decodeRealCalendar,
  decodeRealPlayers,
  realCalendarDocumentPath,
  realPlayersDocumentPath,
  realTeamsDocumentPath,
} from '@fantazone/github'

export const DEFAULT_FANTACALCIO_PLAYERS_URL = 'https://www.fantacalcio.it/quotazioni-fantacalcio'
export const DEFAULT_MINIMUM_SERIE_A_PLAYERS = 400
export const DEFAULT_MINIMUM_ACTIVE_RETENTION_RATIO = 0.85
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const DEFAULT_MINIMUM_SERIE_A_TEAMS = 20

/**
 * Provider abbreviations are transport data, not canonical team identity.
 * Keep observed differences explicit and fail closed for every unknown alias.
 *
 * 2026/27 production validation: Fantacalcio uses MON, while Gazzetta's
 * canonical calendar currently exposes Monza as MONZ.
 */
const FANTACALCIO_TEAM_ABBREVIATION_ALIASES: Readonly<Record<string, string>> = {
  mon: 'monz',
}

export type TextFetcher = (url: string) => Promise<string>

export type MasterDataIngestionOptions = {
  season?: number
  repoRoot?: string
  sourceUrl?: string
  fetchText?: TextFetcher
  now?: Date
  minimumTeamCount?: number
  minimumPlayerCount?: number
  minimumActiveRetentionRatio?: number
}

export type MasterDataIngestionResult = {
  teams: RealTeams
  players: RealPlayers
  reconciliation: RealPlayersReconciliation
  teamsPath: string
  playersPath: string
}

export async function ingestMasterData(
  options: MasterDataIngestionOptions = {},
): Promise<MasterDataIngestionResult> {
  const now = options.now ?? new Date()
  const currentSeason = getCurrentSeasonYear(now)
  const season = options.season ?? currentSeason
  assertSeason(season)
  if (season !== currentSeason) {
    throw new Error(
      `La sorgente master-data configurata espone la stagione corrente (${currentSeason}); non può essere salvata come stagione ${season}.`,
    )
  }

  const repoRoot = options.repoRoot ?? REPO_ROOT
  const calendarPath = resolve(repoRoot, realCalendarDocumentPath(season))
  const calendar = await readRequiredCalendar(calendarPath, season)
  const teams = deriveRealTeamsFromCalendar(calendar)
  const minimumTeamCount = options.minimumTeamCount ?? DEFAULT_MINIMUM_SERIE_A_TEAMS
  if (!Number.isInteger(minimumTeamCount) || minimumTeamCount < 1) {
    throw new Error('minimumTeamCount must be a positive integer')
  }
  if (teams.teams.length < minimumTeamCount) {
    throw new Error(
      `RealCalendar ${season} contiene solo ${teams.teams.length} squadre uniche; ne servono almeno ${minimumTeamCount} prima di aggiornare i master data.`,
    )
  }

  const sourceUrl = options.sourceUrl?.trim() ||
    process.env.FANTAZONE_PLAYERS_SOURCE_URL?.trim() ||
    DEFAULT_FANTACALCIO_PLAYERS_URL
  const fetchText = options.fetchText ?? defaultFetchText
  const html = await fetchText(sourceUrl)
  const currentPlayers = parseFantacalcioPlayers(html, teams)
  const minimumPlayerCount = options.minimumPlayerCount ?? DEFAULT_MINIMUM_SERIE_A_PLAYERS
  validateMinimumPlayerCount(currentPlayers, minimumPlayerCount)
  validateTeamCoverage(currentPlayers, teams)

  const playersPath = resolve(repoRoot, realPlayersDocumentPath(season))
  const existingPlayers = await readExistingPlayers(playersPath, season)
  const minimumActiveRetentionRatio = options.minimumActiveRetentionRatio ?? DEFAULT_MINIMUM_ACTIVE_RETENTION_RATIO
  validateActiveRetention(currentPlayers, existingPlayers, minimumActiveRetentionRatio)

  const reconciliation = reconcileRealPlayers(existingPlayers, currentPlayers, season)
  const teamsPath = resolve(repoRoot, realTeamsDocumentPath(season))

  await writeJson(teamsPath, teams)
  await writeJson(playersPath, reconciliation.value)

  return {
    teams,
    players: reconciliation.value,
    reconciliation,
    teamsPath,
    playersPath,
  }
}

/** Intentional Fantazone difference: clubs come from canonical RealCalendar instead of day-1 official votes. */
export function deriveRealTeamsFromCalendar(calendar: RealCalendar): RealTeams {
  assertSeason(calendar.year)
  const byName = new Map<string, RealTeam>()
  for (const day of calendar.days) {
    for (const game of day.games) {
      addTeam(game.home)
      addTeam(game.away)
    }
  }
  return {
    year: calendar.year,
    teams: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, 'it-IT')),
  }

  function addTeam(team: RealTeam): void {
    const normalized = normalizeRealTeam(team)
    if (!normalized.name || !normalized.abbreviation) return
    const key = normalized.name.toLocaleLowerCase('it-IT')
    const existing = byName.get(key)
    if (!existing) {
      byName.set(key, normalized)
      return
    }
    if (!existing.abbreviation && normalized.abbreviation) byName.set(key, normalized)
  }
}

/** Ports the legacy FantagazzettaAllPlayers HTML semantics without persisting provider DTO/HTML shapes. */
export function parseFantacalcioPlayers(html: string, teams: RealTeams): RealPlayer[] {
  const teamByAbbreviation = new Map(
    teams.teams.map(team => [team.abbreviation.trim().toLocaleLowerCase('it-IT'), team] as const),
  )
  const players: RealPlayer[] = []
  const rowRegex = /<tr\b[^>]*class\s*=\s*["'][^"']*\bplayer-row\b[^"']*["'][^>]*>[\s\S]*?<\/tr>/gi
  for (const match of html.matchAll(rowRegex)) {
    const row = match[0]
    const openingTag = row.slice(0, row.indexOf('>') + 1)
    if (/\bout-of-game\b/i.test(openingTag)) continue

    const name = extractPlayerName(row)
    const teamAbbreviation = extractTeamAbbreviation(row)
    const role = extractRole(row)
    if (!name || !teamAbbreviation || role === Role.Undefined) continue

    const team = resolveFantacalcioTeam(teamAbbreviation, teamByAbbreviation)
    if (!team) {
      throw new Error(`La sorgente giocatori usa la squadra '${teamAbbreviation}' che non esiste nel RealCalendar ${teams.year}.`)
    }
    players.push({
      name,
      team: { ...team },
      role,
      isActive: true,
      visible: true,
    })
  }
  return players
}

function resolveFantacalcioTeam(
  providerAbbreviation: string,
  teamByAbbreviation: ReadonlyMap<string, RealTeam>,
): RealTeam | undefined {
  const abbreviation = providerAbbreviation.trim().toLocaleLowerCase('it-IT')
  const exact = teamByAbbreviation.get(abbreviation)
  if (exact) return exact
  const canonicalAlias = FANTACALCIO_TEAM_ABBREVIATION_ALIASES[abbreviation]
  return canonicalAlias ? teamByAbbreviation.get(canonicalAlias) : undefined
}

function validateMinimumPlayerCount(players: readonly RealPlayer[], minimumPlayerCount: number): void {
  if (!Number.isInteger(minimumPlayerCount) || minimumPlayerCount < 1) {
    throw new Error('minimumPlayerCount must be a positive integer')
  }
  if (players.length < minimumPlayerCount) {
    throw new Error(
      `La sorgente Fantacalcio ha restituito solo ${players.length} giocatori validi; ne servono almeno ${minimumPlayerCount}. Il master data esistente non viene modificato.`,
    )
  }
}

function validateTeamCoverage(players: readonly RealPlayer[], teams: RealTeams): void {
  const represented = new Set(players.map(player => normalizeTeamName(player.team.name)))
  const missing = teams.teams.filter(team => !represented.has(normalizeTeamName(team.name)))
  if (missing.length === 0) return
  throw new Error(
    `La sorgente Fantacalcio non copre tutte le squadre del RealCalendar ${teams.year}: ${missing.map(team => team.name).join(', ')}. Il master data esistente non viene modificato.`,
  )
}

function validateActiveRetention(
  currentPlayers: readonly RealPlayer[],
  existingPlayers: RealPlayers | null,
  minimumRatio: number,
): void {
  if (!Number.isFinite(minimumRatio) || minimumRatio <= 0 || minimumRatio > 1) {
    throw new Error('minimumActiveRetentionRatio must be greater than 0 and at most 1')
  }
  if (!existingPlayers) return
  const existingActiveCount = existingPlayers.players.filter(player => player.isActive).length
  if (existingActiveCount === 0) return
  const required = Math.ceil(existingActiveCount * minimumRatio)
  if (currentPlayers.length >= required) return
  throw new Error(
    `La sorgente Fantacalcio ha restituito ${currentPlayers.length} giocatori contro ${existingActiveCount} attivi nel master esistente; ` +
    `la soglia di sicurezza richiede almeno ${required} (${Math.round(minimumRatio * 100)}%). Il master data esistente non viene modificato.`,
  )
}

function extractPlayerName(row: string): string {
  const spans = row.matchAll(/<span\b([^>]*)>([\s\S]*?)<\/span>/gi)
  for (const span of spans) {
    const attributes = span[1] ?? ''
    if (/\bclass\s*=\s*["'][^"']*\brole\b/i.test(attributes)) continue
    const value = cleanHtmlText(span[2] ?? '').replace(/\\'/g, '')
    if (value) return value
  }
  return ''
}

function extractTeamAbbreviation(row: string): string {
  const match = /<td\b[^>]*class\s*=\s*["'][^"']*\bplayer-team\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/i.exec(row)
  return cleanHtmlText(match?.[1] ?? '').toLocaleLowerCase('it-IT')
}

function extractRole(row: string): Role {
  for (const span of row.matchAll(/<span\b([^>]*)>/gi)) {
    const attributes = span[1] ?? ''
    if (!/\bclass\s*=\s*["'][^"']*\brole\b/i.test(attributes)) continue
    const value = /\bdata-value\s*=\s*["']([a-z])["']/i.exec(attributes)?.[1]?.toLocaleLowerCase('it-IT')
    switch (value) {
      case 'p': return Role.GoalKeeper
      case 'd': return Role.Defensor
      case 'c': return Role.Midfielder
      case 'a': return Role.Forward
      default: return Role.Undefined
    }
  }
  return Role.Undefined
}

function cleanHtmlText(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"',
  }
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity: string) => {
    if (entity[0] === '#') {
      const hexadecimal = entity[1]?.toLocaleLowerCase() === 'x'
      const raw = entity.slice(hexadecimal ? 2 : 1)
      const codePoint = Number.parseInt(raw, hexadecimal ? 16 : 10)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _
    }
    return named[entity.toLocaleLowerCase()] ?? _
  })
}

async function readRequiredCalendar(path: string, season: number): Promise<RealCalendar> {
  try {
    return decodeRealCalendar(JSON.parse(await readFile(path, 'utf8')), season)
  } catch (error) {
    if (isFileNotFound(error)) {
      throw new Error(`RealCalendar ${season} non trovato in ${path}. Esegui prima ingest-serie-a.`)
    }
    throw error
  }
}

async function readExistingPlayers(path: string, season: number): Promise<RealPlayers | null> {
  try {
    return decodeRealPlayers(JSON.parse(await readFile(path, 'utf8')), season)
  } catch (error) {
    if (isFileNotFound(error)) return null
    throw error
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function defaultFetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Fantazone/1.0; +https://fanta.plus)',
      'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
      'Cache-Control': 'no-cache',
      Referer: 'https://www.fantacalcio.it/',
    },
  })
  if (!response.ok) throw new Error(`Fantacalcio players source returned HTTP ${response.status} for ${url}`)
  return response.text()
}

function normalizeTeamName(name: string): string {
  return name.trim().toLocaleLowerCase('it-IT')
}

function assertSeason(year: number): void {
  if (!Number.isInteger(year) || year < 1) throw new Error('Season id must be a positive integer')
}

function isFileNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
