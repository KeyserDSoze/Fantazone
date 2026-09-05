import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DefaultLeagueSetting,
  FantaSoccerRole,
  LeagueType,
  PlayerInTeamStatus,
  Role,
  calculateDefinitiveDay,
  calculateRankFromCalendar,
  createEmptyVote,
  type Calendar,
  type CalendarDay,
  type LeagueSetting,
  type Team,
  type VotedRealPlayers,
} from '../../src/domain/src/index'

const settings: LeagueSetting = {
  ...DefaultLeagueSetting,
  votes: { ...DefaultLeagueSetting.votes },
  pointInHome: 2,
  pointForFirstGoal: 70,
  pointForNextGoal: 5,
  pointForGoodPeople: 0,
  pointForStrongDefense: 0,
  pointForStrongDefense4: 0,
  pointForStrongDefense5: 0,
  pointForCleanSheet: 0,
}

const day: CalendarDay = {
  serieADay: 7,
  number: 7,
  games: [{
    id: 'g1',
    number: 1,
    home: 'Home',
    homeOwner: 'home@test.local',
    away: 'Away',
    awayOwner: 'away@test.local',
    result: null,
  }],
}

const homeTeam = team('Home', 'home@test.local', 'Home player')
const awayTeam = team('Away', 'away@test.local', 'Away player')
const officialVotes: VotedRealPlayers = {
  year: 15,
  serieADay: 7,
  players: [
    voted(homeTeam, 72),
    voted(awayTeam, 66),
  ],
}

test('definitive day uses official votes, home advantage and fantasy goal thresholds', () => {
  const calculated = calculateDefinitiveDay({
    day,
    teamsByOwner: new Map([
      ['home@test.local', homeTeam],
      ['away@test.local', awayTeam],
    ]),
    officialVotes,
    leagueType: LeagueType.League,
    settings,
  })

  const result = calculated.games[0].result
  assert.ok(result)
  assert.equal(result.home.value, 74)
  assert.equal(result.away.value, 66)
  assert.deepEqual([result.homeGoals, result.awayGoals], [1, 0])
  assert.equal(day.games[0].result, null, 'pure reducer must not mutate canonical input')
})

test('missing TeamDay stays zero, cancelled games stay untouched and missing-only preserves existing results', () => {
  const missingHome = calculateDefinitiveDay({
    day,
    teamsByOwner: new Map([['away@test.local', awayTeam]]),
    officialVotes,
    leagueType: LeagueType.League,
    settings,
  })
  assert.equal(missingHome.games[0].result?.home.value, 0, 'home advantage is not applied without a home TeamDay')

  const existing: CalendarDay = structuredClone(day)
  existing.games[0].result = {
    home: { value: 99, defensiveBonus: false, goodPeople: false, ownGoal: false },
    away: { value: 1, defensiveBonus: false, goodPeople: false, ownGoal: false },
    isCancelled: false,
    homeGoals: 9,
    awayGoals: 0,
  }
  const preserved = calculateDefinitiveDay({
    day: existing,
    teamsByOwner: new Map(),
    officialVotes: null,
    leagueType: LeagueType.League,
    settings,
    mode: 'missing-only',
  })
  assert.equal(preserved.games[0].result?.home.value, 99)

  existing.games[0].result = {
    home: { value: 0, defensiveBonus: false, goodPeople: false, ownGoal: false },
    away: { value: 0, defensiveBonus: false, goodPeople: false, ownGoal: false },
    isCancelled: true,
    homeGoals: 0,
    awayGoals: 0,
  }
  const cancelled = calculateDefinitiveDay({
    day: existing,
    teamsByOwner: new Map(),
    officialVotes: null,
    leagueType: LeagueType.League,
    settings,
    mode: 'force',
  })
  assert.equal(cancelled.games[0].result?.isCancelled, true)
})

test('rank rebuild mirrors DefaultLeague.GetRank including ordering, excluded rounds and cancelled-day advancement', () => {
  const calculatedDay = calculateDefinitiveDay({
    day,
    teamsByOwner: new Map([
      ['home@test.local', homeTeam],
      ['away@test.local', awayTeam],
    ]),
    officialVotes,
    leagueType: LeagueType.League,
    settings,
  })
  const cancelledDay: CalendarDay = {
    serieADay: 8,
    number: 8,
    games: [{
      ...day.games[0],
      id: 'g2',
      result: {
        home: { value: 0, defensiveBonus: false, goodPeople: false, ownGoal: false },
        away: { value: 0, defensiveBonus: false, goodPeople: false, ownGoal: false },
        isCancelled: true,
        homeGoals: 0,
        awayGoals: 0,
      },
    }],
  }
  const calendar: Calendar = {
    year: 15,
    rounds: {
      Regular: [calculatedDay, cancelledDay],
      Finals: [calculatedDay],
    },
  }

  const rank = calculateRankFromCalendar(calendar, settings, ['Finals'])
  assert.equal(rank.serieADay, 8)
  assert.deepEqual(Object.keys(rank.rounds), ['Regular'])
  assert.equal(rank.rounds.Regular[0].owner, 'home@test.local')
  assert.equal(rank.rounds.Regular[0].point, 3)
  assert.equal(rank.rounds.Regular[0].victories, 1)
  assert.equal(rank.rounds.Regular[0].valuePoint, 74)
  assert.equal(rank.rounds.Regular[1].defeats, 1)
})

function team(name: string, owner: string, playerName: string): Team {
  return {
    name,
    owner,
    additionalOwners: [],
    moneyFromRank: 0,
    lastUpdate: null,
    players: [{
      name: playerName,
      team: { name: 'Roma', abbreviation: 'rom' },
      role: Role.Forward,
      isActive: true,
      visible: true,
      price: 1,
      revenue: 0,
      status: PlayerInTeamStatus.Active,
      position: FantaSoccerRole.Forward,
    }],
  }
}

function voted(teamValue: Team, value: number) {
  const player = teamValue.players[0]
  return {
    name: player.name,
    team: { ...player.team },
    role: player.role,
    isActive: true,
    visible: true,
    vote: {
      ...createEmptyVote(player.role),
      role: player.role,
      value,
      hasVote: true,
      isFinal: true,
    },
  }
}
