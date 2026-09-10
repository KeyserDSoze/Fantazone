import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createEvolutionCardCommitment,
  evolutionCardCommitmentHash,
  getVerifiedEvolutionCardIds,
  revealEvolutionCardCommitment,
  verifyEvolutionCardReveal,
} from '../../src/domain/src/index'

const identity = {
  leagueId: 'league-1',
  year: 15,
  serieADay: 1,
  owner: 'OWNER@example.com',
}

const cardIds = ['pressing', 'counter-433']
const nonce = '0123456789abcdef'

test('Evolution card commitment uses deterministic SHA-256 without exposing card ids', () => {
  const hash = evolutionCardCommitmentHash({ ...identity, cardIds, nonce })
  assert.equal(hash, '040d4b2bb84e589834ec30cba7d3fd200420214174a3a9ca8ee8079050382870')

  const sealed = createEvolutionCardCommitment({
    ...identity,
    cardIds,
    nonce,
    committedAt: '2026-09-12T14:00:00.000Z',
    revealAt: '2026-09-12T16:00:00.000Z',
  })
  assert.equal(sealed.commitment, hash)
  assert.equal(sealed.reveal, null)
  assert.equal(JSON.stringify(sealed).includes('pressing'), false)
  assert.equal(JSON.stringify(sealed).includes('counter-433'), false)
})

test('only the exact card reveal bound to league day and owner verifies', () => {
  const sealed = createEvolutionCardCommitment({
    ...identity,
    cardIds,
    nonce,
    committedAt: '2026-09-12T14:00:00.000Z',
  })

  assert.equal(verifyEvolutionCardReveal(sealed, { ...identity, cardIds, nonce }), true)
  assert.equal(verifyEvolutionCardReveal(sealed, { ...identity, cardIds: ['pressing'], nonce }), false)
  assert.equal(verifyEvolutionCardReveal(sealed, { ...identity, owner: 'other@example.com', cardIds, nonce }), false)
  assert.equal(verifyEvolutionCardReveal(sealed, { ...identity, serieADay: 2, cardIds, nonce }), false)
})

test('revealed cards become usable only after cryptographic verification', () => {
  const sealed = createEvolutionCardCommitment({
    ...identity,
    cardIds,
    nonce,
    committedAt: '2026-09-12T14:00:00.000Z',
  })
  assert.equal(getVerifiedEvolutionCardIds(sealed, identity), null)

  const revealed = revealEvolutionCardCommitment(sealed, {
    ...identity,
    cardIds,
    nonce,
    revealedAt: '2026-09-12T16:00:00.000Z',
  })
  assert.deepEqual(getVerifiedEvolutionCardIds(revealed, identity), ['counter-433', 'pressing'])

  const forged = { ...revealed, reveal: { ...revealed.reveal!, cardIds: ['pressing'] } }
  assert.equal(getVerifiedEvolutionCardIds(forged, identity), null)
})
