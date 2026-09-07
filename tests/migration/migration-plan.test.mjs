import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMigrationPlan, resolveGroup, shouldDownloadContainer } from '../../scripts/migration/migration-plan.mjs'

const groupRaw = { i: 'my-group', n: 'My Group', l: [], u: [], b: [] }
const teamRaw = { n: 'T', o: 'owner@example.com', a: [], p: [{ n: 'Mario Rossi', t: { n: 'Roma', a: 'ROM' }, r: 3, a: true, vh: true, p: 10, rv: 0, s: 0, k: 3 }], m: 0, d: null }
const records = [
  { container: 'group', blobName: 'g', key: 'my-group', value: groupRaw },
  { container: 'team', blobName: 't', key: { g: 'my-group', y: 14, b: 'basket a', e: 'owner@example.com' }, value: teamRaw },
  { container: 'dailyteams', blobName: 'td', key: { g: 'my-group', y: 14, b: 'basket a', e: 'owner@example.com', d: 4 }, value: teamRaw },
  { container: 'team', blobName: 'other', key: { g: 'other-group', y: 14, b: 'b', e: 'x@y' }, value: teamRaw },
  { container: 'realplayerswrapper', blobName: '14', key: 14, value: { p: [{ n: 'Mario Rossi', t: { n: 'Roma', a: 'ROM' }, r: 3, a: true, vh: true }] } },
  { container: 'official', blobName: 'v', key: { y: 14, d: 2 }, value: { p: [] } },
]

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

test('does not download retired or encrypted Auction container content', () => {
  assert.equal(shouldDownloadContainer('auction'), false)
  assert.equal(shouldDownloadContainer('cards'), false)
  assert.equal(shouldDownloadContainer('official'), true)
})

test('fails if two legacy blobs map to the same canonical path', () => {
  const duplicate = [...records, { ...records[1], blobName: 'duplicate' }]
  assert.throws(() => buildMigrationPlan(duplicate, { groupRepository: 'owner/Fantazone.My-Group' }), /Multiple legacy blobs map/)
})
