import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DefaultLeagueSetting,
  IdentityRole,
  LeagueType,
  cloneLeagueSetting,
  type Calendar,
  type Group,
  type RealCalendar,
} from '../../src/domain/src/index'
import { resolveFormationTarget } from '../../src/app/services/groupFormationTarget'

function makeGroup(liveFormationChanges = 0): Group {
  const settings = cloneLeagueSetting(DefaultLeagueSetting)
  settings.liveFormationChanges = liveFormationChanges
  return {
    id: 'amici',
    name: 'Amici',
    users: [{ username: 'Ale', email: 'ale@example.com', role: IdentityRole.Participant }],
    leagues: [{
      id: 'campionato',
      name: 'Campionato',
      isMain: true,
      type: LeagueType.League,
      basketsId: ['a'],
      years: [{ year: 15, type: LeagueType.League, settings }],
    }],
    baskets: [{
      id: 'a',
      name: 'A',
      years: [{
        year: 15,
        teams: [
          { name: 'Ale FC', owner: 'owner@example.com', additionalOwners: ['ale@example.com'] },
          { name: 'Bob FC', owner: 'bob@example.com', additionalOwners: [] },
        ],
      }],
    }],
  }
}

const group = makeGroup()

const calendar: Calendar = {
  year: 15,
  rounds: {
    Regular: [
      {
        serieADay: 1,
        number: 1,
        games: [{ id: 'g1', number: 1, home: 'Ale FC', homeOwner: 'owner@example.com', away: 'Bob FC', awayOwner: 'bob@example.com', result: null }],
      },
      {
        serieADay: 2,
        number: 2,
        games: [{ id: 'g2', number: 2, home: 'Bob FC', homeOwner: 'bob@example.com', away: 'Ale FC', awayOwner: 'owner@example.com', result: null }],
      },
    ],
  },
}

const realCalendar: RealCalendar = {
  year: 15,
  days: [
    {
      year: 15,
      serieADay: 1,
      games: [{ home: { name: 'A', abbreviation: 'a' }, away: { name: 'B', abbreviation: 'b' }, date: '2026-08-30T18:00:00.000Z', homeGoals: 1, awayGoals: 0, delayed: false }],
    },
    {
      year: 15,
      serieADay: 2,
      games: [{ home: { name: 'C', abbreviation: 'c' }, away: { name: 'D', abbreviation: 'd' }, date: '2026-09-13T18:00:00.000Z', homeGoals: null, awayGoals: null, delayed: false }],
    },
  ],
}

test('formation target resolves an additional owner to the canonical team owner and next Serie A day', () => {
  const target = resolveFormationTarget({
    group,
    leagueId: 'campionato',
    season: 15,
    identityEmail: 'ALE@example.com',
    calendar,
    realCalendar,
    now: new Date('2026-09-07T00:00:00.000Z'),
  })
  assert.deepEqual(target, {
    basketId: 'a',
    owner: 'owner@example.com',
    teamName: 'Ale FC',
    gameId: 'g2',
    fantasyDay: 2,
    serieADay: 2,
  })
})

test('formation target stays on the live Serie A day only when live changes are enabled', () => {
  const target = resolveFormationTarget({
    group: makeGroup(2),
    leagueId: 'campionato',
    season: 15,
    identityEmail: 'ale@example.com',
    calendar,
    realCalendar,
    now: new Date('2026-08-30T19:00:00.000Z'),
  })
  assert.equal(target?.gameId, 'g1')
  assert.equal(target?.serieADay, 1)
})

test('formation target moves to the next day when live changes are disabled', () => {
  const target = resolveFormationTarget({
    group,
    leagueId: 'campionato',
    season: 15,
    identityEmail: 'ale@example.com',
    calendar,
    realCalendar,
    now: new Date('2026-08-30T19:00:00.000Z'),
  })
  assert.equal(target?.gameId, 'g2')
  assert.equal(target?.serieADay, 2)
})

test('formation target moves to the next day after the four-hour live edit tail closes', () => {
  const target = resolveFormationTarget({
    group: makeGroup(2),
    leagueId: 'campionato',
    season: 15,
    identityEmail: 'ale@example.com',
    calendar,
    realCalendar,
    now: new Date('2026-08-30T22:00:01.000Z'),
  })
  assert.equal(target?.gameId, 'g2')
  assert.equal(target?.serieADay, 2)
})

test('formation target falls back to the first pending owned game without a RealCalendar', () => {
  const target = resolveFormationTarget({
    group,
    leagueId: 'campionato',
    season: 15,
    identityEmail: 'ale@example.com',
    calendar,
    realCalendar: null,
  })
  assert.equal(target?.gameId, 'g1')
})

test('formation target is null when the identity does not own a team in the selected league', () => {
  const target = resolveFormationTarget({
    group,
    leagueId: 'campionato',
    season: 15,
    identityEmail: 'nobody@example.com',
    calendar,
    realCalendar,
  })
  assert.equal(target, null)
})