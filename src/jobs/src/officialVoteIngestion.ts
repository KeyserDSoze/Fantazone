import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
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
  type RealPlayer,
  type RealPlayers,
  type RealTeam,
  type VotedRealPlayer,
  type VotedRealPlayers,
} from '@fantazone/domain'
import {
  decodeRealCalendar,
  decodeRealPlayers,
  decodeVotedRealPlayers,
  realCalendarDocumentPath,
  realPlayersDocumentPath,
  serieAVoteDocumentPath,
} from '@fantazone/github'

export const DEFAULT_FANTACALCIO_FINAL_VOTES_BASE_URL = 'https://www.fantacalcio.it/voti-fantacalcio-serie-a/'
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

export type OfficialVoteTextFetcher = (url: string) => Promise<string>

export type FinalVoteIngestionOptions = {
  season?: number
  day?: number
  repoRoot?: string
  baseUrl?: string
  fetchText?: OfficialVoteTextFetcher
  now?: Date
}

export type FinalVoteIngestionResult = {
  votes: VotedRealPlayers
  path: string
  complete: boolean
  expectedPlayedTeams: number
  parsedPlayedTeams: number
  syntheticDelayedPlayers: number
}

/**
 * Produces one canonical `official` vote document from the legacy Fantacalcio source.
 * Parsing/provider concerns stay here; statistics and game calculations consume only readable domain JSON.
 */
export async function ingestFinalVotes(
  options: FinalVoteIngestionOptions = {},
): Promise<FinalVoteIngestionResult> {
  const now = options.now ?? new Date()
  const season = options.season ?? getCurrentSeasonYear(now)
  assertSeason(season)
  const repoRoot = options.repoRoot ?? REPO_ROOT

  const calendarPath = resolve(repoRoot, realCalendarDocumentPath(season))
  const calendar = await readRequiredCalendar(calendarPath, season)
  const serieADay = options.day ?? resolveLegacyFinalVoteDay(calendar, now)
  assertDay(serieADay)
  const calendarDay = calendar.days.find(day => day.serieADay === serieADay)
  if (!calendarDay) throw new Error(`RealCalendar ${season} non contiene la giornata ${serieADay}.`)

  const baseUrl = options.baseUrl?.trim() ||
    process.env.FANTAZONE_FINAL_VOTES_BASE_URL?.trim() ||
    DEFAULT_FANTACALCIO_FINAL_VOTES_BASE_URL
  const fetchText = options.fetchText ?? defaultFetchText
  const sourceUrl = buildOfficialVotesUrl(baseUrl, season, serieADay)
  const parsed = parseOfficialVotesHtml(await fetchText(sourceUrl))
    .map(player => canonicalizePlayerTeam(player, calendarDay))
    .filter(player => Boolean(getPlayerKey(player.name)))

  const expectedPlayedTeams = calendarDay.games.filter(game => !game.delayed).length * 2
  const parsedPlayedTeams = new Set(parsed.map(player => normalizeTeamName(player.team.name))).size
  const complete = parsedPlayedTeams >= expectedPlayedTeams

  const playersByKey = new Map<string, VotedRealPlayer>()
  for (const player of parsed) {
    const key = getPlayerKey(player.name)
    if (!key) continue
    playersByKey.set(key, player)
  }

  const delayedGames = calendarDay.games.filter(game => game.delayed)
  let syntheticDelayedPlayers = 0
  if (delayedGames.length > 0) {
    const masterPlayersPath = resolve(repoRoot, realPlayersDocumentPath(season))
    const masterPlayers = await readOptionalPlayers(masterPlayersPath, season)
    if (masterPlayers) {
      for (const game of delayedGames) {
        syntheticDelayedPlayers += addDelayedTeamPlayers(playersByKey, masterPlayers, game.home)
        syntheticDelayedPlayers += addDelayedTeamPlayers(playersByKey, masterPlayers, game.away)
      }
    }
  }

  const votes = decodeVotedRealPlayers({
    year: season,
    serieADay,
    players: [...playersByKey.values()],
  }, season, serieADay)
  const path = resolve(repoRoot, serieAVoteDocumentPath('official', season, serieADay))
  await writeJson(path, votes)

  return {
    votes,
    path,
    complete,
    expectedPlayedTeams,
    parsedPlayedTeams,
    syntheticDelayedPlayers,
  }
}

/** Legacy FinalVotesJob selected `calendar.LiveDay ?? calendar.LastDay`. */
export function resolveLegacyFinalVoteDay(calendar: RealCalendar, now = new Date()): number {
  const day = RealCalendarHelper.getLiveDay(calendar, now) ?? RealCalendarHelper.getLastDay(calendar, now)
  if (!day) throw new Error(`Nessuna giornata live o conclusa disponibile nel RealCalendar ${calendar.year}.`)
  return day.serieADay
}

export function buildOfficialVotesUrl(baseUrl: string, season: number, serieADay: number): string {
  assertSeason(season)
  assertDay(serieADay)
  const startYear = 2011 + season
  const endYear = 2012 + season
  const seasonLabel = `${startYear}-${String(endYear).slice(-2)}`
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  return `${normalizedBase}${seasonLabel}/${serieADay}`
}

/** Pure HTML parser preserving the useful semantics of legacy OfficialVote.cs. */
export function parseOfficialVotesHtml(html: string): VotedRealPlayer[] {
  const teamsContainer = findFirstTagWithClass(html, 'ul', 'teams')
  if (!teamsContainer) return []
  const body = html.slice(teamsContainer.index)
  const teamAnchors = findTagsWithClass(body, 'a', 'team-name').slice(0, 20)
  const players: VotedRealPlayer[] = []

  for (let teamIndex = 0; teamIndex < teamAnchors.length; teamIndex += 1) {
    const anchor = teamAnchors[teamIndex]
    const next = teamAnchors[teamIndex + 1]
    const section = body.slice(anchor.index, next?.index ?? body.length)
    const rawTeamName = extractAttribute(anchor.tag, 'content')
    const teamName = normalizeSourceTeamName(decodeHtmlEntities(rawTeamName ?? ''))
    if (!teamName) continue

    const tbodyIndex = section.search(/<tbody\b/i)
    if (tbodyIndex < 0) continue
    const teamBody = section.slice(tbodyIndex)
    const playerTags = findTagsWithClass(teamBody, 'div', 'player-item')

    for (let playerIndex = 0; playerIndex < playerTags.length; playerIndex += 1) {
      const start = playerTags[playerIndex].index
      const end = playerTags[playerIndex + 1]?.index ?? teamBody.length
      const element = teamBody.slice(start, end)
      const cells = element.split(/<\/td>/i)
      if (cells.length < 2 || !/\bdata-value\s*=/i.test(cells[1])) continue

      const name = extractPlayerName(element)
      if (!getPlayerKey(name)) continue
      const role = extractRole(element)
      const rawValue = extractFirstDataValue(cells[1])
      const parsedVote = parseLegacyVoteValue(rawValue)
      const bonusValues = extractDataValues(cells[2] ?? '')
      const status = /red-card/i.test(element)
        ? Behaviour.RedCard
        : /yellow-card/i.test(element)
          ? Behaviour.YellowCard
          : Behaviour.Nothing

      let hasVote = parsedVote >= 0 && !containsLegacyNoVoteSentinel(cells[1])
      let value = parsedVote < 0 ? 0 : parsedVote
      if (!hasVote && status !== Behaviour.Nothing) {
        hasVote = true
        value = 6
      }

      const vote = {
        ...createEmptyVote(role),
        role,
        value,
        isFinal: true,
        goal: readLegacyBonus(bonusValues, 0),
        sufferedGoal: readLegacyBonus(bonusValues, 1),
        ownGoal: readLegacyBonus(bonusValues, 2),
        penalty: readLegacyBonus(bonusValues, 3),
        wrongedPenalty: readLegacyBonus(bonusValues, 4),
        stoppedPenalty: readLegacyBonus(bonusValues, 5),
        assist: readLegacyBonus(bonusValues, 6),
        manOfTheMatch: readLegacyBonus(bonusValues, 7) === 1,
        status,
        hasVote,
        isIn: true,
        isOut: false,
      }
      players.push({
        name,
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
  return players
}

function addDelayedTeamPlayers(
  target: Map<string, VotedRealPlayer>,
  masterPlayers: RealPlayers,
  team: RealTeam,
): number {
  let added = 0
  const abbreviation = team.abbreviation.trim().toLocaleLowerCase('it-IT')
  for (const player of masterPlayers.players) {
    if (player.team.abbreviation.trim().toLocaleLowerCase('it-IT') !== abbreviation) continue
    const key = getPlayerKey(player.name)
    if (!key || target.has(key)) continue
    target.set(key, delayedVotePlayer(player))
    added += 1
  }
  return added
}

function delayedVotePlayer(player: RealPlayer): VotedRealPlayer {
  return {
    ...player,
    team: { ...player.team },
    vote: {
      ...createEmptyVote(player.role),
      role: player.role,
      value: 6,
      hasVote: true,
      isFinal: true,
      isIn: false,
      isOut: false,
      status: Behaviour.Nothing,
    },
  }
}

function canonicalizePlayerTeam(player: VotedRealPlayer, day: RealDay): VotedRealPlayer {
  const teams = day.games.flatMap(game => [game.home, game.away])
  const sourceName = normalizeTeamName(player.team.name)
  const sourceAbbreviation = player.team.abbreviation.trim().toLocaleLowerCase('it-IT')
  const canonical = teams.find(team => normalizeTeamName(team.name) === sourceName)
    ?? teams.find(team => team.abbreviation.trim().toLocaleLowerCase('it-IT') === sourceAbbreviation)
  return canonical ? { ...player, team: { ...canonical } } : player
}

function extractPlayerName(element: string): string {
  const exact = /<span\s*>([\s\S]*?)<\/span>/i.exec(element)?.[1]
  if (exact != null) return cleanHtmlText(exact)
  for (const span of element.matchAll(/<span\b([^>]*)>([\s\S]*?)<\/span>/gi)) {
    const attributes = span[1] ?? ''
    if (hasClass(attributes, 'role')) continue
    const text = cleanHtmlText(span[2] ?? '')
    if (text) return text
  }
  return ''
}

function extractRole(element: string): Role {
  for (const span of element.matchAll(/<span\b([^>]*)>/gi)) {
    const attributes = span[1] ?? ''
    if (!hasClass(attributes, 'role')) continue
    return roleFromSource(extractAttribute(attributes, 'data-value'))
  }
  return Role.Undefined
}

function roleFromSource(value: string | null): Role {
  switch (value?.trim().toLocaleLowerCase('it-IT')) {
    case 'a': return Role.Forward
    case 'c': return Role.Midfielder
    case 'd': return Role.Defensor
    case 'p': return Role.GoalKeeper
    default: return Role.Undefined
  }
}

function parseLegacyVoteValue(value: string | null): number {
  if (!value) return -1
  const parsed = Number.parseFloat(value.trim().replace(',', '.'))
  if (!Number.isFinite(parsed) || parsed === 55) return -1
  return parsed
}

function containsLegacyNoVoteSentinel(cell: string): boolean {
  const beforeClose = cell.split(/<\/span>/i)[0] ?? cell
  return /(^|[^0-9])55(?:[,.]0*)?([^0-9]|$)/.test(beforeClose)
}

function extractFirstDataValue(value: string): string | null {
  return extractAttribute(value, 'data-value')
}

function extractDataValues(value: string): string[] {
  const result: string[] = []
  for (const match of value.matchAll(/\bdata-value\s*=\s*["']([^"']*)["']/gi)) {
    result.push(decodeHtmlEntities(match[1] ?? '').trim())
  }
  return result
}

function readLegacyBonus(values: string[], index: number): number {
  const value = values[index]?.trim()
  if (!value || value === '-') return 0
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) ? parsed : 0
}

type TagMatch = { index: number; tag: string; attributes: string }

function findFirstTagWithClass(html: string, tagName: string, className: string): TagMatch | null {
  return findTagsWithClass(html, tagName, className)[0] ?? null
}

function findTagsWithClass(html: string, tagName: string, className: string): TagMatch[] {
  const result: TagMatch[] = []
  const regex = new RegExp(`<${tagName}\\b([^>]*)>`, 'gi')
  for (const match of html.matchAll(regex)) {
    const attributes = match[1] ?? ''
    if (!hasClass(attributes, className) || match.index == null) continue
    result.push({ index: match.index, tag: match[0], attributes })
  }
  return result
}

function hasClass(attributes: string, className: string): boolean {
  const classes = extractAttribute(attributes, 'class')?.split(/\s+/).filter(Boolean) ?? []
  return classes.some(value => value.toLocaleLowerCase('it-IT') === className.toLocaleLowerCase('it-IT'))
}

function extractAttribute(value: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b${escaped}\\s*=\\s*["']([^"']*)["']`, 'i').exec(value)?.[1] ?? null
}

function cleanHtmlText(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"',
    agrave: 'à', egrave: 'è', eacute: 'é', igrave: 'ì', ograve: 'ò', ugrave: 'ù',
  }
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (original, entity: string) => {
    if (entity[0] === '#') {
      const hexadecimal = entity[1]?.toLocaleLowerCase() === 'x'
      const raw = entity.slice(hexadecimal ? 2 : 1)
      const codePoint = Number.parseInt(raw, hexadecimal ? 16 : 10)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : original
    }
    return named[entity.toLocaleLowerCase()] ?? original
  })
}

function normalizeSourceTeamName(value: string): string {
  const normalized = value.trim().toLocaleLowerCase('it-IT')
  if (!normalized) return ''
  return normalized[0].toLocaleUpperCase('it-IT') + normalized.slice(1)
}

function normalizeTeamName(value: string): string {
  return value.trim().toLocaleLowerCase('it-IT')
}

function defaultTeamAbbreviation(name: string): string {
  return name.length < 3 ? name.toLocaleLowerCase('it-IT') : name.toLocaleLowerCase('it-IT').slice(0, 3)
}

async function readRequiredCalendar(path: string, season: number): Promise<RealCalendar> {
  try {
    return decodeRealCalendar(JSON.parse(await readFile(path, 'utf8')), season)
  } catch (error) {
    if (isFileNotFound(error)) throw new Error(`RealCalendar ${season} non trovato in ${path}. Esegui prima ingest-serie-a.`)
    throw error
  }
}

async function readOptionalPlayers(path: string, season: number): Promise<RealPlayers | null> {
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
  if (!response.ok) throw new Error(`Fantacalcio final-votes source returned HTTP ${response.status} for ${url}`)
  return response.text()
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
