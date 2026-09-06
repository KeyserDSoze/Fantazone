import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import type { RealCalendar, Team } from '../../src/domain/src/index'
import {
  dayTeamDocumentPath,
  realCalendarDocumentPath,
  seasonTeamDocumentPath,
} from '../../src/github/src/index'
import {
  FORMATION_SNAPSHOT_CURSOR_PATH,
  formationSnapshotSourceDocumentPath,
  snapshotSavedFormations,
} from '../../src/jobs/src/formationSnapshot'

const SEASON = 15
const BASKET = 'main'
const OWNER = 'owner@example.com'

test('processes every unconsumed save across kickoff so a replaced pending Action cannot lose the last valid formation', async () => {
  const fixture = await createFixture(realCalendar([
    [8, '2026-09-05T18:00:00Z'],
    [9, '2026-09-12T18:00:00Z'],
  ]))
  const before = git(fixture.groupRoot, 'rev-parse', 'HEAD')

  const firstCommit = await commitTeam(fixture.groupRoot, { ...team(), name: 'Before kickoff' }, '2026-09-05T17:59:59Z')
  const secondCommit = await commitTeam(fixture.groupRoot, { ...team(), name: 'At kickoff' }, '2026-09-05T18:00:00Z')

  const result = await snapshotSavedFormations({
    groupRepoRoot: fixture.groupRoot,
    platformRepoRoot: fixture.platformRoot,
    fallbackBefore: before,
    now: new Date('2026-09-05T18:05:00Z'),
  })

  assert.equal(result.changedTeamFiles, 2)
  assert.equal(result.writtenSnapshots, 2)
  assert.equal(result.noTargetSnapshots, 0)
  assert.equal((await readJson<Team>(join(fixture.groupRoot, dayTeamDocumentPath(BASKET, SEASON, 8, OWNER)))).name, 'Before kickoff')
  assert.equal((await readJson<Team>(join(fixture.groupRoot, dayTeamDocumentPath(BASKET, SEASON, 9, OWNER)))).name, 'At kickoff')

  const day8Source = await readJson<{ sourceCommit: string }>(join(
    fixture.groupRoot,
    formationSnapshotSourceDocumentPath(BASKET, SEASON, 8, OWNER),
  ))
  const day9Source = await readJson<{ sourceCommit: string }>(join(
    fixture.groupRoot,
    formationSnapshotSourceDocumentPath(BASKET, SEASON, 9, OWNER),
  ))
  assert.equal(day8Source.sourceCommit, firstCommit)
  assert.equal(day9Source.sourceCommit, secondCommit)

  const cursor = await readJson<{ processedThroughCommit: string }>(join(fixture.groupRoot, FORMATION_SNAPSHOT_CURSOR_PATH))
  assert.equal(cursor.processedThroughCommit, secondCommit)
})

test('later pre-kickoff saves overwrite the same target snapshot and the newest commit wins', async () => {
  const fixture = await createFixture(realCalendar([
    [8, '2026-09-05T18:00:00Z'],
    [9, '2026-09-12T18:00:00Z'],
  ]))
  const before = git(fixture.groupRoot, 'rev-parse', 'HEAD')

  await commitTeam(fixture.groupRoot, { ...team(), name: 'Older' }, '2026-09-05T17:40:00Z')
  const newestCommit = await commitTeam(fixture.groupRoot, { ...team(), name: 'Newest' }, '2026-09-05T17:50:00Z')

  const result = await snapshotSavedFormations({
    groupRepoRoot: fixture.groupRoot,
    platformRepoRoot: fixture.platformRoot,
    fallbackBefore: before,
  })

  assert.equal(result.writtenSnapshots, 2)
  assert.equal((await readJson<Team>(join(fixture.groupRoot, dayTeamDocumentPath(BASKET, SEASON, 8, OWNER)))).name, 'Newest')
  const source = await readJson<{ sourceCommit: string }>(join(
    fixture.groupRoot,
    formationSnapshotSourceDocumentPath(BASKET, SEASON, 8, OWNER),
  ))
  assert.equal(source.sourceCommit, newestCommit)
})

test('a save at or after day 38 kickoff updates the cursor but never creates day 39', async () => {
  const fixture = await createFixture(realCalendar([[38, '2026-09-05T18:00:00Z']]))
  const before = git(fixture.groupRoot, 'rev-parse', 'HEAD')
  const commit = await commitTeam(fixture.groupRoot, team(), '2026-09-05T18:00:00Z')

  const result = await snapshotSavedFormations({
    groupRepoRoot: fixture.groupRoot,
    platformRepoRoot: fixture.platformRoot,
    fallbackBefore: before,
  })

  assert.equal(result.writtenSnapshots, 0)
  assert.equal(result.noTargetSnapshots, 1)
  const cursor = await readJson<{ processedThroughCommit: string }>(join(fixture.groupRoot, FORMATION_SNAPSHOT_CURSOR_PATH))
  assert.equal(cursor.processedThroughCommit, commit)
  await assert.rejects(readFile(join(fixture.groupRoot, dayTeamDocumentPath(BASKET, SEASON, 39, OWNER)), 'utf8'), /ENOENT/)
})

test('defers while RepositoryRevision manifest is updating and does not advance the cursor', async () => {
  const fixture = await createFixture(realCalendar([[8, '2026-09-05T18:00:00Z']]))
  const before = git(fixture.groupRoot, 'rev-parse', 'HEAD')
  await commitTeam(fixture.groupRoot, team(), '2026-09-05T17:59:00Z')
  await writeJson(join(fixture.groupRoot, 'manifest.json'), { schemaVersion: 2, revision: 2, updating: true })

  const result = await snapshotSavedFormations({
    groupRepoRoot: fixture.groupRoot,
    platformRepoRoot: fixture.platformRoot,
    fallbackBefore: before,
  })

  assert.equal(result.deferred, true)
  await assert.rejects(readFile(join(fixture.groupRoot, FORMATION_SNAPSHOT_CURSOR_PATH), 'utf8'), /ENOENT/)
  await assert.rejects(readFile(join(fixture.groupRoot, dayTeamDocumentPath(BASKET, SEASON, 8, OWNER)), 'utf8'), /ENOENT/)
})

async function createFixture(calendar: RealCalendar) {
  const root = await mkdtemp(join(tmpdir(), 'fantazone-formation-snapshot-'))
  const groupRoot = join(root, 'group')
  const platformRoot = join(root, 'platform')
  await mkdir(groupRoot, { recursive: true })
  git(groupRoot, 'init', '-b', 'main')
  git(groupRoot, 'config', 'user.name', 'Fantazone Test')
  git(groupRoot, 'config', 'user.email', 'fantazone-test@example.com')
  await writeJson(join(groupRoot, 'manifest.json'), { schemaVersion: 2, revision: 1, updating: false })
  git(groupRoot, 'add', 'manifest.json')
  commit(groupRoot, 'initialize group', '2026-09-01T12:00:00Z')
  await writeJson(join(platformRoot, realCalendarDocumentPath(SEASON)), calendar)
  return { groupRoot, platformRoot }
}

async function commitTeam(root: string, value: Team, at: string): Promise<string> {
  const path = seasonTeamDocumentPath(BASKET, SEASON, OWNER)
  await writeJson(join(root, path), value)
  git(root, 'add', path)
  commit(root, `save ${value.name}`, at)
  return git(root, 'rev-parse', 'HEAD')
}

function commit(root: string, message: string, at: string): void {
  execFileSync('git', ['commit', '-m', message], {
    cwd: root,
    stdio: 'ignore',
    env: { ...process.env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at },
  })
}

function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function realCalendar(days: Array<[number, string]>): RealCalendar {
  return {
    year: SEASON,
    days: days.map(([serieADay, date]) => ({
      year: SEASON,
      serieADay,
      games: [{
        home: { name: 'Roma', abbreviation: 'ROM' },
        away: { name: 'Milan', abbreviation: 'MIL' },
        date,
        homeGoals: null,
        awayGoals: null,
        delayed: false,
      }],
    })),
  }
}

function team(): Team {
  return {
    name: 'Current formation',
    owner: OWNER,
    additionalOwners: [],
    moneyFromRank: 0,
    lastUpdate: null,
    players: [],
  }
}
