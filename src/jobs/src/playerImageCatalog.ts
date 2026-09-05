import { Role, getSeasonYearRange, type RealPlayer } from '@fantazone/domain'

export const LEGA_SERIE_A_COMPETITION_ID = 'serie-a::Football_Competition::ec93b94f74294dc98ab5bcfd67fc0d88'

export interface SdpSeason {
  seasonId: string
  seasonName: string
}

export interface SdpPagination {
  totalPages: number
  isLastPage: boolean
}

export interface SdpTeam {
  shortName: string | null
  officialName: string | null
  acronymName: string | null
}

export interface SdpPlayer {
  role: number
  mediaFirstName: string | null
  mediaLastName: string | null
  shortName: string | null
  displayName: string | null
  team: SdpTeam | null
  imagery: Record<string, string | null> | null
}

export interface SdpPlayersPage {
  pagination: SdpPagination | null
  players: SdpPlayer[]
}

export function fullSeasonLabel(year: number): string {
  const { startYear, endYear } = getSeasonYearRange(year)
  return `${startYear}/${endYear}`
}

export function decodeSdpSeasons(value: unknown): SdpSeason[] {
  if (!value || typeof value !== 'object') return []
  const seasons = (value as { seasons?: unknown }).seasons
  if (!Array.isArray(seasons)) return []
  return seasons.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const season = item as { seasonId?: unknown; seasonName?: unknown }
    if (typeof season.seasonId !== 'string' || typeof season.seasonName !== 'string') return []
    return [{ seasonId: season.seasonId, seasonName: season.seasonName }]
  })
}

export function decodeSdpPlayersPage(value: unknown): SdpPlayersPage {
  if (!value || typeof value !== 'object') return { pagination: null, players: [] }
  const page = value as { pagination?: unknown; players?: unknown }
  const pagination = decodePagination(page.pagination)
  const players = Array.isArray(page.players)
    ? page.players.flatMap(decodeSdpPlayer)
    : []
  return { pagination, players }
}

export function selectSdpImagePath(player: SdpPlayer): string | null {
  const imagery = player.imagery
  if (!imagery) return null
  const entries = Object.entries(imagery).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0)
  return entries.find(([key]) => key.toLocaleLowerCase('it-IT').endsWith('_middle'))?.[1]
    ?? entries.find(([key]) => key.toLocaleLowerCase('it-IT').endsWith('_celeb'))?.[1]
    ?? entries[0]?.[1]
    ?? null
}

/** Pure parity port of legacy PlayerImagesJob.FindImagePath. */
export function findSdpImagePath(player: RealPlayer, imagePlayers: readonly SdpPlayer[]): string | null {
  const normalizedName = normalizePlayerImageName(player.name)
  const normalizedTeam = normalizePlayerImageName(player.team?.name)
  const role = legacySdpRole(player.role)
  const candidates = imagePlayers
    .map(item => ({ player: item, imagePath: selectSdpImagePath(item) }))
    .filter((item): item is { player: SdpPlayer; imagePath: string } => item.imagePath != null)

  const exact = candidates.find(candidate =>
    playerNames(candidate.player).some(name => normalizePlayerImageName(name) === normalizedName) &&
    (role === 0 || candidate.player.role === role) &&
    (!normalizedTeam || teamNames(candidate.player).some(team => normalizePlayerImageName(team) === normalizedTeam)))
    ?? candidates.find(candidate =>
      playerNames(candidate.player).some(name => normalizePlayerImageName(name) === normalizedName) &&
      (role === 0 || candidate.player.role === role))
  return exact?.imagePath ?? null
}

export function normalizePlayerImageName(input: string | null | undefined): string {
  if (!input?.trim()) return ''
  return decodeHtmlEntities(input)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’`´]/g, '')
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('it-IT')
    .trim()
}

function legacySdpRole(role: Role): number {
  switch (role) {
    case Role.GoalKeeper: return 1
    case Role.Defensor: return 2
    case Role.Midfielder: return 3
    case Role.Forward: return 4
    default: return 0
  }
}

function playerNames(player: SdpPlayer): Array<string | null> {
  const composite = `${player.mediaFirstName ?? ''} ${player.mediaLastName ?? ''}`.trim()
  return [player.shortName, player.displayName, composite || null]
}

function teamNames(player: SdpPlayer): Array<string | null> {
  return [player.team?.shortName ?? null, player.team?.officialName ?? null, player.team?.acronymName ?? null]
}

function decodePagination(value: unknown): SdpPagination | null {
  if (!value || typeof value !== 'object') return null
  const pagination = value as { totalPages?: unknown; isLastPage?: unknown }
  if (typeof pagination.totalPages !== 'number' || !Number.isInteger(pagination.totalPages) || typeof pagination.isLastPage !== 'boolean') return null
  return { totalPages: pagination.totalPages, isLastPage: pagination.isLastPage }
}

function decodeSdpPlayer(value: unknown): SdpPlayer[] {
  if (!value || typeof value !== 'object') return []
  const player = value as Record<string, unknown>
  const role = typeof player.role === 'number' && Number.isInteger(player.role) ? player.role : 0
  const team = decodeSdpTeam(player.team)
  const imagery = decodeImagery(player.imagery)
  return [{
    role,
    mediaFirstName: stringOrNull(player.mediaFirstName),
    mediaLastName: stringOrNull(player.mediaLastName),
    shortName: stringOrNull(player.shortName),
    displayName: stringOrNull(player.displayName),
    team,
    imagery,
  }]
}

function decodeSdpTeam(value: unknown): SdpTeam | null {
  if (!value || typeof value !== 'object') return null
  const team = value as Record<string, unknown>
  return {
    shortName: stringOrNull(team.shortName),
    officialName: stringOrNull(team.officialName),
    acronymName: stringOrNull(team.acronymName),
  }
}

function decodeImagery(value: unknown): Record<string, string | null> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const result: Record<string, string | null> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' || item === null) result[key] = item
  }
  return result
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&apos;|&#39;|&rsquo;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&')
}
