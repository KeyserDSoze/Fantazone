import assert from 'node:assert/strict'
import test from 'node:test'
import { TeamHelper, calculateOpeningCompetitionPrizes, type Team } from '../../src/domain/src/index'

test('opening competition awards prizes by sporting position and preserves ties', () => {
  const standings = [
    { owner: 'a@example.com', score: 100 },
    { owner: 'b@example.com', score: 100 },
    { owner: 'c@example.com', score: 90 },
    { owner: 'd@example.com', score: 80 },
  ]
  const prizes = calculateOpeningCompetitionPrizes([
    { position: 1, credits: 50 },
    { position: 2, credits: 30 },
    { position: 3, credits: 20 },
  ], standings)

  assert.deepEqual(prizes, {
    'a@example.com': 50,
    'b@example.com': 50,
    'c@example.com': 20,
    'd@example.com': 0,
  })
})

test('opening competition prize lookup is case-insensitive for owner keys', () => {
  const prizes = calculateOpeningCompetitionPrizes([{ position: 1, credits: 25 }], [
    { owner: 'Winner@Example.COM', score: 12 },
  ])
  assert.equal(prizes['winner@example.com'], 25)
})

test('opening competition prize is credited to the starting-auction budget', () => {
  const team: Team = {
    name: 'Winner',
    owner: 'winner@example.com',
    additionalOwners: [],
    players: [],
    moneyFromRank: 0,
    openingCompetitionPrize: 50,
    formationChanges: 0,
    lastUpdate: null,
  }
  assert.equal(TeamHelper.getCost(team), -50)
  assert.equal(TeamHelper.enhance(team).cost, -50)
})