import assert from 'node:assert/strict'
import test from 'node:test'
import {
  copyAnnualLeagueToYear,
  copyMissingTeams,
  getAnnualLeagueForYear,
  isLeagueSettingValid,
  upsertAnnualLeague,
} from '../../src/domain/src/groupAdmin'
import { getCurrentSeasonYear } from '../../src/domain/src/season'

const settings: any = {
  votes: {}, formation: 0, typeSettings: null, startingMoney: 1000,
  delayedDay: 2, cancelledDay: 1, pointForFirstGoal: 66, pointForNextGoal: 6,
  pointForOwnGoal: 6, differencePointForOwnGoal: 6, pointInHome: 0,
  pointForVictory: 3, pointForDefeat: 0, pointForDraw: 1,
  pointForStrongDefense: 2, pointForStrongDefense4: 4, pointForStrongDefense5: 6,
  pointForGoodPeople: 2, pointForCleanSheet: 1, moneyForGoal: 5,
  moneyForSufferedGoal: 3, randomAuction: false, rankWithValuePoints: false, market: 0,
}

const fallbackVote = {
  goal: 3, penalty: 3, sufferedGoal: -1, stoppedPenalty: 3, wrongedPenalty: -3,
  ownGoal: -3, assist: 1, yellowCard: -0.5, redCard: -1, injury: 0, manOfTheMatch: 2,
}

const verboseTypeSettings = {
  calendarType: 0,
  rounds: [{ name: '@', type: 0, fromStart: true, fromRankingStartTeam: null, fromRankingEndTeam: null }],
  numbers: {
    maxPlayersInTeam: 25,
    maxGoalKeepersInTeam: 1,
    maxDefendersInTeam: 5,
    maxMidfieldersInTeam: 4,
    maxForwardsInTeam: 2,
    maxGoalKeepersInBench: 1,
    maxDefendersInBench: 1,
    maxMidfieldersInBench: 1,
    maxForwardsInBench: 1,
  },
  fromPreviousYear: null,
  cardTrainer: { maxCardsPerType: { Strategy: 2 } },
}

test('creates editable defaults for a missing league year', () => {
  const league: any = { id: 'serie-a', name: 'Serie A', isMain: true, type: 1, years: [], basketsId: [] }
  const annualLeague = getAnnualLeagueForYear(league, 15, settings)
  assert.equal(annualLeague.year, 15)
  assert.equal(annualLeague.type, 1)
  assert.deepEqual(annualLeague.settings, settings)
  assert.notStrictEqual(annualLeague.settings, settings)
})

test('copies readable settings to a new year without mutating the source year', () => {
  const completeSettings: any = {
    ...settings,
    votes: {
      '-1': fallbackVote,
      0: { ...fallbackVote, goal: 4, stoppedPenalty: 4 },
    },
    pointForDraw: 2,
    formation: 1,
    typeSettings: verboseTypeSettings,
  }
  const source: any = { year: 14, type: 2, settings: completeSettings }
  const copied = copyAnnualLeagueToYear(source, 15, 1)
  copied.settings.startingMoney = 750
  copied.settings.votes[0]!.goal = 9
  copied.settings.typeSettings!.rounds[0].name = 'changed'
  assert.equal(copied.year, 15)
  assert.equal(source.settings.startingMoney, 1000)
  assert.equal(source.settings.votes[0].goal, 4)
  assert.equal(source.settings.typeSettings.rounds[0].name, '@')
})

test('resolves an inherited source type when copying to a new year', () => {
  const source: any = { year: 14, type: 0, settings }
  assert.equal(copyAnnualLeagueToYear(source, 15, 4).type, 4)
})

test('upserts an annual league without creating duplicate years', () => {
  const previous: any = { year: 14, type: 1, settings }
  const current: any = { year: 15, type: 2, settings }
  const updated = upsertAnnualLeague([previous, current], { ...current, type: 4 })
  assert.equal(updated.length, 2)
  assert.equal(updated.find(year => year.year === 15)?.type, 4)
})

test('copies only missing teams and clones co-owner arrays', () => {
  const existing = [{ name: 'Existing', owner: 'one@example.com', additionalOwners: [] as string[] }]
  const source = [
    { name: 'One', owner: 'one@example.com', additionalOwners: [] as string[] },
    { name: 'Two', owner: 'two@example.com', additionalOwners: ['three@example.com'] },
  ]
  const copied = copyMissingTeams(source, existing)
  copied[0].additionalOwners.push('four@example.com')
  assert.deepEqual(copied.map(team => team.owner), ['two@example.com'])
  assert.deepEqual(source[1].additionalOwners, ['three@example.com'])
})

test('settings JSON uses domain property names all the way down', () => {
  const document = { ...settings, votes: { '-1': fallbackVote }, typeSettings: verboseTypeSettings }
  const json = JSON.parse(JSON.stringify(document))
  assert.equal(json.startingMoney, 1000)
  assert.equal(json.votes['-1'].manOfTheMatch, 2)
  assert.equal(json.typeSettings.rounds[0].fromStart, true)
  assert.equal(json.typeSettings.numbers.maxGoalKeepersInBench, 1)
  assert.equal(json.typeSettings.cardTrainer.maxCardsPerType.Strategy, 2)
  assert.equal('frm' in json, false)
  assert.equal('lt' in json, false)
})

test('uses the same UTC season boundary as the backend', () => {
  assert.equal(getCurrentSeasonYear(new Date('2026-08-09T23:59:59Z')), 14)
  assert.equal(getCurrentSeasonYear(new Date('2026-08-10T00:00:00Z')), 15)
})

test('rejects settings that can break calendar or vote calculations', () => {
  const valid: any = { ...settings, votes: { '-1': fallbackVote } }
  assert.equal(isLeagueSettingValid(valid), true)
  assert.equal(isLeagueSettingValid({ ...valid, pointForNextGoal: 0 }), false)
  assert.equal(isLeagueSettingValid({ ...valid, delayedDay: 38 }), false)
  assert.equal(isLeagueSettingValid({ ...valid, votes: {} }), false)
})
