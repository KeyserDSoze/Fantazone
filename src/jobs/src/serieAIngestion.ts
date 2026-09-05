import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getCurrentSeasonYear, type RealCalendar, type RealDay, type RealGame } from '@fantazone/domain'
import { realCalendarDocumentPath } from '@fantazone/github'

export const DEFAULT_GAZZETTA_CALENDAR_BASE_URL = 'https://api2-mtc.gazzetta.it/api/'
const SERIE_A_COMPETITION_ID = '21'
const FOOTBALL_SPORT_ID = '1'
const FIRST_SERIE_A_DAY = 1
const LAST_SERIE_A_DAY = 38
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

export type JsonFetcher = (url: string) => Promise<unknown>

export type SerieACalendarIngestionOptions = {
  season?: number
  day?: number
  baseUrl?: string
  repoRoot?: string
  fetchJson?: JsonFetcher
  now?: Date
}

type GazzettaCalendarResponse = {
  data?: {
    games?: Array<{
      matches?: GazzettaMatch[] | null
    }> | null
  } | null
}

type GazzettaMatch = {
  utcDate?: string | null
  awayTeam?: GazzettaTeam | null
  homeTeam?: GazzettaTeam | null
  status?: string | null
}

type GazzettaTeam = {
  shortTeamName?: string | null
  teamName?: string | null
  score?: number | null
}

export async function ingestSerieACalendar(
  options: SerieACalendarIngestionOptions = {},
): Promise<{ calendar: RealCalendar; path: string }> {
  const now = options.now ?? new Date()
  const currentSeason = getCurrentSeasonYear(now)
  const season = options.season ?? currentSeason
  validateSeason(season)
  if (season !== currentSeason) {
    throw new Error(
      `La sorgente calendario configurata espone la stagione corrente (${currentSeason}); non può essere salvata come stagione ${season}.`,
    )
  }

  const day = options.day
  if (day != null) validateDay(day)
  const repoRoot = options.repoRoot ?? REPO_ROOT
  const outputPath = resolve(repoRoot, realCalendarDocumentPath(season))
  const fetchJson = options.fetchJson ?? defaultFetchJson
  const baseUrl = options.baseUrl?.trim() ||
    process.env.FANTAZONE_SERIE_A_CALENDAR_BASE_URL?.trim() ||
    DEFAULT_GAZZETTA_CALENDAR_BASE_URL

  let calendar: RealCalendar
  if (day == null) {
    calendar = await fetchFullCalendar({ season, baseUrl, fetchJson })
  } else {
    const existing = await readExistingCalendar(outputPath)
    if (!existing) {
      throw new Error(
        `Il calendario ${season} non esiste ancora. Esegui prima ingest-serie-a senza day per creare le 38 giornate.`,
      )
    }
    const updatedDay = await fetchCalendarDay({ season, serieADay: day, baseUrl, fetchJson })
    if (!updatedDay) throw new Error(`La sorgente non ha restituito partite valide per la giornata ${day}.`)
    calendar = replaceDay(existing, updatedDay)
  }

  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(calendar, null, 2)}\n`, 'utf8')
  return { calendar, path: outputPath }
}

export async function fetchFullCalendar(input: {
  season: number
  baseUrl: string
  fetchJson: JsonFetcher
}): Promise<RealCalendar> {
  const days: RealDay[] = []
  for (let serieADay = FIRST_SERIE_A_DAY; serieADay <= LAST_SERIE_A_DAY; serieADay += 1) {
    const day = await fetchCalendarDay({ ...input, serieADay })
    if (day) days.push(day)
  }
  if (days.length === 0) throw new Error('La sorgente Serie A non ha restituito nessuna giornata valida.')
  return { year: input.season, days }
}

export async function fetchCalendarDay(input: {
  season: number
  serieADay: number
  baseUrl: string
  fetchJson: JsonFetcher
}): Promise<RealDay | null> {
  validateDay(input.serieADay)
  const response = await input.fetchJson(buildCalendarDayUrl(input.baseUrl, input.serieADay))
  return mapGazzettaCalendarDay(response, input.season, input.serieADay)
}

export function mapGazzettaCalendarDay(value: unknown, season: number, serieADay: number): RealDay | null {
  validateSeason(season)
  validateDay(serieADay)
  if (!value || typeof value !== 'object') return null
  const response = value as GazzettaCalendarResponse
  const groups = response.data?.games
  if (!Array.isArray(groups)) return null

  const games: RealGame[] = []
  for (const group of groups) {
    if (!Array.isArray(group?.matches)) continue
    for (const match of group.matches) {
      const mapped = mapMatch(match)
      if (mapped) games.push(mapped)
    }
  }
  return games.length > 0 ? { year: season, serieADay, games } : null
}

export function buildCalendarDayUrl(baseUrl: string, serieADay: number): string {
  validateDay(serieADay)
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  const url = new URL('v1/sports/calendar', normalizedBase)
  url.searchParams.set('day', String(serieADay))
  url.searchParams.set('sportId', FOOTBALL_SPORT_ID)
  url.searchParams.set('competitionId', SERIE_A_COMPETITION_ID)
  return url.toString()
}

function mapMatch(match: GazzettaMatch): RealGame | null {
  const homeName = normalizeTeamName(match?.homeTeam?.teamName)
  const awayName = normalizeTeamName(match?.awayTeam?.teamName)
  if (!homeName || !awayName) return null

  const date = normalizeInstant(match.utcDate)
  const status = match.status?.trim().toUpperCase() ?? ''
  const hasScore = status === 'FULL' || status === 'LIVE'
  return {
    home: {
      name: homeName,
      abbreviation: normalizeAbbreviation(match.homeTeam?.shortTeamName),
    },
    away: {
      name: awayName,
      abbreviation: normalizeAbbreviation(match.awayTeam?.shortTeamName),
    },
    date,
    homeGoals: hasScore ? finiteScore(match.homeTeam?.score) : null,
    awayGoals: hasScore ? finiteScore(match.awayTeam?.score) : null,
    delayed: status === 'POSTPONED',
  }
}

function replaceDay(calendar: RealCalendar, replacement: RealDay): RealCalendar {
  if (calendar.year !== replacement.year) {
    throw new Error(`Il calendario esistente è della stagione ${calendar.year}, non ${replacement.year}.`)
  }
  const days = calendar.days.filter(day => day.serieADay !== replacement.serieADay)
  days.push(replacement)
  days.sort((a, b) => a.serieADay - b.serieADay)
  return { year: calendar.year, days }
}

async function readExistingCalendar(path: string): Promise<RealCalendar | null> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as RealCalendar
    if (!value || !Number.isInteger(value.year) || !Array.isArray(value.days)) {
      throw new Error(`Calendario esistente non valido: ${path}`)
    }
    return value
  } catch (error) {
    if (isFileNotFound(error)) return null
    throw error
  }
}

async function defaultFetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Fantazone/1.0; +https://fanta.plus)',
      'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
      'Cache-Control': 'no-cache',
      Referer: 'https://www.gazzetta.it/calcio/serie-a/calendario-risultati/',
    },
  })
  if (!response.ok) {
    throw new Error(`Serie A calendar source returned HTTP ${response.status} for ${url}`)
  }
  return response.json() as Promise<unknown>
}

function normalizeTeamName(value: string | null | undefined): string {
  const normalized = value?.trim().toLocaleLowerCase('it-IT') ?? ''
  if (!normalized) return ''
  return normalized[0].toLocaleUpperCase('it-IT') + normalized.slice(1)
}

function normalizeAbbreviation(value: string | null | undefined): string {
  return value?.trim().toLocaleLowerCase('it-IT') ?? ''
}

function normalizeInstant(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function finiteScore(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function validateSeason(season: number): void {
  if (!Number.isInteger(season) || season < 1) throw new Error('Season id must be a positive integer')
}

function validateDay(day: number): void {
  if (!Number.isInteger(day) || day < FIRST_SERIE_A_DAY || day > LAST_SERIE_A_DAY) {
    throw new Error(`Serie A day must be between ${FIRST_SERIE_A_DAY} and ${LAST_SERIE_A_DAY}`)
  }
}

function isFileNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
