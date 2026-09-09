import assert from 'node:assert/strict'
import test from 'node:test'
import { buildRealRank, type RealCalendar, type RealGame } from '../../src/domain/src/index'

const NOW = new Date('2026-09-20T12:00:00Z')

function game(
  home: string,
  away: string,
  homeGoals: number | null,
  awayGoals: number | null,
  date = '2026-09-19T18:45:00Z',
  delayed = false,
): RealGame {
  return {
    home: { name: home, abbreviation: home.slice(0, 3).toLowerCase() },
    away: { name: away, abbreviation: away.slice(0, 3).toLowerCase() },
    date,
    homeGoals,
    awayGoals,
    delayed,
  }
}

function calendar(games: RealGame[]): RealCalendar {
  return { year: 15, days: [{ year: 15, serieADay: 1, games }] }
}

test('buildRealRank mirrors legacy Serie A point and ordering rules', () => {
  const rank = buildRealRank(calendar([
    game('Roma', 'Milan', 2, 0),
    game('Inter', 'Napoli', 1, 1),
    game('Juventus', 'Lazio', 3, 1),
    game('Atalanta', 'Fiorentina', 2, 1),
    game('Torino', 'Bologna', 0, 1),
  ]), NOW)

  assert.deepEqual(rank.teams.slice(0, 5).map(team => [team.name, team.points, team.goalDifference]), [
    ['Juventus', 3, 2],
    ['Roma', 3, 2],
    ['Atalanta', 3, 1],
    ['Bologna', 3, 1],
    ['Inter', 1, 0],
  ])
  assert.equal(rank.teams.find(team => team.name === 'Roma')?.victories, 1)
  assert.equal(rank.teams.find(team => team.name === 'Milan')?.defeats, 1)
  assert.equal(rank.teams.find(team => team.name === 'Napoli')?.draws, 1)
})

test('buildRealRank seeds every calendar team but ignores future, delayed and incomplete games', () => {
  const rank = buildRealRank(calendar([
    game('Roma', 'Milan', 2, 1),
    game('Inter', 'Napoli', 1, 0, '2026-09-21T18:45:00Z'),
    game('Juventus', 'Lazio', 2, 0, '2026-09-19T18:45:00Z', true),
    game('Atalanta', 'Fiorentina', null, null),
  ]), NOW)

  assert.equal(rank.teams.length, 8)
  assert.equal(rank.teams.find(team => team.name === 'Roma')?.played, 1)
  assert.equal(rank.teams.find(team => team.name === 'Inter')?.played, 0)
  assert.equal(rank.teams.find(team => team.name === 'Juventus')?.played, 0)
  assert.equal(rank.teams.find(team => team.name === 'Atalanta')?.played, 0)
})

test('buildRealRank includes live scores once kickoff has started', () => {
  const live = game('Roma', 'Inter', 1, 0, '2026-09-20T11:00:00Z')
  const rank = buildRealRank(calendar([live]), NOW)

  assert.equal(rank.teams[0].name, 'Roma')
  assert.equal(rank.teams[0].points, 3)
  assert.equal(rank.teams[0].played, 1)
})

test('buildRealRank uses goals for, goals against and name as deterministic tie-breakers', () => {
  const rank = buildRealRank(calendar([
    game('Alpha', 'Zulu', 2, 0),
    game('Beta', 'Gamma', 3, 1),
    game('Delta', 'Echo', 2, 0),
  ]), NOW)

  assert.deepEqual(rank.teams.slice(0, 3).map(team => team.name), ['Beta', 'Alpha', 'Delta'])
})
