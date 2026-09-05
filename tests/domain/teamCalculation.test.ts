import assert from 'node:assert/strict'
import test from 'node:test'
import {
  Behaviour,
  DefaultLeagueSetting,
  DefaultRankedTeam,
  FantaSoccerRole,
  FormationType,
  LeagueType,
  PlayerInTeamStatus,
  Role,
  applyLiveRoundsToRank,
  calculateTeamPoint,
  createEmptyVote,
  type CalendarDay,
  type LeagueSetting,
  type Player,
  type Rank,
  type Vote,
  type VotedRealPlayers,
} from '../../src/domain/src/index'

test('team point keeps official-over-live precedence and normal same-role substitutions', () => {
  const starter = player('Starter', Role.Forward, FantaSoccerRole.Forward)
  const backup = player('Backup', Role.Forward, FantaSoccerRole.FirstBackupForward)
  const settings = scoringSettings()
  const official = votes([
    [starter, vote(Role.Forward, { hasVote: false, value: 0, isFinal: true })],
    [backup, vote(Role.Forward, { value: 7, isFinal: true })],
  ])
  const live = votes([
    [starter, vote(Role.Forward, { value: 10 })],
    [backup, vote(Role.Forward, { value: 5 })],
  ])

  const result = calculateTeamPoint({
    players: [starter, backup],
    officialVotes: official,
    liveVotes: live,
    leagueType: LeagueType.League,
    settings,
  })

  assert.equal(result.point.value, 7)
  assert.equal(result.formation.find(item => item.current.name === 'Starter')?.currentPosition, FantaSoccerRole.FirstBackupForward)
  assert.equal(result.formation.find(item => item.current.name === 'Backup')?.currentPosition, FantaSoccerRole.Forward)
})

test('team point mirrors good-people, defensive bonus and own-goal rules', () => {
  const settings = scoringSettings({
    pointForGoodPeople: 2,
    pointForStrongDefense: 3,
    pointForOwnGoal: 6,
    pointForFirstGoal: 66,
  })
  const defenders = [0, 1, 2].map(index => player(`D${index}`, Role.Defensor, FantaSoccerRole.Defensor))
  const result = calculateTeamPoint({
    players: defenders,
    officialVotes: votes(defenders.map(item => [item, vote(Role.Defensor, { value: 6 })])),
    leagueType: LeagueType.League,
    settings,
  })

  assert.equal(result.point.value, 23)
  assert.equal(result.point.defensiveBonus, true)
  assert.equal(result.point.goodPeople, true)
  assert.equal(result.point.ownGoal, true)
})

test('best formation selects eleven by legacy SuperLeague rules without mutating persisted positions', () => {
  const settings = scoringSettings({ formation: FormationType.Best })
  const roster = [
    ...roleRoster(Role.GoalKeeper, [4, 8]),
    ...roleRoster(Role.Defensor, [5, 6, 7, 8, 9, 10]),
    ...roleRoster(Role.Midfielder, [5, 6, 7, 8, 9, 10]),
    ...roleRoster(Role.Forward, [5, 6, 7, 8]),
  ]
  const official = votes(roster.map((item, index) => [item, vote(item.role, { value: Number(item.name.split('-').at(-1)) || index + 1 })]))

  const result = calculateTeamPoint({
    players: roster,
    officialVotes: official,
    leagueType: LeagueType.League,
    settings,
  })
  const field = result.formation.filter(item => item.currentPosition >= FantaSoccerRole.GoalKeeper && item.currentPosition <= FantaSoccerRole.Forward)

  assert.equal(field.length, 11)
  assert.equal(field.filter(item => item.current.role === Role.GoalKeeper).length, 1)
  assert.ok(field.filter(item => item.current.role === Role.Defensor).length >= 3)
  assert.ok(field.filter(item => item.current.role === Role.Midfielder).length >= 3)
  assert.ok(field.filter(item => item.current.role === Role.Forward).length >= 1)
  assert.equal(roster.every(item => item.position === FantaSoccerRole.Tribune), true)
})

test('live rank projection mirrors RankCalculator.AddDay and leaves canonical rank untouched', () => {
  const settings = scoringSettings({ moneyForGoal: 5, moneyForSufferedGoal: 3 })
  const rank: Rank = {
    serieADay: 2,
    rounds: {
      A: [
        { ...DefaultRankedTeam, name: 'Home', owner: 'home@example.com' },
        { ...DefaultRankedTeam, name: 'Away', owner: 'away@example.com' },
      ],
    },
  }
  const day: CalendarDay = {
    serieADay: 3,
    number: 3,
    games: [{
      id: 'g1',
      number: 1,
      home: 'Home',
      homeOwner: 'home@example.com',
      away: 'Away',
      awayOwner: 'away@example.com',
      result: {
        home: { value: 70, defensiveBonus: false, goodPeople: false, ownGoal: false },
        away: { value: 65, defensiveBonus: false, goodPeople: false, ownGoal: false },
        isCancelled: false,
        homeGoals: 1,
        awayGoals: 0,
      },
    }],
  }

  const projected = applyLiveRoundsToRank(rank, { A: day }, settings)
  const home = projected.rounds.A[0]
  const away = projected.rounds.A[1]
  assert.equal(home.point, 3)
  assert.equal(home.victories, 1)
  assert.equal(home.goal, 1)
  assert.equal(home.valuePoint, 70)
  assert.equal(home.plusMoney, 5)
  assert.equal(away.defeats, 1)
  assert.equal(away.sufferedGoal, 1)
  assert.equal(away.plusMoney, 3)
  assert.equal(rank.rounds.A[0].point, 0)
  assert.equal(projected.serieADay, 2)
})

function roleRoster(role: Role, values: number[]): Player[] {
  return values.map((value, index) => player(`${Role[role]}-${index}-${value}`, role, FantaSoccerRole.Tribune))
}

function player(name: string, role: Role, position: FantaSoccerRole): Player {
  return {
    name,
    team: { name: 'Roma', abbreviation: 'rom' },
    role,
    isActive: true,
    visible: true,
    price: 1,
    revenue: 0,
    status: PlayerInTeamStatus.Active,
    position,
  }
}

function vote(role: Role, overrides: Partial<Vote> = {}): Vote {
  return {
    ...createEmptyVote(role),
    role,
    hasVote: true,
    value: 6,
    status: Behaviour.Nothing,
    ...overrides,
  }
}

function votes(entries: Array<[Player, Vote | null]>): VotedRealPlayers {
  return {
    year: 15,
    serieADay: 3,
    players: entries.map(([current, currentVote]) => ({
      name: current.name,
      team: { ...current.team },
      role: current.role,
      isActive: current.isActive,
      visible: current.visible,
      vote: currentVote,
    })),
  }
}

function scoringSettings(overrides: Partial<LeagueSetting> = {}): LeagueSetting {
  return {
    ...DefaultLeagueSetting,
    votes: { ...DefaultLeagueSetting.votes },
    formation: FormationType.Normal,
    pointForGoodPeople: 0,
    pointForStrongDefense: 0,
    pointForStrongDefense4: 0,
    pointForStrongDefense5: 0,
    pointForCleanSheet: 0,
    ...overrides,
  }
}
