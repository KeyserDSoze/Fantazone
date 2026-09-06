import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AuctionType,
  PlayerInTeamStatus,
  FantaSoccerRole,
  Role,
  createEmptyStatPlayer,
  type StatPlayer,
  type Team,
} from '../../src/domain/src/index'
import { buildAuctionPlayerQueues } from '../../src/app/services/groupAuctionSetup'

function stat(name: string, role: Role): StatPlayer {
  return createEmptyStatPlayer({
    name,
    role,
    isActive: true,
    visible: true,
    team: { name: 'Roma', abbreviation: 'ROM' },
  })
}

function teamWith(name: string, playerName: string): Team {
  return {
    name,
    owner: `${name.toLowerCase()}@example.com`,
    additionalOwners: [],
    moneyFromRank: 0,
    lastUpdate: null,
    players: [{
      name: playerName,
      role: Role.Forward,
      isActive: true,
      visible: true,
      team: { name: 'Roma', abbreviation: 'ROM' },
      price: 10,
      revenue: 0,
      status: PlayerInTeamStatus.Active,
      position: FantaSoccerRole.Tribune,
    }],
  }
}

test('normal queue keeps master order and excludes players already present in league teams', () => {
  const players = [stat('Zeta', Role.Forward), stat('Alfa', Role.Forward), stat('Beta', Role.Forward)]
  const teams = new Map([['owner@example.com', { basketId: 'main', team: teamWith('Owner', 'Alfa') }]])
  const queues = buildAuctionPlayerQueues(players, teams, AuctionType.Normal, () => 0)
  assert.deepEqual(queues[Role.Forward], ['zeta', 'beta'])
})

test('random-by-letter rotates alphabet from an injected starting letter', () => {
  const players = [
    stat('Alfa', Role.Midfielder),
    stat('Bravo', Role.Midfielder),
    stat('Charlie', Role.Midfielder),
    stat('Zulu', Role.Midfielder),
  ]
  const queues = buildAuctionPlayerQueues(players, new Map(), AuctionType.RandomByLetter, () => 2 / 26)
  assert.deepEqual(queues[Role.Midfielder], ['charlie', 'zulu', 'alfa', 'bravo'])
})

test('random-list uses injected randomness and remains deterministic in tests', () => {
  const players = [stat('A', Role.GoalKeeper), stat('B', Role.GoalKeeper), stat('C', Role.GoalKeeper)]
  const values = [0, 0]
  const queues = buildAuctionPlayerQueues(players, new Map(), AuctionType.RandomList, () => values.shift() ?? 0)
  assert.deepEqual(queues[Role.GoalKeeper], ['b', 'c', 'a'])
})
