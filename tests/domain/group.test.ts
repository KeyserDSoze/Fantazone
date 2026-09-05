import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DefaultLeagueSetting,
  GroupHelper,
  IdentityRole,
  LeagueType,
  type Group,
} from '../../src/domain/src/index'

const group: Group = {
  id: 'amici',
  name: 'Amici',
  leagues: [{
    id: 'serie-a',
    name: 'Serie A',
    isMain: true,
    type: LeagueType.League,
    basketsId: ['main'],
    years: [{ year: 15, type: LeagueType.League, settings: DefaultLeagueSetting }],
  }],
  users: [
    { username: 'Ale', email: 'Ale@Example.com', role: IdentityRole.Participant | IdentityRole.Admin },
    { username: 'Reader', email: 'reader@example.com', role: IdentityRole.Reader },
  ],
  baskets: [{
    id: 'main',
    name: 'Principale',
    years: [{ year: 15, teams: [{ name: 'Alpha', owner: 'ale@example.com', additionalOwners: [] }] }],
  }],
}

test('the persisted Group document already uses readable property names', () => {
  const json = JSON.parse(JSON.stringify(group))
  assert.equal(json.id, 'amici')
  assert.equal(json.users[0].username, 'Ale')
  assert.equal(json.users[0].email, 'Ale@Example.com')
  assert.equal(json.leagues[0].years[0].settings.startingMoney, 1000)
  assert.equal('u' in json, false)
  assert.equal('i' in json, false)
})

test('resolves membership in the selected group by normalized email', () => {
  const user = GroupHelper.findUserByEmail(group, '  ale@example.COM ')
  assert.equal(user?.username, 'Ale')
  assert.equal(GroupHelper.hasRole(user!, IdentityRole.Admin), true)
  assert.equal(GroupHelper.findUserByEmail(group, 'missing@example.com'), null)
})

test('derives available years and basket ownership directly from Group', () => {
  assert.deepEqual(GroupHelper.getAvailableYears(group), [15])
  assert.equal(GroupHelper.getBasketId(group, 'ALE@example.com', 15), 'main')
})
