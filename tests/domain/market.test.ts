import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DefaultLeagueSetting,
  FantaSoccerRole,
  IdentityRole,
  LeagueType,
  MarketStatus,
  MarketType,
  PlayerInTeamStatus,
  Role,
  emptyMarketWrapper,
  expirePendingMarkets,
  processMarketCommand,
  type Group,
  type MarketCommand,
  type MarketTeams,
  type Player,
  type Team,
} from '../../src/domain/src/index'

const SEASON = 15
const NOW = new Date('2026-09-06T12:00:00Z')
const BUYER = 'buyer@example.com'
const SELLER = 'seller@example.com'
const VOTER = 'voter@example.com'
const FOURTH = 'fourth@example.com'
const FIFTH = 'fifth@example.com'
const SIXTH = 'sixth@example.com'

function group(market = MarketType.WithVote, startingMoney = 100): Group {
  return {
    id: 'g',
    name: 'Group',
    users: [BUYER, SELLER, VOTER, FOURTH].map(email => ({ username: email, email, role: IdentityRole.Participant })),
    baskets: [{
      id: 'main',
      name: 'Main',
      years: [{ year: SEASON, teams: [BUYER, SELLER, VOTER, FOURTH].map(email => ({ name: email, owner: email, additionalOwners: [] })) }],
    }],
    leagues: [{
      id: 'league',
      name: 'League',
      isMain: true,
      type: LeagueType.League,
      basketsId: ['main'],
      years: [{
        year: SEASON,
        type: LeagueType.League,
        settings: { ...DefaultLeagueSetting, startingMoney, market },
      }],
    }],
  }
}

function teams(buyerPrice = 10, sellerPrice = 20): MarketTeams {
  return new Map([
    [BUYER, { basketId: 'main', team: team(BUYER, player('Buyer Forward', buyerPrice, FantaSoccerRole.Forward)) }],
    [SELLER, { basketId: 'main', team: team(SELLER, player('Seller Forward', sellerPrice, FantaSoccerRole.FirstBackupForward)) }],
    [VOTER, { basketId: 'main', team: team(VOTER, player('Voter Forward', 5, FantaSoccerRole.Forward)) }],
    [FOURTH, { basketId: 'main', team: team(FOURTH, player('Fourth Forward', 5, FantaSoccerRole.Forward)) }],
  ])
}

function createCommand(): MarketCommand {
  return {
    version: 1,
    id: 'market-1',
    kind: 'create',
    leagueId: 'league',
    season: SEASON,
    actor: BUYER,
    requestedAt: NOW.toISOString(),
    status: 'pending',
    create: {
      buyer: BUYER,
      seller: SELLER,
      buyerPlayerKeys: ['buyerforward'],
      sellerPlayerKeys: ['sellerforward'],
      moneyFromBuyer: 3,
      moneyFromSeller: 1,
    },
  }
}

function process(
  command: MarketCommand,
  market = emptyMarketWrapper(),
  teamState = teams(),
  marketType = MarketType.WithVote,
  startingMoney = 100,
  groupState: Group = group(marketType, startingMoney),
) {
  return processMarketCommand({
    group: groupState,
    leagueId: 'league',
    season: SEASON,
    command,
    market,
    teams: teamState,
    now: NOW,
    currentSeason: SEASON,
  })
}

test('create stores trusted player snapshots and starts with buyer + seller approvals', () => {
  const result = process(createCommand())
  assert.equal(result.command.status, 'applied')
  assert.equal(result.market.markets.length, 1)
  const market = result.market.markets[0]
  assert.equal(market.status, MarketStatus.Pending)
  assert.deepEqual(market.approvers, [BUYER, SELLER])
  assert.equal(market.buyerPlayers[0].price, 10)
  assert.equal(market.sellerPlayers[0].price, 20)
  assert.deepEqual(result.changedTeams, [])
})

test('neutral approval reaches absolute majority and atomically swaps players, positions and money', () => {
  const created = process(createCommand())
  const approval: MarketCommand = {
    version: 1, id: 'approve-1', kind: 'approve', leagueId: 'league', season: SEASON,
    actor: VOTER, requestedAt: NOW.toISOString(), status: 'pending', marketId: 'market-1',
  }
  const result = process(approval, created.market, created.teams)
  const market = result.market.markets[0]
  assert.equal(market.status, MarketStatus.Approved)
  assert.deepEqual(new Set(result.changedTeams), new Set([BUYER, SELLER]))
  const buyer = result.teams.get(BUYER)!.team
  const seller = result.teams.get(SELLER)!.team
  assert.equal(buyer.players[0].name, 'Seller Forward')
  assert.equal(buyer.players[0].position, FantaSoccerRole.Forward)
  assert.equal(seller.players[0].name, 'Buyer Forward')
  assert.equal(seller.players[0].position, FantaSoccerRole.FirstBackupForward)
  assert.equal(buyer.moneyFromRank, -2)
  assert.equal(seller.moneyFromRank, 2)
})

test('without-vote market executes immediately after creation', () => {
  const result = process(createCommand(), emptyMarketWrapper(), teams(), MarketType.WithoutVote)
  assert.equal(result.market.markets[0].status, MarketStatus.Approved)
  assert.equal(result.changedTeams.length, 2)
})

test('execution fails with NoMoney when canonical budgets changed before quorum', () => {
  const created = process(createCommand(), emptyMarketWrapper(), teams(10, 90), MarketType.WithVote, 100)
  const changed = created.teams
  changed.get(BUYER)!.team.players.push(player('Unexpected expensive player', 100, FantaSoccerRole.Tribune))
  const approval: MarketCommand = {
    version: 1, id: 'approve-1', kind: 'approve', leagueId: 'league', season: SEASON,
    actor: VOTER, requestedAt: NOW.toISOString(), status: 'pending', marketId: 'market-1',
  }
  const result = process(approval, created.market, changed, MarketType.WithVote, 100)
  assert.equal(result.market.markets[0].status, MarketStatus.NoMoney)
  assert.equal(result.command.status, 'rejected')
  assert.deepEqual(result.changedTeams, [])
})

test('execution fails with NoPlayers when an offered player is no longer active', () => {
  const created = process(createCommand())
  created.teams.get(SELLER)!.team.players[0].status = PlayerInTeamStatus.Sold
  const approval: MarketCommand = {
    version: 1, id: 'approve-1', kind: 'approve', leagueId: 'league', season: SEASON,
    actor: VOTER, requestedAt: NOW.toISOString(), status: 'pending', marketId: 'market-1',
  }
  const result = process(approval, created.market, created.teams)
  assert.equal(result.market.markets[0].status, MarketStatus.NoPlayers)
  assert.equal(result.command.status, 'rejected')
})

test('neutral denial reaches the same six-team majority used by legacy MarketManager', () => {
  const sixTeamGroup = group()
  sixTeamGroup.users.push(
    { username: FIFTH, email: FIFTH, role: IdentityRole.Participant },
    { username: SIXTH, email: SIXTH, role: IdentityRole.Participant },
  )
  sixTeamGroup.baskets[0].years[0].teams.push(
    { name: FIFTH, owner: FIFTH, additionalOwners: [] },
    { name: SIXTH, owner: SIXTH, additionalOwners: [] },
  )

  const created = process(createCommand(), emptyMarketWrapper(), teams(), MarketType.WithVote, 100, sixTeamGroup)
  const invalid: MarketCommand = {
    version: 1, id: 'buyer-vote', kind: 'deny', leagueId: 'league', season: SEASON,
    actor: BUYER, requestedAt: NOW.toISOString(), status: 'pending', marketId: 'market-1',
  }
  assert.equal(process(invalid, created.market, created.teams, MarketType.WithVote, 100, sixTeamGroup).command.status, 'rejected')

  const first = process({ ...invalid, id: 'deny-1', actor: VOTER }, created.market, created.teams, MarketType.WithVote, 100, sixTeamGroup)
  assert.equal(first.market.markets[0].status, MarketStatus.Pending)
  const second = process({ ...invalid, id: 'deny-2', actor: FOURTH }, first.market, first.teams, MarketType.WithVote, 100, sixTeamGroup)
  assert.equal(second.market.markets[0].status, MarketStatus.Pending)
  const third = process({ ...invalid, id: 'deny-3', actor: FIFTH }, second.market, second.teams, MarketType.WithVote, 100, sixTeamGroup)
  assert.equal(third.market.markets[0].status, MarketStatus.Pending)
  const fourth = process({ ...invalid, id: 'deny-4', actor: SIXTH }, third.market, third.teams, MarketType.WithVote, 100, sixTeamGroup)
  assert.equal(fourth.market.markets[0].status, MarketStatus.Denied)
})

test('only buyer or seller can cancel a pending market', () => {
  const created = process(createCommand())
  const cancel: MarketCommand = {
    version: 1, id: 'cancel-1', kind: 'cancel', leagueId: 'league', season: SEASON,
    actor: VOTER, requestedAt: NOW.toISOString(), status: 'pending', marketId: 'market-1',
  }
  assert.equal(process(cancel, created.market, created.teams).command.status, 'rejected')
  const valid = process({ ...cancel, id: 'cancel-2', actor: SELLER }, created.market, created.teams)
  assert.equal(valid.market.markets[0].status, MarketStatus.Cancelled)
})

test('pending markets expire strictly after fourteen days', () => {
  const wrapper = process(createCommand()).market
  assert.equal(expirePendingMarkets(wrapper, new Date('2026-09-20T12:00:00Z')), false)
  assert.equal(expirePendingMarkets(wrapper, new Date('2026-09-20T12:00:01Z')), true)
  assert.equal(wrapper.markets[0].status, MarketStatus.Expired)
})

test('rejects wrong roles, negative money and non-current seasons', () => {
  const wrongRoleTeams = teams()
  wrongRoleTeams.get(SELLER)!.team.players[0].role = Role.Midfielder
  assert.equal(process(createCommand(), emptyMarketWrapper(), wrongRoleTeams).command.status, 'rejected')
  assert.equal(process({ ...createCommand(), create: { ...createCommand().create!, moneyFromBuyer: -1 } }).command.status, 'rejected')
  const result = processMarketCommand({
    group: group(), leagueId: 'league', season: SEASON, command: createCommand(), market: emptyMarketWrapper(),
    teams: teams(), now: NOW, currentSeason: SEASON + 1,
  })
  assert.equal(result.command.status, 'rejected')
})

function team(owner: string, player: Player): Team {
  return { name: owner, owner, additionalOwners: [], players: [player], moneyFromRank: 0, lastUpdate: null }
}

function player(name: string, price: number, position: FantaSoccerRole): Player {
  return {
    name,
    team: { name: 'Roma', abbreviation: 'ROM' },
    role: Role.Forward,
    isActive: true,
    visible: true,
    price,
    revenue: price,
    status: PlayerInTeamStatus.Active,
    position,
  }
}
