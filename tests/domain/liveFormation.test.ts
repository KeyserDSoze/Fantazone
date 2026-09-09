import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FantaSoccerRole,
  PlayerInTeamStatus,
  Role,
  getLiveFormationChangesRemaining,
  getLiveFormationWindow,
  validateLiveFormationChange,
  type Player,
  type RealCalendar,
  type Team,
} from '../../src/domain/src/index'

test('live formation window starts at first kickoff and ends four hours after the last kickoff', () => {
  const calendar: RealCalendar = {
    year: 15,
    days: [{
      year: 15,
      serieADay: 1,
      games: [
        { home: realTeam('Roma'), away: realTeam('Milan'), date: '2026-09-12T16:00:00.000Z', homeGoals: null, awayGoals: null, delayed: false },
        { home: realTeam('Inter'), away: realTeam('Napoli'), date: '2026-09-13T18:45:00.000Z', homeGoals: null, awayGoals: null, delayed: false },
      ],
    }],
  }
  const settings = { liveFormationChanges: 2 }

  assert.equal(getLiveFormationWindow(calendar, settings, new Date('2026-09-12T15:59:59.000Z')), null)
  assert.equal(getLiveFormationWindow(calendar, settings, new Date('2026-09-12T16:00:00.000Z'))?.serieADay, 1)
  assert.equal(getLiveFormationWindow(calendar, settings, new Date('2026-09-13T22:45:00.000Z'))?.deadline, '2026-09-13T22:45:00.000Z')
  assert.equal(getLiveFormationWindow(calendar, settings, new Date('2026-09-13T22:45:00.001Z')), null)
  assert.equal(getLiveFormationWindow(calendar, { liveFormationChanges: 0 }, new Date('2026-09-12T18:00:00.000Z')), null)
})

test('live formation accepts one two-player swap and increments the day-scoped counter', () => {
  const before = team([
    player('Starter', Role.Forward, FantaSoccerRole.Forward),
    player('Reserve', Role.Forward, FantaSoccerRole.FirstBackupForward),
  ], 0)
  const after = structuredClone(before)
  after.players[0].position = FantaSoccerRole.FirstBackupForward
  after.players[1].position = FantaSoccerRole.Forward

  assert.deepEqual(validateLiveFormationChange(before, after, {
    liveFormationChanges: 2,
    allowLiveModuleChange: false,
  }), {
    valid: true,
    changedPlayers: 2,
    nextFormationChanges: 1,
  })
  assert.equal(getLiveFormationChangesRemaining({ ...after, formationChanges: 1 }, { liveFormationChanges: 2 }), 1)
})

test('live formation rejects exhausted limits and changes that are not a position swap', () => {
  const before = team([
    player('Starter', Role.Forward, FantaSoccerRole.Forward),
    player('Reserve', Role.Forward, FantaSoccerRole.FirstBackupForward),
  ], 1)
  const swapped = structuredClone(before)
  swapped.players[0].position = FantaSoccerRole.FirstBackupForward
  swapped.players[1].position = FantaSoccerRole.Forward
  const exhausted = validateLiveFormationChange(before, swapped, { liveFormationChanges: 1, allowLiveModuleChange: true })
  assert.equal(exhausted.valid, false)
  if (!exhausted.valid) assert.match(exhausted.error, /numero massimo/i)

  const invalid = structuredClone({ ...before, formationChanges: 0 })
  invalid.players[0].position = FantaSoccerRole.Tribune
  invalid.players[1].position = FantaSoccerRole.Forward
  const result = validateLiveFormationChange({ ...before, formationChanges: 0 }, invalid, { liveFormationChanges: 2, allowLiveModuleChange: true })
  assert.equal(result.valid, false)
  if (!result.valid) assert.match(result.error, /scambio/i)
})

test('module lock rejects a swap that changes the starting module', () => {
  const before = team([
    player('Def starter', Role.Defensor, FantaSoccerRole.Defensor),
    player('Mid reserve', Role.Midfielder, FantaSoccerRole.FirstBackupMidfielder),
  ], 0)
  const after = structuredClone(before)
  after.players[0].position = FantaSoccerRole.FirstBackupMidfielder
  after.players[1].position = FantaSoccerRole.Defensor

  const result = validateLiveFormationChange(before, after, { liveFormationChanges: 2, allowLiveModuleChange: false })
  assert.equal(result.valid, false)
})

function team(players: Player[], formationChanges: number): Team {
  return {
    name: 'Team',
    owner: 'owner@example.com',
    additionalOwners: ['COOWNER@example.com'],
    players,
    moneyFromRank: 0,
    openingCompetitionPrize: 0,
    formationChanges,
    lastUpdate: null,
  }
}

function player(name: string, role: Role, position: FantaSoccerRole): Player {
  return {
    name,
    team: realTeam('Roma'),
    role,
    isActive: true,
    visible: true,
    price: 1,
    revenue: 0,
    status: PlayerInTeamStatus.Active,
    position,
  }
}

function realTeam(name: string) {
  return { name, abbreviation: name.slice(0, 3).toUpperCase() }
}
