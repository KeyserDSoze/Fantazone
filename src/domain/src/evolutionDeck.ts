import { getEvolutionCardCatalog, resolveFantazoneEvolutionSettings } from './evolution'
import { getVerifiedEvolutionCardIds } from './evolutionCards'
import type { EvolutionCardCommitment } from './evolutionModel'
import type { LeagueSetting } from './group'

export interface EvolutionCoachDeckCard {
  cardId: string
  quantity: number
}

export interface EvolutionCoachDeckAssignment {
  owner: string
  cards: EvolutionCoachDeckCard[]
}

export interface EvolutionSeasonCoachDeckDocument {
  version: 1
  leagueId: string
  year: number
  seed: string
  generatedAt: string
  decks: EvolutionCoachDeckAssignment[]
}

export function assignEvolutionCoachDecks(
  leagueId: string,
  owners: readonly string[],
  settings: LeagueSetting,
  year: number,
  generatedAt = new Date().toISOString(),
  seedOverride?: string,
): EvolutionSeasonCoachDeckDocument {
  if (!leagueId.trim()) throw new Error('Evolution league id is required')
  if (!Number.isInteger(year) || year < 1) throw new Error('Evolution season must be a positive integer')
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error('Evolution deck generatedAt must be an ISO date')

  const evolution = resolveFantazoneEvolutionSettings(settings)
  const seed = seedOverride?.trim() || `${year}:${evolution.ruleEngine.deterministicRandomSeed}:coach-deck`
  const catalog = getEvolutionCardCatalog(settings)
  const count = evolution.enabled && evolution.coachCards.enabled
    ? Math.max(0, evolution.coachCards.cardsInSeasonDeck)
    : 0
  const normalizedOwners = [...new Set(owners.map(normalizeOwner).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  const decks = normalizedOwners.map(owner => ({
    owner,
    cards: drawDeck(catalog, count, createSeededRandom(`${seed}:${leagueId}:${owner}`)),
  }))
  return { version: 1, leagueId, year, seed, generatedAt, decks }
}

/** Null means the league configured cardsInSeasonDeck=0, i.e. unlimited catalog use. */
export function getEvolutionCoachDeckAvailability(
  document: EvolutionSeasonCoachDeckDocument | null | undefined,
  owner: string,
  consumedCardIds: readonly string[],
  unlimited = false,
): Record<string, number> | null {
  if (unlimited) return null
  const assignment = document?.decks.find(item => normalizeOwner(item.owner) === normalizeOwner(owner))
  if (!assignment) return {}
  const available: Record<string, number> = Object.fromEntries(
    assignment.cards.map(item => [item.cardId, Math.max(0, item.quantity)]),
  )
  for (const cardId of consumedCardIds) {
    if (available[cardId] != null) available[cardId] = Math.max(0, available[cardId] - 1)
  }
  return available
}

export function isEvolutionCoachDeckSelectionAvailable(
  availability: Record<string, number> | null,
  cardIds: readonly string[],
): boolean {
  if (availability === null) return true
  const requested = new Map<string, number>()
  for (const cardId of cardIds) requested.set(cardId, (requested.get(cardId) ?? 0) + 1)
  for (const [cardId, quantity] of requested) {
    if ((availability[cardId] ?? 0) < quantity) return false
  }
  return true
}

/**
 * Final authority for a revealed selection. A valid SHA-256 reveal is necessary but
 * not sufficient: the selection must still belong to the enabled catalog, respect
 * the per-match limit and have enough copies left in the owner's seasonal deck.
 */
export function getAuthorizedEvolutionCardIds(input: {
  sealed: EvolutionCardCommitment | null | undefined
  leagueId: string
  year: number
  serieADay: number
  owner: string
  settings: LeagueSetting
  deck: EvolutionSeasonCoachDeckDocument | null | undefined
  consumedCardIds: readonly string[]
}): string[] | null {
  const evolution = resolveFantazoneEvolutionSettings(input.settings)
  if (!evolution.enabled || !evolution.coachCards.enabled) return null

  const cardIds = getVerifiedEvolutionCardIds(input.sealed, {
    leagueId: input.leagueId,
    year: input.year,
    serieADay: input.serieADay,
    owner: input.owner,
  })
  if (!cardIds || cardIds.length === 0 || cardIds.length > evolution.coachCards.cardsPerMatch) return null

  const catalog = new Set(getEvolutionCardCatalog(input.settings).map(card => card.id))
  if (cardIds.some(cardId => !catalog.has(cardId))) return null

  const unlimited = evolution.coachCards.cardsInSeasonDeck === 0
  const availability = getEvolutionCoachDeckAvailability(input.deck, input.owner, input.consumedCardIds, unlimited)
  if (!isEvolutionCoachDeckSelectionAvailable(availability, cardIds)) return null
  return cardIds
}

function drawDeck(
  catalog: ReturnType<typeof getEvolutionCardCatalog>,
  count: number,
  random: () => number,
): EvolutionCoachDeckCard[] {
  if (count <= 0 || catalog.length === 0) return []
  const quantities = new Map<string, number>()
  const weighted = catalog.map(card => ({ card, weight: Math.max(0, card.weight) }))
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0)

  for (let index = 0; index < count; index += 1) {
    let selected = weighted[Math.floor(random() * weighted.length)]?.card
    if (totalWeight > 0) {
      let cursor = random() * totalWeight
      for (const item of weighted) {
        cursor -= item.weight
        if (cursor <= 0) {
          selected = item.card
          break
        }
      }
    }
    if (selected) quantities.set(selected.id, (quantities.get(selected.id) ?? 0) + 1)
  }

  return [...quantities]
    .map(([cardId, quantity]) => ({ cardId, quantity }))
    .sort((a, b) => a.cardId.localeCompare(b.cardId))
}

function createSeededRandom(seed: string): () => number {
  let state = hash32(seed) || 0x9e3779b9
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state / 0x100000000
  }
}

function hash32(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function normalizeOwner(value: string): string {
  return value.trim().toLowerCase()
}
