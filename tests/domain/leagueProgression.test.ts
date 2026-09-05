import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CUP_FINALS_ROUND,
  DefaultRankedTeam,
  EUROPA_LEAGUE_ROUND,
  LeagueType,
  SUPER_CUP_ROUND,
  progressLeagueCalendar,
  type Calendar,
  type CalendarDay,
  type CalendarGame,
  type GameResult,
  type Rank,
} from '../../src/domain/src/index'

const YEAR = 15

test('classic Cup progresses from group ranking through two-leg rounds to one final', () => {
  let calendar = cancelledCalendar('A', 12, 14)
  const rank: Rank = {
    serieADay: 14,
    rounds: Object.fromEntries(
      Array.from({ length: 4 }, (_, index) => [String.fromCharCode(65 + index), rankedTeams(index * 4 + 1, 4)]),
    ),
  }

  let progression = progressLeagueCalendar({ calendar, rank, leagueType: LeagueType.Cup })
  calendar = progression.calendar
  assert.equal(progression.changed, true)
  assert.deepEqual(calendar.rounds[CUP_FINALS_ROUND].map(day => day.games.length), [4, 4])

  completeTwoLegRound(calendar.rounds[CUP_FINALS_ROUND].slice(-2))
  progression = progressLeagueCalendar({ calendar, rank, leagueType: LeagueType.Cup })
  calendar = progression.calendar
  assert.deepEqual(calendar.rounds[CUP_FINALS_ROUND].map(day => day.games.length), [4, 4, 2, 2])

  completeTwoLegRound(calendar.rounds[CUP_FINALS_ROUND].slice(-2))
  progression = progressLeagueCalendar({ calendar, rank, leagueType: LeagueType.Cup })
  calendar = progression.calendar
  assert.deepEqual(calendar.rounds[CUP_FINALS_ROUND].map(day => day.games.length), [4, 4, 2, 2, 1])

  const afterFinalScheduled = progressLeagueCalendar({ calendar, rank, leagueType: LeagueType.Cup })
  assert.equal(afterFinalScheduled.changed, false)
  assert.deepEqual(afterFinalScheduled.calendar, calendar)
})

test('NewCup creates Champions and Europa knockout brackets from the top and next eight', () => {
  const calendar = cancelledCalendar('@', 15, 17)
  const rank: Rank = { serieADay: 17, rounds: { '@': rankedTeams(1, 16) } }

  const progression = progressLeagueCalendar({ calendar, rank, leagueType: LeagueType.NewCup })

  assert.equal(progression.changed, true)
  assert.deepEqual(progression.calendar.rounds[CUP_FINALS_ROUND].map(day => day.games.length), [4, 4])
  assert.deepEqual(progression.calendar.rounds[EUROPA_LEAGUE_ROUND].map(day => day.games.length), [4, 4])
  const championsOwners = new Set(progression.calendar.rounds[CUP_FINALS_ROUND][0].games.flatMap(game => [game.homeOwner, game.awayOwner]))
  const europaOwners = new Set(progression.calendar.rounds[EUROPA_LEAGUE_ROUND][0].games.flatMap(game => [game.homeOwner, game.awayOwner]))
  assert.deepEqual([...championsOwners].sort(), Array.from({ length: 8 }, (_, index) => `owner${index + 1}`).sort())
  assert.deepEqual([...europaOwners].sort(), Array.from({ length: 8 }, (_, index) => `owner${index + 9}`).sort())
})

test('NewCup uses goals before fantasy points when selecting Supercoppa qualifiers', () => {
  const calendar: Calendar = {
    year: YEAR,
    rounds: {
      '@': [day(15, 17, game('Base1', 'Base2', result(1, 0)))],
      [CUP_FINALS_ROUND]: [day(20, 22, game('ChampHome', 'ChampAway', result(0, 1, 80, 60)))],
      [EUROPA_LEAGUE_ROUND]: [day(20, 22, game('EuropaHome', 'EuropaAway', result(2, 0)))],
    },
  }

  const progressed = progressLeagueCalendar({ calendar, rank: { serieADay: 0, rounds: {} }, leagueType: LeagueType.NewCup }).calendar
  const superCup = progressed.rounds[SUPER_CUP_ROUND][0].games[0]

  assert.equal(superCup.homeOwner, 'ChampAway')
  assert.equal(superCup.awayOwner, 'EuropaHome')
  assert.equal(superCup.result, null)
  assert.equal(superCup.number, 1)
  assert.equal(progressed.rounds[SUPER_CUP_ROUND][0].serieADay, 38)
})

test('perfect knockout ties and generated ids are deterministic across rebuilds', () => {
  const calendar: Calendar = {
    year: YEAR,
    rounds: {
      '@': [day(15, 17, game('Base1', 'Base2', result(1, 0)))],
      [CUP_FINALS_ROUND]: [day(20, 22, game('ChampA', 'ChampB', result(1, 1, 70, 70)))],
      [EUROPA_LEAGUE_ROUND]: [day(20, 22, game('EuropaA', 'EuropaB', result(1, 1, 70, 70)))],
    },
  }

  const first = progressLeagueCalendar({ calendar, rank: { serieADay: 0, rounds: {} }, leagueType: LeagueType.NewCup })
  const second = progressLeagueCalendar({ calendar, rank: { serieADay: 0, rounds: {} }, leagueType: LeagueType.NewCup })

  assert.deepEqual(first, second)
  assert.match(first.calendar.rounds[SUPER_CUP_ROUND][0].games[0].id, /^progression:/)
})

test('completed NewCup with Supercoppa is idempotent', () => {
  const calendar: Calendar = {
    year: YEAR,
    rounds: {
      '@': [day(15, 17, game('Base1', 'Base2', result(1, 0)))],
      [CUP_FINALS_ROUND]: [day(20, 22, game('Champ1', 'Champ2', result(1, 0)))],
      [EUROPA_LEAGUE_ROUND]: [day(20, 22, game('Europa1', 'Europa2', result(1, 0)))],
      [SUPER_CUP_ROUND]: [day(38, 38, game('Champ1', 'Europa1', result(1, 0)))],
    },
  }

  const progression = progressLeagueCalendar({ calendar, rank: { serieADay: 0, rounds: {} }, leagueType: LeagueType.NewCup })
  assert.equal(progression.changed, false)
  assert.deepEqual(progression.calendar, calendar)
})

function cancelledCalendar(round: string, number: number, serieADay: number): Calendar {
  return {
    year: YEAR,
    rounds: {
      [round]: [day(number, serieADay, game('Team 1', 'Team 2', result(0, 0, 0, 0, true)))],
    },
  }
}

function rankedTeams(start: number, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const value = start + index
    return {
      ...DefaultRankedTeam,
      name: `Team ${value}`,
      owner: `owner${value}`,
      valuePoint: 100 - value,
    }
  })
}

function completeTwoLegRound(days: CalendarDay[]): void {
  assert.equal(days.length, 2)
  for (const item of days[0].games) item.result = result(2, 0)
  for (const item of days[1].games) item.result = result(0, 1, 65, 70)
}

function day(number: number, serieADay: number, ...games: CalendarGame[]): CalendarDay {
  return { number, serieADay, games }
}

function game(home: string, away: string, gameResult: GameResult): CalendarGame {
  return {
    id: `${home}-${away}`,
    number: 1,
    home,
    homeOwner: home,
    away,
    awayOwner: away,
    result: gameResult,
  }
}

function result(
  homeGoals: number,
  awayGoals: number,
  homeValue = 70,
  awayValue = 65,
  isCancelled = false,
): GameResult {
  return {
    home: { value: homeValue, defensiveBonus: false, goodPeople: false, ownGoal: false },
    away: { value: awayValue, defensiveBonus: false, goodPeople: false, ownGoal: false },
    isCancelled,
    homeGoals,
    awayGoals,
  }
}
