import assert from 'node:assert/strict'
import test from 'node:test'
import {
  copyAnnualLeagueToYear,
  copyMissingTeams,
  getAnnualLeagueForYear,
  isLeagueSettingValid,
  preserveRawLeagueSetting,
  serializeVoteSettings,
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

test('creates editable defaults for a missing league year', () => {
  const league: any = { id: 'serie-a', name: 'Serie A', isMain: true, type: 1, years: [], basketsId: [] }
  const annualLeague = getAnnualLeagueForYear(league, 15, settings)
  assert.equal(annualLeague.year, 15)
  assert.equal(annualLeague.type, 1)
  assert.deepEqual(annualLeague.settings, settings)
  assert.notStrictEqual(annualLeague.settings, settings)
})

test('copies settings to a new year without mutating the source year', () => {
  const completeSettings: any = {
    ...settings,
    votes: {
      '-1': fallbackVote,
      0: { ...fallbackVote, goal: 4, stoppedPenalty: 4 },
    },
    pointForDraw: 2, pointForDefeat: -1, pointForStrongDefense: 3,
    pointForStrongDefense4: 5, pointForStrongDefense5: 7, pointForGoodPeople: 4,
    pointForCleanSheet: 2, moneyForGoal: 8, moneyForSufferedGoal: -2,
    formation: 1,
    typeSettings: {
      t: 0,
      r: [{ n: '@', t: 0, f: true, s: null, e: null }],
      n: { t: 25, g: 1, d: 5, m: 4, f: 2, mg: 1, md: 1, mb: 1, fb: 1 },
      fpy: null,
      ct: { c: { Strategy: 2 } },
    },
  }
  const source: any = { year: 14, type: 2, settings: completeSettings }
  const copied = copyAnnualLeagueToYear(source, 15, 1)
  copied.settings.startingMoney = 750
  copied.settings.votes[0]!.goal = 9
  copied.settings.typeSettings!.r[0].n = 'changed'
  assert.equal(copied.year, 15)
  assert.equal(copied.type, 2)
  assert.equal(source.settings.startingMoney, 1000)
  assert.equal(source.settings.votes[0].goal, 4)
  assert.equal(source.settings.typeSettings.r[0].n, '@')
  assert.equal(copied.settings.pointForStrongDefense5, 7)
  assert.equal(copied.settings.moneyForSufferedGoal, -2)
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

test('preserves backend-only settings while updating editable values', () => {
  const settingWithRawFields: any = {
    ...settings,
    startingMoney: 750,
    raw: { frm: 1, lt: { custom: 'backend-only' } },
    formation: 1,
    typeSettings: { custom: 'backend-only' },
  }
  const raw = preserveRawLeagueSetting(settingWithRawFields, {})
  assert.equal(raw.s, 750)
  assert.equal(raw.frm, 1)
  assert.deepEqual(raw.lt, { custom: 'backend-only' })
})

test('serializes every editable setting and canonical vote role keys', () => {
  const complete: any = {
    ...settings,
    votes: {
      '-1': fallbackVote,
      1: { ...fallbackVote, goal: 2.5, sufferedGoal: 0, stoppedPenalty: 0, assist: 1.5, injury: -1 },
    },
    formation: 1,
    typeSettings: { t: 0, r: [], n: { t: 25, g: 1, d: 5, m: 4, f: 2, mg: 1, md: 1, mb: 1, fb: 1 }, fpy: null, ct: { c: {} } },
    pointForDraw: 2, pointForDefeat: -1, pointForStrongDefense: 3,
    pointForStrongDefense4: 5, pointForStrongDefense5: 7, pointForGoodPeople: 4,
    pointForCleanSheet: 2, moneyForGoal: 8, moneyForSufferedGoal: -2,
  }
  const raw = preserveRawLeagueSetting(complete, serializeVoteSettings(complete.votes))
  assert.equal(raw.frm, 1)
  assert.deepEqual(raw.lt, complete.typeSettings)
  assert.equal(raw.h, 2)
  assert.equal(raw.b, -1)
  assert.equal(raw['3'], 3)
  assert.equal(raw['4'], 5)
  assert.equal(raw['5'], 7)
  assert.equal(raw.gp, 4)
  assert.equal(raw.l, 2)
  assert.equal(raw.m, 8)
  assert.equal(raw.n, -2)
  assert.equal(raw.v.Undefined.g, 3)
  assert.equal(raw.v.Defensor.a, 1.5)
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
