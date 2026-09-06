import assert from 'node:assert/strict'
import test from 'node:test'
import { remainingAuctionSeconds } from '../../src/app/services/auctionCountdown'

test('countdown is idle before the first accepted bid', () => {
  assert.equal(remainingAuctionSeconds(null, 10, new Date('2026-09-06T20:00:00Z')), null)
})

test('countdown rounds remaining time up and reaches zero', () => {
  const started = '2026-09-06T20:00:00.000Z'
  assert.equal(remainingAuctionSeconds(started, 10, new Date('2026-09-06T20:00:00.100Z')), 10)
  assert.equal(remainingAuctionSeconds(started, 10, new Date('2026-09-06T20:00:05.001Z')), 5)
  assert.equal(remainingAuctionSeconds(started, 10, new Date('2026-09-06T20:00:09.999Z')), 1)
  assert.equal(remainingAuctionSeconds(started, 10, new Date('2026-09-06T20:00:10.000Z')), 0)
  assert.equal(remainingAuctionSeconds(started, 10, new Date('2026-09-06T20:00:12.000Z')), 0)
})

test('future host timestamps do not increase the configured duration', () => {
  assert.equal(
    remainingAuctionSeconds('2026-09-06T20:00:01Z', 10, new Date('2026-09-06T20:00:00Z')),
    10,
  )
})

test('invalid timestamps fail closed while invalid durations are rejected', () => {
  assert.equal(remainingAuctionSeconds('not-a-date', 10), 0)
  assert.throws(() => remainingAuctionSeconds(null, 0), /positive/i)
})
