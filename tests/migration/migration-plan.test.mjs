import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMigrationPlan, resolveGroup, shouldDownloadContainer } from '../../scripts/migration/migration-plan.mjs'

const groupRaw = { i: 'my-group', n: 'My Group', l: [], u: [], b: [] }
const teamRaw = { n: 'T', o: 'owner@example.com', a: [], p: [{ n: 'Mario Rossi', t: { n: 'Roma', a: 'ROM' }, r: 3, a: true, vh: true, p: 10, rv: 0, s: 0, k: 3 }], m: 0, d: null }
const masterPlayer = { n: 'Mario Rossi', t: { n: 'Roma', a: 'ROM' }, r: 3, a: true, vh: true }
const records = [
  { container: 'group', blobName: 'g', key: 'my-group', value: groupRaw },
  { container: 'team', blobName: 't', key: { g: 'my-group', y: 14, b: 'basket a', e: 'owner@example.com' }, value: teamRaw },
  { container: 'dailyteams', blobName: 'td', key: { g: 'my-group', y: 14, b: 'basket a', e: 'owner@example.com', d: 4 }, value: teamRaw },
  { container: 'team', blobName: 'other', key: { g: 'other-group', y: 14, b: 'b', e: 'x@y' }, value: teamRaw },
  { container: 'realplayerswrapper', blobName: '14', key: 14, value: { p: [masterPlayer] } },
  { container: 'official', blobName: 'v', key: { y: 14, d: 2 }, value: { p: [] } },
]

function rawVote(role = 3, value = 6.5) {
  return { r: role, v: value, i: false, g: 0, p: 0, a: 0, s: 0, d: 0, w: 0, o: 0, t: 0, h: true, u: false, n: false, j: false, c: false }
}

test('selects a single group by repository suffix', () => {
  assert.equal(resolveGroup(records, 'owner/Fantazone.My-Group').id, 'my-group')
})

test('filters group-owned entities and builds exact canonical paths', () => {
  const plan = buildMigrationPlan(records, { groupRepository: 'owner/Fantazone.My-Group' })
  const paths = plan.groupFiles.map(x => x.path)
  assert.deepEqual(paths, [
    'config/group.json',
    'data/groups/seasons/14/days/4/teams/basket%20a/owner@example.com.json',
    'data/groups/seasons/14/teams/basket%20a/owner@example.com.json',
  ])
  assert.equal(plan.groupFiles.some(file => file.source.includes('other')), false)
})

test('sends shared Serie A historical documents to the platform repository', () => {
  const plan = buildMigrationPlan(records, { groupRepository: 'owner/Fantazone.My-Group' })
  assert.deepEqual(plan.platformFiles.map(x => x.path), [
    'data/serie-a/players/14.json',
    'data/serie-a/votes/official/14/2.json',
  ])
})

test('season team output is v3 while daily team output keeps readable full player snapshot', () => {
  const plan = buildMigrationPlan(records, { groupRepository: 'owner/Fantazone.My-Group' })
  const season = JSON.parse(plan.groupFiles.find(x => x.path.includes('/teams/') && !x.path.includes('/days/')).content)
  const day = JSON.parse(plan.groupFiles.find(x => x.path.includes('/days/')).content)
  assert.equal(season.version, 3)
  assert.equal(season.players[0].playerKey, 'mariorossi')
  assert.equal(day.players[0].name, 'Mario Rossi')
})

test('historical live vote with null team is enriched from the same-season RealPlayers master', () => {
  const live = {
    container: 'live', blobName: '14|||2', key: { y: 14, d: 2 },
    value: { p: [{ n: 'Mario Rossi', t: null, r: 0, a: false, v: rawVote() }] },
  }
  const plan = buildMigrationPlan([...records, live], { groupRepository: 'owner/Fantazone.My-Group' })
  const document = JSON.parse(plan.platformFiles.find(file => file.path === 'data/serie-a/votes/live/14/2.json').content)
  assert.equal(document.players[0].team.name, 'Roma')
  assert.equal(document.players[0].role, 3)
  assert.equal(document.players[0].vote.value, 6.5)
})

test('historical live vote falls back to the exact same-day official player when season master is missing it', () => {
  const official = {
    container: 'official', blobName: '12|||13', key: { y: 12, d: 13 },
    value: { p: [{ n: 'Galdames', t: { n: 'Genoa' }, r: 2, a: true, v: rawVote(2, 0) }] },
  }
  const live = {
    container: 'live', blobName: '12|||13', key: { y: 12, d: 13 },
    value: { p: [{ n: 'Galdames', t: null, r: 0, a: false, v: rawVote(2, 0) }] },
  }
  const plan = buildMigrationPlan([...records, official, live], { groupRepository: 'owner/Fantazone.My-Group' })
  const document = JSON.parse(plan.platformFiles.find(file => file.path === 'data/serie-a/votes/live/12/13.json').content)
  assert.equal(document.players[0].team.name, 'Genoa')
  assert.equal(document.players[0].role, 2)
})

test('historical live vote accepts one unique one-edit same-day name recovery with matching role', () => {
  const official = {
    container: 'official', blobName: '13|||1', key: { y: 13, d: 1 },
    value: { p: [{ n: 'Mbangula', t: { n: 'Juventus', a: 'juv' }, r: 3, a: true, v: rawVote(3, 7) }] },
  }
  const live = {
    container: 'live', blobName: '13|||1', key: { y: 13, d: 1 },
    value: { p: [{ n: 'Mbangila', t: null, r: 0, a: false, v: rawVote(3, 7) }] },
  }
  const plan = buildMigrationPlan([...records, official, live], { groupRepository: 'owner/Fantazone.My-Group' })
  const document = JSON.parse(plan.platformFiles.find(file => file.path === 'data/serie-a/votes/live/13/1.json').content)
  assert.equal(document.players[0].team.name, 'Juventus')
  assert.equal(document.players[0].role, 3)
  assert.equal(document.players[0].name, 'Mbangila')
})

test('historical live vote fails closed when missing metadata has no safe unique match', () => {
  const live = {
    container: 'live', blobName: '13|||1', key: { y: 13, d: 1 },
    value: { p: [{ n: 'Unknown Player', t: null, r: 0, a: false, v: rawVote(3, 7) }] },
  }
  assert.throws(
    () => buildMigrationPlan([...records, live], { groupRepository: 'owner/Fantazone.My-Group' }),
    /Cannot recover legacy RealTeam for vote player 'Unknown Player'/,
  )
})

test('does not download retired or encrypted Auction container content', () => {
  assert.equal(shouldDownloadContainer('auction'), false)
  assert.equal(shouldDownloadContainer('cards'), false)
  assert.equal(shouldDownloadContainer('official'), true)
})

test('fails if two legacy blobs map to the same canonical path', () => {
  const duplicate = [...records, { ...records[1], blobName: 'duplicate' }]
  assert.throws(() => buildMigrationPlan(duplicate, { groupRepository: 'owner/Fantazone.My-Group' }), /Multiple legacy blobs map/)
})
