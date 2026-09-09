import assert from 'node:assert/strict'
import test from 'node:test'
import { GroupHelper, type AnnualTeam } from '../../src/domain/src/index'

const team: AnnualTeam = {
  name: 'Team',
  owner: 'Owner@Example.com',
  additionalOwners: ['CoOwner@Example.com'],
}

test('owner and co-owner checks are case-insensitive', () => {
  assert.equal(GroupHelper.isOwner(team, 'owner@example.COM'), true)
  assert.equal(GroupHelper.isOwner(team, 'coowner@example.COM'), true)
  assert.equal(GroupHelper.isOwner(team, 'other@example.com'), false)
})
