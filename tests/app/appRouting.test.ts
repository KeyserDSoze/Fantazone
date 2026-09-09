import assert from 'node:assert/strict'
import test from 'node:test'
import { browserPath, parseBrowserPath } from '../../src/app/services/appRouting'

test('parses top-level Fantazone browser routes', () => {
  assert.deepEqual(parseBrowserPath('/'), { kind: 'groups' })
  assert.deepEqual(parseBrowserPath('/groups'), { kind: 'groups' })
  assert.deepEqual(parseBrowserPath('/architecture'), { kind: 'architecture' })
  assert.deepEqual(parseBrowserPath('/join'), { kind: 'join' })
})

test('parses routed group pages and match details', () => {
  assert.deepEqual(parseBrowserPath('/groups/group%201/calendar'), {
    kind: 'group',
    groupId: 'group 1',
    route: 'calendar',
    gameId: null,
  })
  assert.deepEqual(parseBrowserPath('/groups/g/live/game/match%2F1'), {
    kind: 'group',
    groupId: 'g',
    route: 'live',
    gameId: 'match/1',
  })
})

test('keeps the group and falls back to home for an unknown page', () => {
  assert.deepEqual(parseBrowserPath('/groups/group-42/not-a-page'), {
    kind: 'group',
    groupId: 'group-42',
    route: 'home',
    gameId: null,
  })
})

test('serializes browser routes using encoded stable ids', () => {
  assert.equal(browserPath({ kind: 'groups' }), '/groups')
  assert.equal(browserPath({ kind: 'architecture' }), '/architecture')
  assert.equal(browserPath({ kind: 'join' }), '/join')
  assert.equal(browserPath({ kind: 'group', groupId: 'group 1', route: 'share-group', gameId: null }), '/groups/group%201/share-group')
  assert.equal(browserPath({ kind: 'group', groupId: 'g', route: 'calendar', gameId: 'match/1' }), '/groups/g/calendar/game/match%2F1')
})
