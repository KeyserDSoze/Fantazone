import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { TextDecoder } from 'node:util'
import { fileURLToPath } from 'node:url'
import {
  Behaviour,
  RealCalendarHelper,
  Role,
  createEmptyVote,
  getCurrentSeasonYear,
  getPlayerKey,
  type RealCalendar,
  type RealDay,
  type VotedRealPlayer,
  type VotedRealPlayers,
} from '@fantazone/domain'
import {
  decodeRealCalendar,
  decodeVotedRealPlayers,
  realCalendarDocumentPath,
  serieAVoteDocumentPath,
} from '@fantazone/github'

export const DEFAULT_FANTACALCIO_SIGNED_URI_URL = 'https://www.fantacalcio.it/api/v1/SignedUri'
export const DEFAULT_FANTACALCIO_LIVE_RESOURCE_BASE_URL = 'https://api.fantacalcio.it/v1/st/'
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const UTF8 = new TextDecoder('utf-8')

export type LiveVoteHttpRequest = {
  url: string
  method: 'GET' | 'POST'
  headers: Record<string, string>
  body?: string
  responseType: 'text' | 'bytes'
}

export type LiveVoteHttpResponse = {
  status: number
  text?: string
  bytes?: Uint8Array
}

export type LiveVoteHttpClient = (request: LiveVoteHttpRequest) => Promise<LiveVoteHttpResponse>

export type LiveVoteIngestionOptions = {
  season?: number
  day?: number
  repoRoot?: string
  now?: Date
  signedUriUrl?: string
  resourceBaseUrl?: string
  httpClient?: LiveVoteHttpClient
}

export type LiveVoteIngestionResult = {
  skipped: boolean
  votes: VotedRealPlayers | null
  path: string | null
  incomingPlayers: number
  written: boolean
}

type LiveSourceGame = {
  teamHome: string
  teamAway: string
  playersHome: LiveSourcePlayer[]
  playersAway: LiveSourcePlayer[]
}

type LiveSourcePlayer = {
  name: string
  position: string
  vote: number
  events: number[]
}

/**
 * Legacy-compatible live vote producer: SignedUri -> protobuf -> readable canonical live JSON.
 * With no explicit day it is a no-op unless RealCalendar says a match is actually live.
 */
export async function ingestLiveVotes(
  options: LiveVoteIngestionOptions = {},
): Promise<LiveVoteIngestionResult> {
  const now = options.now ?? new Date()
  const season = options.season ?? getCurrentSeasonYear(now)
  assertSeason(season)
  const repoRoot = options.repoRoot ?? REPO_ROOT
  const calendarPath = resolve(repoRoot, realCalendarDocumentPath(season))
  const calendar = await readRequiredCalendar(calendarPath, season)

  let serieADay = options.day
  if (serieADay == null) {
    const liveDay = RealCalendarHelper.getLiveDay(calendar, now)
    if (!liveDay || !RealCalendarHelper.isLive(calendar, now)) {
      return { skipped: true, votes: null, path: null, incomingPlayers: 0, written: false }
    }
    serieADay = liveDay.serieADay
  }
  assertDay(serieADay)
  const calendarDay = calendar.days.find(day => day.serieADay === serieADay)
  if (!calendarDay) throw new Error(`RealCalendar ${season} non contiene la giornata ${serieADay}.`)

  const incoming = (await fetchLiveVotesFromProvider({
    season,
    serieADay,
    signedUriUrl: options.signedUriUrl,
    resourceBaseUrl: options.resourceBaseUrl,
    httpClient: options.httpClient,
  })).map(player => canonicalizePlayerTeam(player, calendarDay))

  const path = resolve(repoRoot, serieAVoteDocumentPath('live', season, serieADay))
  const existing = await readOptionalLiveVotes(path, season, serieADay)
  if (incoming.length === 0) {
    return {
      skipped: false,
      votes: existing,
      path,
      incomingPlayers: 0,
      written: false,
    }
  }

  const votes = mergeLiveVoteDocuments(existing, {
    year: season,
    serieADay,
    players: incoming,
  })
  await writeJson(path, votes)
  return {
    skipped: false,
    votes,
    path,
    incomingPlayers: incoming.length,
    written: true,
  }
}

export async function fetchLiveVotesFromProvider(input: {
  season: number
  serieADay: number
  signedUriUrl?: string
  resourceBaseUrl?: string
  httpClient?: LiveVoteHttpClient
}): Promise<VotedRealPlayer[]> {
  assertSeason(input.season)
  assertDay(input.serieADay)
  const signedUriUrl = input.signedUriUrl?.trim() ||
    process.env.FANTAZONE_LIVE_SIGNED_URI_URL?.trim() ||
    DEFAULT_FANTACALCIO_SIGNED_URI_URL
  const resourceBaseUrl = input.resourceBaseUrl?.trim() ||
    process.env.FANTAZONE_LIVE_RESOURCE_BASE_URL?.trim() ||
    DEFAULT_FANTACALCIO_LIVE_RESOURCE_BASE_URL
  const httpClient = input.httpClient ?? defaultHttpClient
  const resourceUri = buildLiveVoteResourceUri(resourceBaseUrl, input.season, input.serieADay)

  const signedResponse = await httpClient({
    url: signedUriUrl,
    method: 'POST',
    responseType: 'text',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Fantazone/1.0; +https://fanta.plus)',
      'Content-Type': 'application/json',
      Origin: 'https://www.fantacalcio.it',
      Referer: 'https://www.fantacalcio.it/live-serie-a',
      'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
    },
    body: JSON.stringify({ resourcesUri: [resourceUri] }),
  })
  ensureSuccess(signedResponse.status, signedUriUrl, 'Fantacalcio SignedUri')
  const signedText = signedResponse.text ?? ''
  const signedUri = parseSignedUri(signedText)
  if (!signedUri) return []

  const binaryResponse = await httpClient({
    url: signedUri,
    method: 'GET',
    responseType: 'bytes',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Fantazone/1.0; +https://fanta.plus)',
      Referer: 'https://www.fantacalcio.it/live-serie-a',
    },
  })
  ensureSuccess(binaryResponse.status, signedUri, 'Fantacalcio live protobuf')
  const bytes = binaryResponse.bytes ?? new Uint8Array()
  return mapLiveSourceGames(decodeLiveVoteProtobuf(bytes))
}

export function buildLiveVoteResourceUri(baseUrl: string, season: number, serieADay: number): string {
  assertSeason(season)
  assertDay(serieADay)
  const sourceSeason = season + 6
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  return `${normalizedBase}${sourceSeason}/matches/live/${serieADay}.dat`
}

export function parseSignedUri(value: string): string | null {
  if (/not found/i.test(value)) return null
  if (!value.trim()) return null
  const parsed = JSON.parse(value) as unknown
  return findSignedUri(parsed)
}

/** Minimal schema-specific protobuf decoder for the fields consumed by legacy LiveVote.cs. */
export function decodeLiveVoteProtobuf(bytes: Uint8Array): LiveSourceGame[] {
  if (bytes.length === 0) return []
  const reader = new ProtoReader(bytes)
  const games: LiveSourceGame[] = []
  while (!reader.done) {
    const tag = reader.readTag()
    if (tag.field === 1 && tag.wire === 2) games.push(decodeGame(reader.readBytes()))
    else reader.skip(tag.wire)
  }
  return games
}

export function mapLiveSourceGames(games: LiveSourceGame[]): VotedRealPlayer[] {
  const players: VotedRealPlayer[] = []
  for (const game of games) {
    for (const player of game.playersHome) addPlayer(game.teamHome, player)
    for (const player of game.playersAway) addPlayer(game.teamAway, player)
  }
  return players

  function addPlayer(teamName: string, source: LiveSourcePlayer): void {
    if (!teamName.trim() || !source.name.trim() || !source.position.trim() || source.position === 'ALL') return
    const role = roleFromSource(source.position)
    const events = countEvents(source.events)
    const hasVote = source.vote !== 55
    const vote = {
      ...createEmptyVote(role),
      role,
      value: hasVote ? source.vote : 0,
      isFinal: false,
      goal: eventCount(events, 3),
      penalty: eventCount(events, 9),
      assist: [5, 6, 24, 21, 22, 23].reduce((sum, event) => sum + eventCount(events, event), 0),
      stoppedPenalty: eventCount(events, 7),
      sufferedGoal: eventCount(events, 4),
      wrongedPenalty: eventCount(events, 8),
      ownGoal: eventCount(events, 10),
      manOfTheMatch: eventCount(events, 26) === 1,
      status: events.has(1)
        ? Behaviour.YellowCard
        : events.has(2)
          ? Behaviour.RedCard
          : Behaviour.Nothing,
      hasVote,
      isIn: events.has(15),
      isOut: events.has(14),
    }
    const normalizedName = normalizeSourcePlayerName(source.name)
    players.push({
      name: normalizedName,
      team: {
        name: teamName,
        abbreviation: defaultTeamAbbreviation(teamName),
      },
      role,
      isActive: true,
      visible: true,
      vote,
    })
  }
}

/** Legacy LiveVotesJob updates only Vote for an existing player and appends new players. */
export function mergeLiveVoteDocuments(
  existing: VotedRealPlayers | null | undefined,
  incoming: VotedRealPlayers,
): VotedRealPlayers {
  if (existing && (existing.year !== incoming.year || existing.serieADay !== incoming.serieADay)) {
    throw new Error(
      `Live vote document mismatch: existing ${existing.year}/${existing.serieADay}, incoming ${incoming.year}/${incoming.serieADay}`,
    )
  }
  const players = (existing?.players ?? []).map(cloneVotedPlayer)
  const byKey = new Map<string, VotedRealPlayer>()
  for (const player of players) {
    const key = getPlayerKey(player.name)
    if (key && !byKey.has(key)) byKey.set(key, player)
  }
  for (const incomingPlayer of incoming.players) {
    const key = getPlayerKey(incomingPlayer.name)
    if (!key) continue
    const current = byKey.get(key)
    if (current) {
      current.vote = incomingPlayer.vote ? { ...incomingPlayer.vote } : null
    } else {
      const cloned = cloneVotedPlayer(incomingPlayer)
      players.push(cloned)
      byKey.set(key, cloned)
    }
  }
  return decodeVotedRealPlayers({
    year: incoming.year,
    serieADay: incoming.serieADay,
    players,
  }, incoming.year, incoming.serieADay)
}

function decodeGame(bytes: Uint8Array): LiveSourceGame {
  const reader = new ProtoReader(bytes)
  const game: LiveSourceGame = { teamHome: '', teamAway: '', playersHome: [], playersAway: [] }
  while (!reader.done) {
    const tag = reader.readTag()
    if (tag.field === 13 && tag.wire === 2) game.teamHome = reader.readString()
    else if (tag.field === 14 && tag.wire === 2) game.teamAway = reader.readString()
    else if (tag.field === 15 && tag.wire === 2) game.playersHome.push(decodePlayer(reader.readBytes()))
    else if (tag.field === 16 && tag.wire === 2) game.playersAway.push(decodePlayer(reader.readBytes()))
    else reader.skip(tag.wire)
  }
  return game
}

function decodePlayer(bytes: Uint8Array): LiveSourcePlayer {
  const reader = new ProtoReader(bytes)
  const player: LiveSourcePlayer = { name: '', position: '', vote: 0, events: [] }
  while (!reader.done) {
    const tag = reader.readTag()
    if (tag.field === 2 && tag.wire === 2) player.name = reader.readString()
    else if (tag.field === 3 && tag.wire === 2) player.position = reader.readString()
    else if (tag.field === 4 && tag.wire === 1) player.vote = reader.readDouble()
    else if (tag.field === 4 && tag.wire === 5) player.vote = reader.readFloat()
    else if (tag.field === 5 && tag.wire === 0) player.events.push(reader.readVarint())
    else if (tag.field === 5 && tag.wire === 2) {
      const packed = new ProtoReader(reader.readBytes())
      while (!packed.done) player.events.push(packed.readVarint())
    } else reader.skip(tag.wire)
  }
  return player
}

class ProtoReader {
  private offset = 0

  constructor(private readonly bytes: Uint8Array) {}

  get done(): boolean {
    return this.offset >= this.bytes.length
  }

  readTag(): { field: number; wire: number } {
    const value = this.readVarint()
    const field = Math.floor(value / 8)
    const wire = value & 7
    if (field < 1) throw new Error('Invalid protobuf field number')
    return { field, wire }
  }

  readVarint(): number {
    let result = 0n
    let shift = 0n
    while (true) {
      this.require(1)
      const byte = this.bytes[this.offset++]
      result |= BigInt(byte & 0x7f) << shift
      if ((byte & 0x80) === 0) break
      shift += 7n
      if (shift > 70n) throw new Error('Invalid protobuf varint')
    }
    if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Protobuf integer exceeds safe JavaScript range')
    return Number(result)
  }

  readBytes(): Uint8Array {
    const length = this.readVarint()
    this.require(length)
    const value = this.bytes.slice(this.offset, this.offset + length)
    this.offset += length
    return value
  }

  readString(): string {
    return UTF8.decode(this.readBytes())
  }

  readDouble(): number {
    this.require(8)
    const view = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, 8)
    const value = view.getFloat64(0, true)
    this.offset += 8
    return value
  }

  readFloat(): number {
    this.require(4)
    const view = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, 4)
    const value = view.getFloat32(0, true)
    this.offset += 4
    return value
  }

  skip(wire: number): void {
    switch (wire) {
      case 0:
        this.readVarint()
        return
      case 1:
        this.require(8)
        this.offset += 8
        return
      case 2: {
        const length = this.readVarint()
        this.require(length)
        this.offset += length
        return
      }
      case 5:
        this.require(4)
        this.offset += 4
        return
      default:
        throw new Error(`Unsupported protobuf wire type ${wire}`)
    }
  }

  private require(length: number): void {
    if (!Number.isInteger(length) || length < 0 || this.offset + length > this.bytes.length) {
      throw new Error('Unexpected end of protobuf payload')
    }
  }
}

function parseSignedUriObject(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = parseSignedUriObject(item)
      if (found) return found
    }
    return null
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'signedUri' && typeof child === 'string' && child.trim()) return child
    const found = parseSignedUriObject(child)
    if (found) return found
  }
  return null
}

function findSignedUri(value: unknown): string | null {
  return parseSignedUriObject(value)
}

function canonicalizePlayerTeam(player: VotedRealPlayer, day: RealDay): VotedRealPlayer {
  const teams = day.games.flatMap(game => [game.home, game.away])
  const sourceName = normalizeTeamName(player.team.name)
  const sourceAbbreviation = player.team.abbreviation.trim().toLocaleLowerCase('it-IT')
  const canonical = teams.find(team => normalizeTeamName(team.name) === sourceName)
    ?? teams.find(team => team.abbreviation.trim().toLocaleLowerCase('it-IT') === sourceAbbreviation)
  return canonical ? { ...player, team: { ...canonical } } : player
}

function countEvents(events: number[]): Map<number, number> {
  const counts = new Map<number, number>()
  for (const event of events) counts.set(event, (counts.get(event) ?? 0) + 1)
  return counts
}

function eventCount(events: Map<number, number>, event: number): number {
  return events.get(event) ?? 0
}

function roleFromSource(value: string): Role {
  switch (value.trim().toLocaleLowerCase('it-IT')) {
    case 'p': return Role.GoalKeeper
    case 'd': return Role.Defensor
    case 'c': return Role.Midfielder
    case 'a': return Role.Forward
    default: return Role.Undefined
  }
}

function normalizeSourcePlayerName(value: string): string {
  const normalized = value.trim().toLocaleLowerCase('it-IT')
  if (!normalized) return ''
  return normalized[0].toLocaleUpperCase('it-IT') + normalized.slice(1)
}

function normalizeTeamName(value: string): string {
  return value.trim().toLocaleLowerCase('it-IT')
}

function defaultTeamAbbreviation(name: string): string {
  const normalized = name.trim().toLocaleLowerCase('it-IT')
  return normalized.length < 3 ? normalized : normalized.slice(0, 3)
}

function cloneVotedPlayer(player: VotedRealPlayer): VotedRealPlayer {
  return {
    ...player,
    team: { ...player.team },
    vote: player.vote ? { ...player.vote } : null,
  }
}

async function readRequiredCalendar(path: string, season: number): Promise<RealCalendar> {
  try {
    return decodeRealCalendar(JSON.parse(await readFile(path, 'utf8')), season)
  } catch (error) {
    if (isFileNotFound(error)) throw new Error(`RealCalendar ${season} non trovato in ${path}. Esegui prima ingest-serie-a.`)
    throw error
  }
}

async function readOptionalLiveVotes(path: string, season: number, day: number): Promise<VotedRealPlayers | null> {
  try {
    return decodeVotedRealPlayers(JSON.parse(await readFile(path, 'utf8')), season, day)
  } catch (error) {
    if (isFileNotFound(error)) return null
    throw error
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function defaultHttpClient(request: LiveVoteHttpRequest): Promise<LiveVoteHttpResponse> {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
  })
  if (request.responseType === 'bytes') {
    return { status: response.status, bytes: new Uint8Array(await response.arrayBuffer()) }
  }
  return { status: response.status, text: await response.text() }
}

function ensureSuccess(status: number, url: string, label: string): void {
  if (status < 200 || status >= 300) throw new Error(`${label} returned HTTP ${status} for ${url}`)
}

function assertSeason(year: number): void {
  if (!Number.isInteger(year) || year < 1) throw new Error('Season id must be a positive integer')
}

function assertDay(day: number): void {
  if (!Number.isInteger(day) || day < 1 || day > 38) throw new Error('Serie A day must be between 1 and 38')
}

function isFileNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
