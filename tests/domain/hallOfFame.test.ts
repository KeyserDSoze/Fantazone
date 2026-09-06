import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DefaultLeagueSetting,
  FantaSoccerRole,
  IdentityRole,
  LeagueType,
  PlayerInTeamStatus,
  Role,
  buildHallOfFame,
  getYearlyLeagueWinners,
  type Calendar,
  type Group,
  type Rank,
  type RankedTeam,
  type Team,
} from '../../src/domain/src/index'

const OWNER = 'owner@example.com'
const RIVAL = 'rival@example.com'
const SEASON = 15

function group(): Group {
  return {
    id: 'g', name: 'Group',
    users: [OWNER, RIVAL].map(email => ({ username: email, email, role: IdentityRole.Participant })),
    baskets: [{
      id: 'main', name: 'Main',
      years: [14, 15].map(year => ({
        year,
        teams: [
          { name: `Owner ${year}`, owner: OWNER, additionalOwners: [] },
          { name: `Rival ${year}`, owner: RIVAL, additionalOwners: [] },
        ],
      })),
    }],
    leagues: [{
      id: 'league', name: 'League', isMain: true, type: LeagueType.League, basketsId: ['main'],
      years: [14, 15].map(year => ({ year, type: LeagueType.League, settings: DefaultLeagueSetting })),
    }],
  }
}

function ranked(owner: string, point: number, valuePoint: number, goal: number): RankedTeam {
  return {
    name: owner, owner, point, valuePoint, goal,
    victories: point, draws: 1, defeats: 2, sufferedGoal: 3,
    sufferedValuePoint: 50, plusMoney: 4, money: 5, valueAssets: 9,
  }
}

function rank(ownerPoint: number, rivalPoint: number): Rank {
  return {
    serieADay: 38,
    rounds: { '@': [ranked(OWNER, ownerPoint, 100, 50), ranked(RIVAL, rivalPoint, 90, 40)] },
  }
}

function calendar(year: number, homeValue: number, awayValue: number, complete = true): Calendar {
  return {
    year,
    rounds: {
      '@': [{
        number: 38, serieADay: 38,
        games: [{
          id: `g-${year}`, number: 1,
          home: 'Owner', homeOwner: OWNER, away: 'Rival', awayOwner: RIVAL,
          result: complete ? {
            home: { value: homeValue, defensiveBonus: false, goodPeople: false, ownGoal: false },
            away: { value: awayValue, defensiveBonus: false, goodPeople: false, ownGoal: false },
            isCancelled: false,
            homeGoals: homeValue > awayValue ? 1 : 0,
            awayGoals: awayValue > homeValue ? 1 : 0,
          } : null,
        }],
      }],
    },
  }
}

function team(owner: string, playerName: string): Team {
  return {
    name: owner, owner, additionalOwners: [], moneyFromRank: 0, lastUpdate: null,
    players: [{
      name: playerName,
      team: { name: 'Roma', abbreviation: 'ROM' },
      role: Role.Forward,
      isActive: true,
      visible: true,
      price: 10,
      revenue: 10,
      status: PlayerInTeamStatus.Active,
      position: FantaSoccerRole.Forward,
    }],
  }
}

function seasonTeams(ownerPlayer: string): ReadonlyMap<string, Team> {
  return new Map([
    [OWNER, team(OWNER, ownerPlayer)],
    [RIVAL, team(RIVAL, 'Rival Player')],
  ])
}

test('aggregates every rank but withholds current-season titles until the latest day is complete', () => {
  const hall = buildHallOfFame({
    group: group(), leagueId: 'league', currentSeason: SEASON,
    seasons: [
      { year: 15, leagueType: LeagueType.League, rank: rank(20, 10), calendar: calendar(15, 0, 0, false), teamsByOwner: seasonTeams('Current Champion') },
      { year: 14, leagueType: LeagueType.League, rank: rank(12, 8), calendar: calendar(14, 72, 65), teamsByOwner: seasonTeams('Historic Champion') },
    ],
  })

  assert.equal(hall.allTimeRankings.find(item => item.owner === OWNER)?.point, 32)
  assert.equal(hall.winningTeams.length, 1)
  assert.deepEqual(hall.winningTeams[0], { owner: OWNER, teamName: 'Owner 14', wins: { '@': [14] } })
  assert.equal(hall.winningPlayers.length, 1)
  assert.equal(hall.winningPlayers[0].player.name, 'Historic Champion')
  assert.equal(hall.recordPlayer, null)
  assert.equal(hall.playerWithMostPointsInYear, null)
})

test('adds a completed current-season title and active champion players', () => {
  const hall = buildHallOfFame({
    group: group(), leagueId: 'league', currentSeason: SEASON,
    seasons: [{
      year: 15, leagueType: LeagueType.League, rank: rank(20, 10),
      calendar: calendar(15, 75, 65), teamsByOwner: seasonTeams('Champion Player'),
    }],
  })

  assert.deepEqual(hall.winningTeams[0].wins, { '@': [15] })
  assert.equal(hall.winningPlayers[0].player.name, 'Champion Player')
  assert.deepEqual(hall.winningPlayers[0].wins, { '@': [15] })
})

test('NewCup records Finals and Europa League winners but not Supercoppa', () => {
  const complete = (id: string, home: string, away: string, homeGoals: number, awayGoals: number) => ({
    id, number: 1, home, homeOwner: `${home}@example.com`, away, awayOwner: `${away}@example.com`,
    result: {
      home: { value: 70, defensiveBonus: false, goodPeople: false, ownGoal: false },
      away: { value: 68, defensiveBonus: false, goodPeople: false, ownGoal: false },
      isCancelled: false, homeGoals, awayGoals,
    },
  })
  const cup: Calendar = {
    year: SEASON,
    rounds: {
      Finals: [{ number: 36, serieADay: 36, games: [complete('f', 'champions', 'runner', 2, 1)] }],
      'Europa League': [{ number: 37, serieADay: 37, games: [complete('e', 'europa', 'other', 1, 0)] }],
      Supercoppa: [{ number: 38, serieADay: 38, games: [complete('s', 'champions', 'europa', 0, 1)] }],
    },
  }

  assert.deepEqual(getYearlyLeagueWinners(LeagueType.NewCup, { serieADay: 38, rounds: {} }, cup), [
    { owner: 'champions@example.com', round: 'Finals' },
    { owner: 'europa@example.com', round: 'Europa League' },
  ])
})

test('preserves the legacy RecordGame home-baseline comparison', () => {
  const first = calendar(14, 70, 80)
  const second = calendar(15, 75, 60)
  const hall = buildHallOfFame({
    group: group(), leagueId: 'league', currentSeason: 16,
    seasons: [
      { year: 15, leagueType: LeagueType.League, rank: rank(20, 10), calendar: second, teamsByOwner: seasonTeams('P15') },
      { year: 14, leagueType: LeagueType.League, rank: rank(12, 8), calendar: first, teamsByOwner: seasonTeams('P14') },
    ],
  })

  // Newest-first legacy iteration means season 15 starts as record. Season 14 away=80
  // compares against season 15 record home=75 and therefore replaces it.
  assert.equal(hall.recordGame?.year, 14)
  assert.equal(hall.recordGame?.game.result?.away.value, 80)
})
