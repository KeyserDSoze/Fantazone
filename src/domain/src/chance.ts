import type { StatPlayerGame } from './statPlayer'
import {
  cloneRealPlayer,
  getPlayerKey,
  type RealPlayer,
  type RealPlayers,
} from './realPlayer'

export enum ChanceType {
  Normal = 0,
  Injury = 1,
  Warned = 2,
  Disqualified = 3,
  Maybe = 4,
}

export enum TrendType {
  Bad = 0,
  NotBad = 1,
  Normal = 2,
  VeryGood = 3,
  Excellent = 4,
}

export type ChanceSource = 'fantagazzetta' | 'gazzetta' | 'mediaset' | 'sky'

/** Canonical readable availability/probable-formation information. */
export interface Chance {
  fantagazzetta: boolean
  gazzetta: boolean
  mediaset: boolean
  sky: boolean
  status: ChanceType
  description: string | null
  lastGame: StatPlayerGame | null
  trend: TrendType
}

export interface ChancedRealPlayer extends RealPlayer {
  chance: Chance
}

/** One shared snapshot for one Serie A day. */
export interface ChancedRealPlayers {
  year: number
  serieADay: number
  players: ChancedRealPlayer[]
}

export type ChanceMergeInput = {
  realPlayers: RealPlayers
  existing?: ChancedRealPlayers | null
  serieADay: number
  parserResults: ReadonlyArray<readonly ChancedRealPlayer[]>
}

/**
 * Pure port of the useful merge semantics of legacy PlayerOddsJob.
 * Storage/network/parser failures stay outside this reducer.
 */
export function mergePlayerChances(input: ChanceMergeInput): ChancedRealPlayers {
  validateDay(input.serieADay)
  if (input.existing && input.existing.year !== input.realPlayers.year) {
    throw new Error(`Chance year mismatch: expected ${input.realPlayers.year}, found ${input.existing.year}`)
  }
  if (input.existing && input.existing.serieADay !== input.serieADay) {
    throw new Error(`Chance day mismatch: expected ${input.serieADay}, found ${input.existing.serieADay}`)
  }

  const players = input.existing?.players.length
    ? input.existing.players.map(player => ({ ...cloneChancedRealPlayer(player), chance: resetChance(player.chance) }))
    : input.realPlayers.players.map(player => ({
        ...cloneRealPlayer(player),
        chance: defaultChance(),
      }))

  for (const parserPlayers of input.parserResults) {
    for (const parsed of parserPlayers) {
      if (!parsed.name?.trim() || !parsed.team?.name?.trim() || !parsed.chance) continue
      const exactKey = getPlayerKey(parsed.name)
      let target = exactKey
        ? players.find(player => getPlayerKey(player.name) === exactKey)
        : undefined
      target ??= players.find(player => isSameChancePlayer(parsed, player))
      if (!target) continue

      target.chance = {
        ...target.chance,
        fantagazzetta: target.chance.fantagazzetta || parsed.chance.fantagazzetta,
        gazzetta: target.chance.gazzetta || parsed.chance.gazzetta,
        mediaset: target.chance.mediaset || parsed.chance.mediaset,
        sky: target.chance.sky || parsed.chance.sky,
        status: parsed.chance.status,
        description: parsed.chance.description,
      }
    }
  }

  return {
    year: input.realPlayers.year,
    serieADay: input.serieADay,
    players,
  }
}

export function defaultChance(): Chance {
  return {
    fantagazzetta: false,
    gazzetta: false,
    mediaset: false,
    sky: false,
    status: ChanceType.Normal,
    description: null,
    lastGame: null,
    trend: TrendType.Normal,
  }
}

/** Legacy refresh resets current availability sources but preserves historical trend/last-game enrichment. */
export function resetChance(chance?: Chance | null): Chance {
  const previous = chance ?? defaultChance()
  return {
    ...previous,
    fantagazzetta: false,
    gazzetta: false,
    mediaset: false,
    sky: false,
    status: ChanceType.Normal,
    description: null,
  }
}

export function chanceSources(chance: Chance): ChanceSource[] {
  const sources: ChanceSource[] = []
  if (chance.fantagazzetta) sources.push('fantagazzetta')
  if (chance.gazzetta) sources.push('gazzetta')
  if (chance.mediaset) sources.push('mediaset')
  if (chance.sky) sources.push('sky')
  return sources
}

export function chanceAvailabilityLabel(status: ChanceType): string {
  switch (status) {
    case ChanceType.Injury: return 'Infortunato'
    case ChanceType.Warned: return 'Diffidato'
    case ChanceType.Disqualified: return 'Squalificato'
    case ChanceType.Maybe: return 'In dubbio'
    default: return 'Disponibile'
  }
}

/** Fallback matcher preserved from PlayerOddsJob for source spelling differences. */
export function isSameChancePlayer(parsed: Pick<RealPlayer, 'name' | 'team'>, player: Pick<RealPlayer, 'name' | 'team'>): boolean {
  const parsedPlayerName = normalizedLongestNamePart(parsed.name)
  const playerName = normalizedLongestNamePart(player.name)
  if (!parsedPlayerName || !playerName) return false
  if (!(parsedPlayerName.includes(playerName) || playerName.includes(parsedPlayerName))) return false
  return normalizeChanceName(parsed.team.name) === normalizeChanceName(player.team.name)
}

export function normalizeChanceName(value: string): string {
  return decodeBasicHtmlEntities(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’`´]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('it-IT')
}

function normalizedLongestNamePart(name: string): string {
  const longestWord = name.split(/\s+/).filter(Boolean).sort((a, b) => b.length - a.length)[0] ?? ''
  const longestDotPart = longestWord.split('.').filter(Boolean).sort((a, b) => b.length - a.length)[0] ?? ''
  return normalizeChanceName(longestDotPart)
}

function cloneChancedRealPlayer(player: ChancedRealPlayer): ChancedRealPlayer {
  return {
    ...cloneRealPlayer(player),
    chance: {
      ...player.chance,
      lastGame: player.chance.lastGame ? { ...player.chance.lastGame } : null,
    },
  }
}

function decodeBasicHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&apos;|&#39;|&rsquo;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&')
}

function validateDay(day: number): void {
  if (!Number.isInteger(day) || day < 1 || day > 38) throw new Error('Serie A day must be between 1 and 38')
}
