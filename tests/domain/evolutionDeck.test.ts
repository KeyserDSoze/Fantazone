import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DefaultLeagueSetting,
  assignEvolutionCoachDecks,
  cloneLeagueSetting,
  createDefaultFantazoneEvolutionSettings,
  createEvolutionCardCommitment,
  getAuthorizedEvolutionCardIds,
  getEvolutionCardCatalog,
  getEvolutionCoachDeckAvailability,
  isEvolutionCoachDeckSelectionAvailable,
  revealEvolutionCardCommitment,
  type LeagueSetting,
} from '../../src/domain/src/index'

const OWNER = 'owner@example.com'
const LEAGUE = 'league-a'
const YEAR = 15

function settings(deckSize = 4, cardsPerMatch = 1): LeagueSetting {
  const value = cloneLeagueSetting(DefaultLeagueSetting)
  const evolution = createDefaultFantazoneEvolutionSettings()
  evolution.enabled = true
  evolution.coachCards.enabled = true
  evolution.coachCards.cardsInSeasonDeck = deckSize
  evolution.coachCards.cardsPerMatch = cardsPerMatch
  return { ...value, evolution }
}

function revealed(cardIds: string[]) {
  const identity = { leagueId: LEAGUE, year: YEAR, serieADay: 3, owner: OWNER }
  const nonce = '0123456789abcdef'
  const sealed = createEvolutionCardCommitment({
    ...identity,
    cardIds,
    nonce,
    committedAt: '2026-09-20T12:00:00.000Z',
  })
  return revealEvolutionCardCommitment(sealed, {
    ...identity,
    cardIds,
    nonce,
    revealedAt: '2026-09-20T16:00:00.000Z',
  })
}

test('coach decks are deterministic per league season and owner', () => {
  const leagueSettings = settings(20)
  const first = assignEvolutionCoachDecks(LEAGUE, [OWNER, 'other@example.com'], leagueSettings, YEAR, '2026-09-10T10:00:00.000Z')
  const second = assignEvolutionCoachDecks(LEAGUE, ['other@example.com', OWNER], leagueSettings, YEAR, '2026-09-11T10:00:00.000Z')

  assert.equal(first.seed, second.seed)
  assert.deepEqual(first.decks, second.decks)
  for (const deck of first.decks) {
    assert.equal(deck.cards.reduce((sum, card) => sum + card.quantity, 0), 20)
  }
})

test('deck availability consumes revealed copies without going negative', () => {
  const leagueSettings = settings(8)
  const deck = assignEvolutionCoachDecks(LEAGUE, [OWNER], leagueSettings, YEAR, '2026-09-10T10:00:00.000Z')
  const firstCard = deck.decks[0].cards[0]
  assert.ok(firstCard)

  const consumed = Array(firstCard.quantity).fill(firstCard.cardId)
  const before = getEvolutionCoachDeckAvailability(deck, OWNER, consumed.slice(0, -1), false)
  const after = getEvolutionCoachDeckAvailability(deck, OWNER, consumed, false)
  assert.equal(before?.[firstCard.cardId], 1)
  assert.equal(after?.[firstCard.cardId], 0)
  assert.equal(isEvolutionCoachDeckSelectionAvailable(before, [firstCard.cardId]), true)
  assert.equal(isEvolutionCoachDeckSelectionAvailable(after, [firstCard.cardId]), false)
})

test('authoritative card authorization rejects an exhausted but cryptographically valid reveal', () => {
  const leagueSettings = settings(12)
  const deck = assignEvolutionCoachDecks(LEAGUE, [OWNER], leagueSettings, YEAR, '2026-09-10T10:00:00.000Z')
  const firstCard = deck.decks[0].cards[0]
  assert.ok(firstCard)
  const sealed = revealed([firstCard.cardId])

  const allowed = getAuthorizedEvolutionCardIds({
    sealed,
    leagueId: LEAGUE,
    year: YEAR,
    serieADay: 3,
    owner: OWNER,
    settings: leagueSettings,
    deck,
    consumedCardIds: [],
  })
  assert.deepEqual(allowed, [firstCard.cardId])

  const exhausted = getAuthorizedEvolutionCardIds({
    sealed,
    leagueId: LEAGUE,
    year: YEAR,
    serieADay: 3,
    owner: OWNER,
    settings: leagueSettings,
    deck,
    consumedCardIds: Array(firstCard.quantity).fill(firstCard.cardId),
  })
  assert.equal(exhausted, null)
})

test('authoritative card authorization rejects unknown cards and per-match overflow even with valid hashes', () => {
  const unlimited = settings(0, 1)
  const unknown = revealed(['not-in-catalog'])
  assert.equal(getAuthorizedEvolutionCardIds({
    sealed: unknown,
    leagueId: LEAGUE,
    year: YEAR,
    serieADay: 3,
    owner: OWNER,
    settings: unlimited,
    deck: null,
    consumedCardIds: [],
  }), null)

  const knownIds = getEvolutionCardCatalog(unlimited).slice(0, 2).map(card => card.id)
  assert.equal(knownIds.length, 2)
  const overflow = revealed(knownIds)
  assert.equal(getAuthorizedEvolutionCardIds({
    sealed: overflow,
    leagueId: LEAGUE,
    year: YEAR,
    serieADay: 3,
    owner: OWNER,
    settings: unlimited,
    deck: null,
    consumedCardIds: [],
  }), null)
})
