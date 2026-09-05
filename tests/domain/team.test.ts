import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FantaSoccerRole,
  FantaSoccerRoleHelper,
  PlayerInTeamStatus,
  Role,
  TeamHelper,
  mapRawTeamToTeam,
  mapTeamToRawTeam,
  type LeagueSetting,
  type Rank,
  type TeamRaw,
} from '../../src/domain/src/index'

const raw: TeamRaw = {
  n: 'Alpha',
  o: 'ale@example.com',
  a: null,
  p: [
    { n: 'Portiere', t: { n: 'Roma', a: 'ROM' }, r: Role.GoalKeeper, a: true, vh: true, p: 12, rv: 12, s: PlayerInTeamStatus.Active, k: FantaSoccerRole.GoalKeeper },
    { n: 'Attaccante', t: { n: 'Milan', a: 'MIL' }, r: Role.Forward, a: true, vh: true, p: 30, rv: 40, s: PlayerInTeamStatus.Sold, k: FantaSoccerRole.Forward },
    { n: 'Riserva', t: { n: 'Inter', a: 'INT' }, r: Role.Defensor, a: true, vh: true, p: 9, rv: 0, s: PlayerInTeamStatus.SoldForOneHalf, k: FantaSoccerRole.FirstBackupDefensor },
  ],
  m: 5,
  d: null,
}

test('round-trips the compact TeamRaw payload including null optional fields', () => {
  assert.deepEqual(mapTeamToRawTeam(mapRawTeamToTeam(raw)), raw)
})

test('preserves Fantasoccer role mapping and active-player behavior', () => {
  const team = mapRawTeamToTeam(raw)
  assert.equal(FantaSoccerRoleHelper.toMainRole(FantaSoccerRole.FirstBackupDefensor), Role.Defensor)
  assert.deepEqual(TeamHelper.getActivePlayers(team).map(player => player.name), ['Portiere'])
})

test('preserves legacy team cost calculations', () => {
  const team = mapRawTeamToTeam(raw)
  const enhanced = TeamHelper.enhance(team)
  assert.equal(enhanced.totalCost, 51)
  assert.equal(enhanced.revenueMoney, 10)
  assert.equal(enhanced.moneyFromSoldWithOneHalfReturnedPrice, 4)
  assert.equal(enhanced.cost, 32)
  assert.equal(enhanced.netCost, 32)
})

test('calculates moneyFromRank with the legacy goal/suffered-goal formula', () => {
  const team = mapRawTeamToTeam({ ...raw, m: 0 })
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
  assert.equal(TeamHelper.calculateMoneyFromRank(team, rank, settings), 26)
})
