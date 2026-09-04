import assert from 'node:assert/strict'
import test from 'node:test'
import { MarketHelper, MarketStatus, MarketStatusHelper } from '../../src/domain/src/marketRules'

const createMarket = (overrides: Record<string, unknown> = {}) => ({
  id: 'market',
  buyer: 'buyer@test.local',
  seller: 'seller@test.local',
  buyerPlayers: [{ price: 10 }],
  sellerPlayers: [{ price: 20 }],
  moneyFromBuyer: 5,
  moneyFromSeller: 2,
  approvers: ['buyer@test.local', 'seller@test.local'],
  deniers: [] as string[],
  status: MarketStatus.Pending,
  creationTime: new Date('2026-08-29T10:00:00Z'),
  ...overrides,
})

test('treats every terminal market status as completed', () => {
  const terminalStatuses = [MarketStatus.Approved, MarketStatus.Denied, MarketStatus.Cancelled, MarketStatus.NoMoney, MarketStatus.NoPlayers, MarketStatus.Expired]
  assert.equal(MarketStatusHelper.isCompleted(MarketStatus.Pending), false)
  terminalStatuses.forEach(status => assert.equal(MarketStatusHelper.isCompleted(status), true))
})

test('filters market participation and votes case-insensitively', () => {
  const market = createMarket({ approvers: ['BUYER@test.local', 'voter@test.local'] })
  assert.equal(MarketHelper.isUserInvolved(market, 'Buyer@Test.Local'), true)
  assert.equal(MarketHelper.hasUserVoted(market, 'VOTER@test.local'), true)
  assert.equal(MarketHelper.getUserVote(market, 'voter@test.local'), 'approve')
  assert.deepEqual(MarketHelper.getMarketsForUser([market], 'SELLER@test.local'), [market])
})

test('returns only neutral users who have not voted for approval', () => {
  const pending = createMarket()
  const alreadyVoted = createMarket({ id: 'voted', approvers: [...pending.approvers, 'neutral@test.local'] })
  const completed = createMarket({ id: 'completed', status: MarketStatus.Approved })
  assert.deepEqual(MarketHelper.getPendingMarketsForApproval([pending], 'neutral@test.local'), [pending])
  assert.deepEqual(MarketHelper.getPendingMarketsForApproval([pending], pending.buyer), [])
  assert.deepEqual(MarketHelper.getPendingMarketsForApproval([alreadyVoted, completed], 'neutral@test.local'), [])
})

test('calculates exchanged value from trusted player prices and money', () => {
  assert.deepEqual(MarketHelper.getTotalValue(createMarket()), { buyerGives: 15, sellerGives: 22 })
})

test('sorts copies without mutating the source list', () => {
  const older = createMarket({ id: 'older', creationTime: new Date('2026-08-28T10:00:00Z') })
  const newer = createMarket({ id: 'newer', creationTime: new Date('2026-08-29T10:00:00Z') })
  const source = [older, newer]
  assert.deepEqual(MarketHelper.sortByNewest(source).map(market => market.id), ['newer', 'older'])
  assert.deepEqual(MarketHelper.sortByOldest(source).map(market => market.id), ['older', 'newer'])
  assert.deepEqual(source.map(market => market.id), ['older', 'newer'])
})

test('uses absolute majority and counts implicit participant approvals', () => {
  const market = createMarket()
  assert.equal(MarketHelper.calculateQuorum(4), 3)
  assert.equal(MarketHelper.hasReachedApprovalQuorum(market, 4), false)
  market.approvers.push('neutral@test.local')
  assert.equal(MarketHelper.hasReachedApprovalQuorum(market, 4), true)
  market.deniers = ['one@test.local', 'two@test.local', 'three@test.local']
  assert.equal(MarketHelper.hasReachedDenialQuorum(market, 4), true)
})
