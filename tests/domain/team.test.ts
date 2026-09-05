import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FantaSoccerRole,
  FantaSoccerRoleHelper,
  PlayerInTeamStatus,
  Role,
  TeamHelper,
  type LeagueSetting,
  type Rank,
  type Team,
} from '../../src/domain/src/index'

const team: Team = {
  name: 'Alpha',
  owner: 'ale@example.com',
  additionalOwners: [],
  players: [
    { name: 'Portiere', team: { name: 'Roma', abbreviation: 'ROM' }, role: Role.GoalKeeper, isActive: true, visible: true, price: 12, revenue: 12, status: PlayerInTeamStatus.Active, position: FantaSoccerRole.GoalKeeper },
    { name: 'Attaccante', team: { name: 'Milan', abbreviation: 'MIL' }, role: Role.Forward, isActive: true, visible: true, price: 30, revenue: 40, status: PlayerInTeamStatus.Sold, position: FantaSoccerRole.Forward },
    { name: 'Riserva', team: { name: 'Inter', abbreviation: 'INT' }, role: Role.Defensor, isActive: true, visible: true, price: 9, revenue: 0, status: PlayerInTeamStatus.SoldForOneHalf, position: FantaSoccerRole.FirstBackupDefensor },
  ],
  moneyFromRank: 5,
  lastUpdate: null,
}

test('team JSON stores readable nested player/team properties directly', () => {
  const json = JSON.parse(JSON.stringify(team))
  assert.equal(json.name, 'Alpha')
  assert.equal(json.players[0].name, 'Portiere')
  assert.equal(json.players[0].team.abbreviation, 'ROM')
  assert.equal(json.players[0].price, 12)
  assert.equal('n' in json, false)
})

test('preserves Fantasoccer role mapping and active-player behavior', () => {
  assert.equal(FantaSoccerRoleHelper.toMainRole(FantaSoccerRole.FirstBackupDefensor), Role.Defensor)
  assert.deepEqual(TeamHelper.getActivePlayers(team).map(player => player.name), ['Portiere'])
})

test('preserves legacy team cost calculations', () => {
  const enhanced = TeamHelper.enhance(team)
  assert.equal(enhanced.totalCost, 51)
  assert.equal(enhanced.revenueMoney, 10)
  assert.equal(enhanced.moneyFromSoldWithOneHalfReturnedPrice, 4)
  assert.equal(enhanced.cost, 32)
  assert.equal(enhanced.netCost, 32)
})

test('keeps lastUpdate JSON-native while exposing a Date helper', () => {
  const dated = { ...team, lastUpdate: '2026-09-05T07:00:00.000Z' }
  assert.equal(TeamHelper.getLastUpdateDate(dated)?.toISOString(), dated.lastUpdate)
  assert.equal(TeamHelper.getLastUpdateDate(team), null)
})

test('calculates moneyFromRank with the legacy goal/suffered-goal formula', () => {
  const withoutRankMoney = { ...team, moneyFromRank: 0 }
  const rank: Rank = {
    serieADay: 3,
    rounds: {
      '@': [{
        name: 'Alpha', owner: 'ale@example.com', point: 6, victories: 2, draws: 0, defeats: 1,
        goal: 4, sufferedGoal: 2, valuePoint: 210, sufferedValuePoint: 200, plusMoney: 0, money: 100, valueAssets: 100,
      }],
    },
  }
  const settings = { moneyForGoal: 5, moneyForSufferedGoal: 3 } as LeagueSetting
  assert.equal(TeamHelper.calculateMoneyFromRank(withoutRankMoney, rank, settings), 26)
})
