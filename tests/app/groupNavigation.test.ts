import assert from 'node:assert/strict'
import test from 'node:test'
import { DefaultLeagueSetting, IdentityRole, LeagueType, type Group, type UserOfAGroup } from '../../src/domain/src/index'
import {
  getDefaultGroupSelection,
  getGroupNavigationSections,
  normalizeGroupSelection,
} from '../../src/app/services/groupNavigation'

function member(role: IdentityRole): UserOfAGroup {
  return { username: 'Ale', email: 'ale@example.com', role }
}

function routesFor(role: IdentityRole): string[] {
  return getGroupNavigationSections(member(role)).flatMap(section => section.items.map(item => item.route))
}

function group(): Group {
  return {
    id: 'amici',
    name: 'Amici',
    users: [member(IdentityRole.SuperAdmin)],
    baskets: [],
    leagues: [
      {
        id: 'coppa',
        name: 'Coppa',
        isMain: false,
        type: LeagueType.Cup,
        basketsId: [],
        years: [{ year: 14, type: LeagueType.Cup, settings: DefaultLeagueSetting }],
      },
      {
        id: 'campionato',
        name: 'Campionato',
        isMain: true,
        type: LeagueType.League,
        basketsId: [],
        years: [
          { year: 14, type: LeagueType.League, settings: DefaultLeagueSetting },
          { year: 15, type: LeagueType.League, settings: DefaultLeagueSetting },
        ],
      },
    ],
  }
}

test('participant navigation exposes product sections without administrative routes', () => {
  const routes = routesFor(IdentityRole.Participant)
  assert.ok(routes.includes('home'))
  assert.ok(routes.includes('formation'))
  assert.ok(routes.includes('market'))
  assert.ok(routes.includes('settings'))
  assert.equal(routes.includes('auction'), false)
  assert.equal(routes.includes('group-users-admin'), false)
})

test('admin navigation exposes auction but not SuperAdmin management', () => {
  const routes = routesFor(IdentityRole.Admin)
  assert.ok(routes.includes('auction'))
  assert.equal(routes.includes('group-users-admin'), false)
  assert.equal(routes.includes('serie-a-admin'), false)
})

test('SuperAdmin navigation exposes only active group/platform administration', () => {
  const routes = routesFor(IdentityRole.SuperAdmin)
  assert.ok(routes.includes('auction'))
  assert.ok(routes.includes('group-users-admin'))
  assert.ok(routes.includes('group-league-admin'))
  assert.ok(routes.includes('logs'))
  assert.ok(routes.includes('serie-a-admin'))
  assert.equal(routes.includes('users'), false)
  assert.equal(routes.includes('cards-admin'), false)
})

test('default selection prefers the main league and the current Fantazone season when available', () => {
  const selection = getDefaultGroupSelection(group(), new Date('2026-09-07T00:00:00.000Z'))
  assert.deepEqual(selection, { leagueId: 'campionato', year: 15 })
})

test('selection normalization keeps a valid league and repairs an invalid season', () => {
  const selection = normalizeGroupSelection(
    group(),
    { leagueId: 'coppa', year: 15 },
    new Date('2026-09-07T00:00:00.000Z'),
  )
  assert.deepEqual(selection, { leagueId: 'coppa', year: 14 })
})
