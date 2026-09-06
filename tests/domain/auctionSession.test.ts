import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createActiveAuctionPointer,
  validateActiveAuctionPointer,
} from '../../src/domain/src/index'

test('creates one readable active auction pointer per league season', () => {
  const pointer = createActiveAuctionPointer({
    leagueId: 'league-main',
    season: 15,
    auctionId: 'auction-15-main',
    updatedAt: new Date('2026-09-06T20:00:00Z'),
  })

  assert.deepEqual(pointer, {
    version: 1,
    leagueId: 'league-main',
    season: 15,
    auctionId: 'auction-15-main',
    updatedAt: '2026-09-06T20:00:00.000Z',
  })
  assert.doesNotThrow(() => validateActiveAuctionPointer(pointer))
})

test('clears the active auction without inventing another id', () => {
  const pointer = createActiveAuctionPointer({
    leagueId: 'league-main',
    season: 15,
    auctionId: null,
    updatedAt: new Date('2026-09-06T20:05:00Z'),
  })
  assert.equal(pointer.auctionId, null)
})

test('rejects malformed active auction pointers', () => {
  assert.throws(
    () => validateActiveAuctionPointer({
      version: 1,
      leagueId: '',
      season: 15,
      auctionId: null,
      updatedAt: '2026-09-06T20:00:00.000Z',
    }),
    /League id/,
  )
  assert.throws(
    () => createActiveAuctionPointer({ leagueId: 'league', season: 0, auctionId: 'auction' }),
    /positive integer/,
  )
})
