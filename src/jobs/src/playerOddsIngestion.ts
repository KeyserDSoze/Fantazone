import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  RealCalendarHelper,
  getCurrentSeasonYear,
  mergePlayerChances,
  type ChanceObservation,
  type ChancedRealPlayers,
  type RealCalendar,
  type RealPlayers,
} from '@fantazone/domain'
import {
  chanceDocumentPath,
  decodeChancedRealPlayers,
  decodeRealCalendar,
  decodeRealPlayers,
  realCalendarDocumentPath,
  realPlayersDocumentPath,
} from '@fantazone/github'
import {
  parseFantacalcioInjuries,
  parseFantagazzettaProbableLineups,
  parseGazzettaProbableLineups,
} from './chanceParsers'

export const DEFAULT_FANTAGAZZETTA_FORMATIONS_URL = 'https://www.fantacalcio.it/probabili-formazioni-serie-a'
export const DEFAULT_GAZZETTA_FORMATIONS_URL = 'https://www.gazzetta.it/Calcio/prob_form/'
export const DEFAULT_FANTACALCIO_INJURY_URL = 'https://www.fantacalcio.it/indisponibili-serie-a'

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

export type PlayerOddsSourceName = 'fantagazzetta' | 'gazzetta' | 'injury'
export type PlayerOddsTextFetcher = (url: string) => Promise<string>

export type PlayerOddsIngestionOptions = {
  season?: number
  repoRoot?: string
  now?: Date
  fetchText?: PlayerOddsTextFetcher
  fantagazzettaUrl?: string
  gazzettaUrl?: string
  injuryUrl?: string
}

export type PlayerOddsSourceResult = {
  source: PlayerOddsSourceName
  url: string
  ok: boolean
  observations: number
  error?: string
}

export type PlayerOddsIngestionResult = {
  season: number
  serieADay: number | null
  path: string | null
  snapshot: ChancedRealPlayers | null
  written: boolean
  skipped: boolean
  reason?: 'calendar-missing' | 'no-target-day' | 'players-missing' | 'all-providers-failed'
  sources: PlayerOddsSourceResult[]
}

/**
 * Global replacement for legacy PlayerOddsJob.
 * It reads only shared Serie A documents and never knows about fantasy groups.
 */
export async function ingestPlayerOdds(
  options: PlayerOddsIngestionOptions = {},
): Promise<PlayerOddsIngestionResult> {
  const now = options.now ?? new Date()
  const season = options.season ?? getCurrentSeasonYear(now)
  assertSeason(season)
  const repoRoot = options.repoRoot ?? REPO_ROOT

  const calendar = await readOptionalCalendar(resolve(repoRoot, realCalendarDocumentPath(season)), season)
  if (!calendar) return skipped(season, null, 'calendar-missing')

  const liveDay = RealCalendarHelper.getLiveDay(calendar, now)
  const targetDay = liveDay ?? RealCalendarHelper.getNextDay(calendar, now)
  const serieADay = targetDay?.serieADay ?? null
  if (!serieADay) return skipped(season, null, 'no-target-day')

  const realPlayers = await readOptionalPlayers(resolve(repoRoot, realPlayersDocumentPath(season)), season)
  if (!realPlayers?.players.length) return skipped(season, serieADay, 'players-missing')

  const targetPath = resolve(repoRoot, chanceDocumentPath(season, serieADay))
  const existing = await readOptionalChances(targetPath, season, serieADay)
  const fetchText = options.fetchText ?? defaultFetchText
  const sourceDefinitions: Array<{
    source: PlayerOddsSourceName
    url: string
    parse: (html: string) => ChanceObservation[]
  }> = [
    {
      source: 'fantagazzetta',
      url: configuredUrl(options.fantagazzettaUrl, 'FANTAZONE_FANTAGAZZETTA_FORMATIONS_URL', DEFAULT_FANTAGAZZETTA_FORMATIONS_URL),
      parse: parseFantagazzettaProbableLineups,
    },
    {
      source: 'gazzetta',
      url: configuredUrl(options.gazzettaUrl, 'FANTAZONE_GAZZETTA_FORMATIONS_URL', DEFAULT_GAZZETTA_FORMATIONS_URL),
      parse: parseGazzettaProbableLineups,
    },
    {
      source: 'injury',
      url: configuredUrl(options.injuryUrl, 'FANTAZONE_INJURY_URL', DEFAULT_FANTACALCIO_INJURY_URL),
      parse: parseFantacalcioInjuries,
    },
  ]

  const sourceResults: PlayerOddsSourceResult[] = []
  const parserResults: ChanceObservation[][] = []
  for (const definition of sourceDefinitions) {
    try {
      const html = await fetchText(definition.url)
      const observations = definition.parse(html)
      parserResults.push(observations)
      sourceResults.push({
        source: definition.source,
        url: definition.url,
        ok: true,
        observations: observations.length,
      })
    } catch (error) {
      sourceResults.push({
        source: definition.source,
        url: definition.url,
        ok: false,
        observations: 0,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (sourceResults.every(result => !result.ok)) {
    return {
      season,
      serieADay,
      path: existing ? targetPath : null,
      snapshot: existing,
      written: false,
      skipped: true,
      reason: 'all-providers-failed',
      sources: sourceResults,
    }
  }

  const snapshot = mergePlayerChances({
    realPlayers,
    existing,
    serieADay,
    parserResults,
  })
  await writeJson(targetPath, snapshot)

  return {
    season,
    serieADay,
    path: targetPath,
    snapshot,
    written: true,
    skipped: false,
    sources: sourceResults,
  }
}

function skipped(
  season: number,
  serieADay: number | null,
  reason: NonNullable<PlayerOddsIngestionResult['reason']>,
): PlayerOddsIngestionResult {
  return {
    season,
    serieADay,
    path: null,
    snapshot: null,
    written: false,
    skipped: true,
    reason,
    sources: [],
  }
}

async function readOptionalCalendar(path: string, season: number): Promise<RealCalendar | null> {
  const value = await readOptionalJson(path)
  return value == null ? null : decodeRealCalendar(value, season)
}

async function readOptionalPlayers(path: string, season: number): Promise<RealPlayers | null> {
  const value = await readOptionalJson(path)
  return value == null ? null : decodeRealPlayers(value, season)
}

async function readOptionalChances(path: string, season: number, day: number): Promise<ChancedRealPlayers | null> {
  const value = await readOptionalJson(path)
  return value == null ? null : decodeChancedRealPlayers(value, season, day)
}

async function readOptionalJson(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown
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
    },
  })
  if (!response.ok) throw new Error(`Player odds source returned HTTP ${response.status} for ${url}`)
  return response.text()
}

function configuredUrl(option: string | undefined, envName: string, fallback: string): string {
  return option?.trim() || process.env[envName]?.trim() || fallback
}

function assertSeason(year: number): void {
  if (!Number.isInteger(year) || year < 1) throw new Error('Season id must be a positive integer')
}

function isFileNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
