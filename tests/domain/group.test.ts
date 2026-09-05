import assert from 'node:assert/strict'
import test from 'node:test'
import {
  GroupHelper,
  IdentityRole,
  mapGroupToRaw,
  mapRawGroupToGroup,
  type GroupRaw,
} from '../../src/domain/src/index'

const vote = { g: 3, p: 3, s: -1, d: 3, w: -3, o: -3, a: 1, y: -0.5, r: -1, j: 0, m: 2 }
const raw: GroupRaw = {
  i: 'amici',
  n: 'Amici',
  l: [{
    i: 'serie-a', n: 'Serie A', m: true, t: 1, b: ['main'],
    y: [{
      y: 15, t: 1,
      s: {
        v: { Undefined: vote }, frm: 0, lt: null, s: 1000, d: 2, c: 1,
        g: 66, t: 6, o: 6, f: 6, p: 0, a: 3, b: 0, h: 1,
        '3': 2, '4': 4, '5': 6, gp: 2, l: 1, m: 5, n: 3,
        q: false, vp: false, mk: 0,
      },
    }],
  }],
  u: [
    { u: 'Ale', e: 'Ale@Example.com', r: IdentityRole.Participant | IdentityRole.Admin },
    { u: 'Reader', e: 'reader@example.com', r: IdentityRole.Reader },
  ],
  b: [{ i: 'main', n: 'Principale', y: [{ y: 15, t: [{ n: 'Alpha', o: 'ale@example.com', a: [] }] }] }],
}

test('round-trips the original compact Group JSON contract', () => {
  const clean = mapRawGroupToGroup(raw)
  const roundTrip = mapGroupToRaw(clean)
  assert.deepEqual(roundTrip, raw)
})

test('resolves membership in the selected group by normalized email', () => {
  const group = mapRawGroupToGroup(raw)
  const user = GroupHelper.findUserByEmail(group, '  ale@example.COM ')
  assert.equal(user?.username, 'Ale')
  assert.equal(GroupHelper.hasRole(user!, IdentityRole.Admin), true)
  assert.equal(GroupHelper.findUserByEmail(group, 'missing@example.com'), null)
})

test('derives available years from the same group JSON', () => {
  const group = mapRawGroupToGroup(raw)
  assert.deepEqual(GroupHelper.getAvailableYears(group), [15])
  assert.equal(GroupHelper.getBasketId(group, 'ALE@example.com', 15), 'main')
})
