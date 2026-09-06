import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FantaSoccerRole,
  PlayerInTeamStatus,
  Role,
  syncTeamPlayerTransfers,
  type RealPlayers,
  type Team,
} from '../../src/domain/src/index'

const master: RealPlayers = {
  year: 15,
  players: [
    { name: 'Mario Rossi', team: { name: 'Milan', abbreviation: 'mil' }, role: Role.Forward, isActive: true, visible: true },
    { name: 'Luca Bianchi', team: { name: 'Inter', abbreviation: 'int' }, role: Role.Midfielder, isActive: true, visible: true },
  ],
}

test('updates only the canonical Serie A team of active fantasy players', () => {
  const source = team()
  const result = syncTeamPlayerTransfers(source, master)

  assert.deepEqual(result.changedPlayerKeys, ['mariorossi'])
  assert.notEqual(result.team, source)
  assert.equal(result.team.players[0].team.name, 'Milan')
  assert.equal(result.team.players[0].team.abbreviation, 'mil')
  assert.equal(result.team.players[0].price, 23)
  assert.equal(result.team.players[0].position, FantaSoccerRole.Tribune)
  assert.equal(result.team.players[0].status, PlayerInTeamStatus.Active)
  assert.equal(result.team.lastUpdate, source.lastUpdate)
})

test('preserves sold/history entries even when their real club changed', () => {
  const source = team()
  source.players[1].status = PlayerInTeamStatus.Sold
  source.players[1].team = { name: 'Roma', abbreviation: 'rom' }

  const result = syncTeamPlayerTransfers(source, master)
  assert.equal(result.team.players[1].team.name, 'Roma')
  assert.equal(result.changedPlayerKeys.includes('lucabianchi'), false)
})

test('returns original team when no active player club changed or master player is missing', () => {
  const source = team()
  source.players[0].team = { name: '  MILAN ', abbreviation: 'old' }
  source.players.push({
    name: 'Unknown Player',
    team: { name: 'Napoli', abbreviation: 'nap' },
    role: Role.Defensor,
    isActive: true,
    visible: true,
    price: 1,
    revenue: 0,
    status: PlayerInTeamStatus.Active,
    position: FantaSoccerRole.Tribune,
  })

  const result = syncTeamPlayerTransfers(source, master)
  assert.equal(result.team, source)
  assert.deepEqual(result.changedPlayerKeys, [])
})

function team(): Team {
  return {
    name: 'Team test',
    owner: 'owner@example.com',
    additionalOwners: [],
    moneyFromRank: 0,
    lastUpdate: '2026-09-01T10:00:00.000Z',
    players: [
      {
        name: 'Mario Rossi',
        team: { name: 'Roma', abbreviation: 'rom' },
        role: Role.Forward,
        isActive: true,
        visible: false,
        price: 23,
        revenue: 0,
        status: PlayerInTeamStatus.Active,
        position: FantaSoccerRole.Tribune,
      },
      {
        name: 'Luca Bianchi',
        team: { name: 'Inter', abbreviation: 'int' },
        role: Role.Midfielder,
        isActive: true,
        visible: true,
        price: 7,
        revenue: 0,
        status: PlayerInTeamStatus.Active,
        position: FantaSoccerRole.Tribune,
      },
    ],
  }
}
