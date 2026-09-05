import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FantaSoccerRole,
  PlayerInTeamStatus,
  Role,
  applyFormationPositions,
  getPlayerKey,
  validateFormation,
  type Player,
  type Team,
} from '../../src/domain/src/index'

const suffixes = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot']
const team = makeValidTeam()

test('accepts the legacy-valid 3-4-3 formation with complete bench and tribune', () => {
  assert.deepEqual(validateFormation(team), { valid: true, errors: [] })
})

test('rejects fewer than eleven starters with the legacy TeamChecker message', () => {
  const changed = structuredClone(team)
  changed.players.find(player => player.position === FantaSoccerRole.Forward)!.position = FantaSoccerRole.Tribune
  const result = validateFormation(changed)
  assert.equal(result.valid, false)
  assert.match(result.errors[0], /Meno di 11/)
})

test('rejects a player deployed in a slot belonging to a different real role', () => {
  const changed = structuredClone(team)
  const defender = changed.players.find(player => player.position === FantaSoccerRole.Defensor)!
  defender.role = Role.Midfielder
  const result = validateFormation(changed)
  assert.equal(result.valid, false)
  assert.equal(result.errors[0], 'Giocatore fuori ruolo.')
})

test('applies only active-player positions and preserves all other persisted fields', () => {
  const changed = applyFormationPositions(team, [
    { playerKey: getPlayerKey('Fwd starter Alpha'), position: FantaSoccerRole.Tribune },
    { playerKey: getPlayerKey('Fwd tribune Alpha'), position: FantaSoccerRole.Forward },
    { playerKey: getPlayerKey('Sold player'), position: FantaSoccerRole.Forward },
  ])
  assert.equal(changed.players.find(player => player.name === 'Fwd starter Alpha')?.position, FantaSoccerRole.Tribune)
  assert.equal(changed.players.find(player => player.name === 'Fwd tribune Alpha')?.position, FantaSoccerRole.Forward)
  assert.equal(changed.players.find(player => player.name === 'Sold player')?.position, FantaSoccerRole.Tribune)
  assert.equal(changed.players.find(player => player.name === 'Fwd starter Alpha')?.price, 10)
})

export function makeValidTeam(owner = 'owner@example.com'): Team {
  const players: Player[] = []
  add(players, 'GK starter', Role.GoalKeeper, FantaSoccerRole.GoalKeeper, 1)
  add(players, 'GK backup', Role.GoalKeeper, FantaSoccerRole.BackupGoalKeeper, 1)
  add(players, 'Def starter', Role.Defensor, FantaSoccerRole.Defensor, 3)
  add(players, 'Def backup first', Role.Defensor, FantaSoccerRole.FirstBackupDefensor, 1)
  add(players, 'Def backup second', Role.Defensor, FantaSoccerRole.SecondBackupDefensor, 1)
  add(players, 'Def tribune', Role.Defensor, FantaSoccerRole.Tribune, 3)
  add(players, 'Mid starter', Role.Midfielder, FantaSoccerRole.Midfielder, 4)
  add(players, 'Mid backup first', Role.Midfielder, FantaSoccerRole.FirstBackupMidfielder, 1)
  add(players, 'Mid backup second', Role.Midfielder, FantaSoccerRole.SecondBackupMidfielder, 1)
  add(players, 'Mid tribune', Role.Midfielder, FantaSoccerRole.Tribune, 2)
  add(players, 'Fwd starter', Role.Forward, FantaSoccerRole.Forward, 3)
  add(players, 'Fwd backup first', Role.Forward, FantaSoccerRole.FirstBackupForward, 1)
  add(players, 'Fwd backup second', Role.Forward, FantaSoccerRole.SecondBackupForward, 1)
  add(players, 'Fwd tribune', Role.Forward, FantaSoccerRole.Tribune, 2)
  players.push(player('Sold player', Role.Forward, FantaSoccerRole.Tribune, PlayerInTeamStatus.Sold))
  return { name: 'Owner Team', owner, additionalOwners: ['coowner@example.com'], players, moneyFromRank: 0, lastUpdate: null }
}

function add(target: Player[], prefix: string, role: Role, position: FantaSoccerRole, count: number) {
  for (let index = 0; index < count; index += 1) target.push(player(`${prefix} ${suffixes[index]}`, role, position))
}

function player(name: string, role: Role, position: FantaSoccerRole, status = PlayerInTeamStatus.Active): Player {
  return {
    name,
    team: { name: 'Roma', abbreviation: 'ROM' },
    role,
    isActive: true,
    visible: true,
    price: 10,
    revenue: 10,
    status,
    position,
  }
}
