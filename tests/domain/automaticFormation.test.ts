import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ChanceType,
  FantaSoccerRole,
  PlayerInTeamStatus,
  Role,
  TrendType,
  applyFormationPositions,
  calculateAutomaticFormation,
  calculateAutomaticPlayerScore,
  validateFormation,
  type Chance,
  type ChancedRealPlayers,
  type Player,
  type RealDay,
  type StatPlayer,
  type StatPlayers,
  type Team,
} from '../../src/domain/src/index'

const normalChance = (): Chance => ({
  fantagazzetta: true,
  gazzetta: false,
  mediaset: false,
  sky: false,
  status: ChanceType.Normal,
  description: null,
  lastGame: null,
  trend: TrendType.Normal,
})

function player(name: string, role: Role, teamName = 'Roma'): Player {
  return {
    name,
    team: { name: teamName, abbreviation: teamName.slice(0, 3).toLowerCase() },
    role,
    isActive: true,
    visible: true,
    price: 10,
    revenue: 0,
    status: PlayerInTeamStatus.Active,
    position: FantaSoccerRole.Tribune,
  }
}

function statsFor(source: Player, games: StatPlayer['games']): StatPlayer {
  return {
    ...source,
    summatory: 0,
    fantaSummatory: 0,
    withVote: 0,
    withoutVote: 0,
    noPlayed: 0,
    withSpecial: 0,
    goals: 0,
    penalties: 0,
    assists: 0,
    stoppedPenalties: 0,
    sufferedGoals: 0,
    wrongedPenalties: 0,
    ownGoals: 0,
    yellowCards: 0,
    redCards: 0,
    enoughVotes: 0,
    manOfTheMatch: 0,
    injured: 0,
    games,
  }
}

test('automatic score ports chance, latest played positiveness and home/opponent factor', () => {
  const source = player('Attaccante', Role.Forward)
  const stats = statsFor(source, [{ serieADay: 2, vote: 7, positiveness: 3 }])
  const realGame = {
    home: { name: 'Roma', abbreviation: 'rom' },
    away: { name: 'Monza', abbreviation: 'mon' },
    date: '2026-09-20T18:00:00.000Z',
    homeGoals: null,
    awayGoals: null,
    delayed: false,
  }
  assert.equal(calculateAutomaticPlayerScore({ player: source, chance: normalChance(), stats, realGame }), 11)

  const injured = { ...normalChance(), status: ChanceType.Injury }
  assert.equal(calculateAutomaticPlayerScore({ player: source, chance: injured, stats, realGame }), -89)
})

test('automatic score uses the last five-day trend sum when the latest day was not played', () => {
  const source = player('Centrocampista', Role.Midfielder)
  const stats = statsFor(source, [
    { serieADay: 5, vote: null, positiveness: -2 },
    { serieADay: 4, vote: 6.5, positiveness: 3 },
    { serieADay: 3, vote: 6, positiveness: 1 },
    { serieADay: 2, vote: null, positiveness: -2 },
    { serieADay: 1, vote: 7, positiveness: 2 },
  ])
  assert.equal(calculateAutomaticPlayerScore({ player: source, chance: normalChance(), stats, realGame: null }), 8)
})

test('automatic formation produces a valid 25-player legacy lineup and bench', () => {
  const players = [
    ...Array.from({ length: 3 }, (_, i) => player(`GK ${i + 1}`, Role.GoalKeeper)),
    ...Array.from({ length: 8 }, (_, i) => player(`D ${i + 1}`, Role.Defensor)),
    ...Array.from({ length: 8 }, (_, i) => player(`M ${i + 1}`, Role.Midfielder)),
    ...Array.from({ length: 6 }, (_, i) => player(`F ${i + 1}`, Role.Forward)),
  ]
  const team: Team = { name: 'Team', owner: 'owner@test.local', additionalOwners: [], players, moneyFromRank: 0, lastUpdate: null }
  const chances: ChancedRealPlayers = {
    year: 15,
    serieADay: 3,
    players: players.map(current => ({
      ...current,
      chance: current.name === 'F 6' ? { ...normalChance(), status: ChanceType.Injury } : normalChance(),
    })),
  }
  const stats: StatPlayers = {
    year: 15,
    untilSerieADay: 2,
    players: players.map(current => statsFor(current, [{ serieADay: 2, vote: 6, positiveness: 0 }])),
  }
  const realDay: RealDay = { year: 15, serieADay: 3, games: [] }

  const result = calculateAutomaticFormation({ team, chances, stats, realDay })
  const preview = applyFormationPositions(team, result.updates)
  const active = preview.players.filter(item => item.status === PlayerInTeamStatus.Active)
  assert.equal(active.length, 25)
  assert.equal(active.filter(item => item.position === FantaSoccerRole.GoalKeeper).length, 1)
  assert.equal(active.filter(item => item.position >= FantaSoccerRole.Defensor && item.position <= FantaSoccerRole.Forward).length, 10)
  assert.equal(active.filter(item => item.position === FantaSoccerRole.BackupGoalKeeper).length, 1)
  assert.equal(active.filter(item => [FantaSoccerRole.FirstBackupDefensor, FantaSoccerRole.SecondBackupDefensor].includes(item.position)).length, 2)
  assert.equal(active.filter(item => [FantaSoccerRole.FirstBackupMidfielder, FantaSoccerRole.SecondBackupMidfielder].includes(item.position)).length, 2)
  assert.equal(active.filter(item => [FantaSoccerRole.FirstBackupForward, FantaSoccerRole.SecondBackupForward].includes(item.position)).length, 2)
  assert.equal(active.filter(item => item.position === FantaSoccerRole.Tribune).length, 7)
  assert.notEqual(preview.players.find(item => item.name === 'F 6')?.position, FantaSoccerRole.Forward)
  assert.equal(validateFormation(preview).valid, true)
})
