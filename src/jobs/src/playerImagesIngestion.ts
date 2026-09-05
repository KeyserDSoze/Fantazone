import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getCurrentSeasonYear, getPlayerKey, type RealPlayers } from '@fantazone/domain'
import { decodeRealPlayers, realPlayersDocumentPath } from '@fantazone/github'
import {
  LEGA_SERIE_A_COMPETITION_ID,
  decodeSdpPlayersPage,
  decodeSdpSeasons,
  findSdpImagePath,
  fullSeasonLabel,
  type SdpPlayer,
} from './playerImageCatalog'

export const DEFAULT_PLAYER_IMAGES_API_BASE_URL = 'https://api-sdp.legaseriea.it/v1/serie-a/football/'
export const DEFAULT_PLAYER_IMAGES_MEDIA_BASE_URL = 'https://media-sdp.legaseriea.it/'
export const PLAYER_IMAGES_PUBLIC_ROOT = 'src/app/public/images/players'

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const MAX_CATALOG_PAGES = 100

export type JsonFetcher = (url: string) => Promise<unknown>
export type BinaryFetcher = (url: string) => Promise<Uint8Array>

export type PlayerImagesIngestionOptions = {
  season?: number
  repoRoot?: string
  apiBaseUrl?: string
  mediaBaseUrl?: string
  fetchJson?: JsonFetcher
  fetchBinary?: BinaryFetcher
  delayMs?: number
  now?: Date
}

export type PlayerImagesIngestionResult = {
  season: number
  written: number
  existing: number
  unmatched: number
  failed: number
  skipped: boolean
  reason?: 'players-missing' | 'season-catalog-unavailable' | 'current-season-missing'
  outputDirectory: string
}

/** Global replacement for legacy PlayerImagesJob, writing directly into Expo public static files. */
export async function ingestPlayerImages(options: PlayerImagesIngestionOptions = {}): Promise<PlayerImagesIngestionResult> {
  const now = options.now ?? new Date()
  const season = options.season ?? getCurrentSeasonYear(now)
  assertSeason(season)
  const repoRoot = options.repoRoot ?? REPO_ROOT
  const outputDirectory = resolve(repoRoot, PLAYER_IMAGES_PUBLIC_ROOT)
  const players = await readPlayers(resolve(repoRoot, realPlayersDocumentPath(season)), season)
  if (!players?.players.length) return emptyResult(season, outputDirectory, 'players-missing')

  const apiBaseUrl = ensureTrailingSlash(options.apiBaseUrl?.trim() || process.env.FANTAZONE_PLAYER_IMAGES_API_BASE_URL?.trim() || DEFAULT_PLAYER_IMAGES_API_BASE_URL)
  const mediaBaseUrl = ensureTrailingSlash(options.mediaBaseUrl?.trim() || process.env.FANTAZONE_PLAYER_IMAGES_MEDIA_BASE_URL?.trim() || DEFAULT_PLAYER_IMAGES_MEDIA_BASE_URL)
  const fetchJson = options.fetchJson ?? defaultFetchJson
  const fetchBinary = options.fetchBinary ?? defaultFetchBinary

  let seasons
  try {
    seasons = decodeSdpSeasons(await fetchJson(
      new URL(`competitions/${encodeURIComponent(LEGA_SERIE_A_COMPETITION_ID)}/seasons?locale=it-IT`, apiBaseUrl).toString(),
    ))
  } catch {
    return emptyResult(season, outputDirectory, 'season-catalog-unavailable')
  }

  const current = seasons.find(item => item.seasonName === fullSeasonLabel(season))
  if (!current) return emptyResult(season, outputDirectory, 'current-season-missing')

  let catalog: SdpPlayer[]
  try {
    catalog = await fetchCatalog(current.seasonId, apiBaseUrl, fetchJson)
    const previous = seasons.find(item => item.seasonName === fullSeasonLabel(season - 1))
    if (previous) catalog.push(...await fetchCatalog(previous.seasonId, apiBaseUrl, fetchJson))
  } catch {
    return emptyResult(season, outputDirectory, 'season-catalog-unavailable')
  }

  let written = 0
  let existing = 0
  let unmatched = 0
  let failed = 0
  const delayMs = Math.max(0, options.delayMs ?? 30)

  for (const player of players.players) {
    const key = getPlayerKey(player.name)
    if (!key) {
      unmatched += 1
      continue
    }
    const outputPath = resolve(outputDirectory, `${key}.webp`)
    if (await fileExists(outputPath)) {
      existing += 1
      continue
    }
    const imagePath = findSdpImagePath(player, catalog)
    if (!imagePath) {
      unmatched += 1
      continue
    }

    try {
      const bytes = await fetchBinary(new URL(imagePath, mediaBaseUrl).toString())
      if (!isWebp(bytes)) throw new Error(`Provider image for ${player.name} is not WebP`)
      await mkdir(dirname(outputPath), { recursive: true })
      await writeFile(outputPath, bytes)
      written += 1
    } catch {
      failed += 1
      continue
    }
    if (delayMs > 0) await sleep(delayMs)
  }

  return { season, written, existing, unmatched, failed, skipped: false, outputDirectory }
}

export function playerImagePublicPath(playerName: string): string {
  const key = getPlayerKey(playerName) || 'default'
  return `/images/players/${key}.webp`
}

export function isWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false
  return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP'
}

async function fetchCatalog(seasonId: string, apiBaseUrl: string, fetchJson: JsonFetcher): Promise<SdpPlayer[]> {
  const players: SdpPlayer[] = []
  for (let page = 1; page <= MAX_CATALOG_PAGES; page += 1) {
    const url = new URL(
      `seasons/${encodeURIComponent(seasonId)}/stats/players?category=General&page=${page}&locale=it-IT`,
      apiBaseUrl,
    ).toString()
    const response = decodeSdpPlayersPage(await fetchJson(url))
    players.push(...response.players)
    if (!response.pagination || response.pagination.isLastPage || page >= response.pagination.totalPages) break
  }
  return players
}

async function readPlayers(path: string, season: number): Promise<RealPlayers | null> {
  try {
    return decodeRealPlayers(JSON.parse(await readFile(path, 'utf8')), season)
  } catch (error) {
    if (isFileNotFound(error)) return null
    throw error
  }
}

function emptyResult(
  season: number,
  outputDirectory: string,
  reason: NonNullable<PlayerImagesIngestionResult['reason']>,
): PlayerImagesIngestionResult {
  return { season, written: 0, existing: 0, unmatched: 0, failed: 0, skipped: true, reason, outputDirectory }
}

async function defaultFetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: providerHeaders() })
  if (!response.ok) throw new Error(`Lega Serie A player catalog returned HTTP ${response.status} for ${url}`)
  return response.json() as Promise<unknown>
}

async function defaultFetchBinary(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { headers: providerHeaders() })
  if (!response.ok) throw new Error(`Lega Serie A image returned HTTP ${response.status} for ${url}`)
  return new Uint8Array(await response.arrayBuffer())
}

function providerHeaders(): Record<string, string> {
  return {
    'User-Agent': 'Mozilla/5.0 (compatible; Fantazone/1.0; +https://fanta.plus)',
    'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cache-Control': 'no-cache',
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end))
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolvePromise => setTimeout(resolvePromise, ms))
}

function assertSeason(year: number): void {
  if (!Number.isInteger(year) || year < 1) throw new Error('Season id must be a positive integer')
}

function isFileNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
