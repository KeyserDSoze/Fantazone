import assert from 'node:assert/strict'
import test from 'node:test'
import {
  IdentityRole,
  type Group,
  type RealCalendar,
} from '../../src/domain/src/index'
import {
  dispatchSerieAPlatformJob,
  getSerieAAdminAccess,
  saveSerieADelayedChanges,
  type SerieAAdminGitHubClient,
  type SerieAAdminRuntime,
} from '../../src/app/services/serieAAdminService'
import type { GitHubRepo } from '../../src/github/src/index'

const admin = { username: 'Root', email: 'root@example.test', role: IdentityRole.SuperAdmin | IdentityRole.Admin }
const participant = { username: 'User', email: 'user@example.test', role: IdentityRole.Participant }

class FakeClient implements SerieAAdminGitHubClient {
  pushes = true
  dispatches: Array<{ owner: string; repo: string; workflowId: string; ref: string; inputs: Record<string, string> }> = []
  repositoryReads = 0

  async getRepository(owner: string, repo: string): Promise<GitHubRepo> {
    this.repositoryReads += 1
    return {
      name: repo,
      full_name: `${owner}/${repo}`,
      private: false,
      owner: { login: owner },
      default_branch: 'main',
      permissions: { pull: true, push: this.pushes, admin: this.pushes },
    }
  }

  async dispatchWorkflow(owner: string, repo: string, workflowId: string, ref: string, inputs: Record<string, string> = {}) {
    this.dispatches.push({ owner, repo, workflowId, ref, inputs: { ...inputs } })
  }
}

class FakeRuntime implements SerieAAdminRuntime {
  connection = { token: 'token' }
  platformTarget = { owner: 'KeyserDSoze', repo: 'Fantazone', ref: 'main' }
  current: Group
  calendar: RealCalendar | null
  snapshotSha = 'calendar-sha'
  writes: Array<{ calendar: RealCalendar; expectedSha?: string; branch?: string }> = []

  constructor(group: Group, calendar: RealCalendar | null = sampleCalendar()) {
    this.current = clone(group)
    this.calendar = cloneOrNull(calendar)
  }

  async refreshGroup() { return clone(this.current) }

  realCalendarRepository = {
    getCalendarSnapshot: async (_season: number) => this.calendar == null ? null : {
      value: clone(this.calendar),
      sha: this.snapshotSha,
    },
    writeCalendar: async (calendar: RealCalendar, _message?: string, options?: { expectedSha?: string; branch?: string }) => {
      this.calendar = clone(calendar)
      this.writes.push({ calendar: clone(calendar), expectedSha: options?.expectedSha, branch: options?.branch })
      return 'new-calendar-sha'
    },
  }
}

function group(): Group {
  return {
    id: 'g',
    name: 'Group',
    users: [admin, participant],
    baskets: [],
    leagues: [],
  }
}

function sampleCalendar(): RealCalendar {
  return {
    year: 15,
    days: [{
      year: 15,
      serieADay: 3,
      games: [
        {
          home: { name: 'Roma', abbreviation: 'rom' },
          away: { name: 'Milan', abbreviation: 'mil' },
          date: '2026-09-20T18:00:00.000Z',
          homeGoals: 2,
          awayGoals: 1,
          delayed: false,
        },
        {
          home: { name: 'Inter', abbreviation: 'int' },
          away: { name: 'Napoli', abbreviation: 'nap' },
          date: '2026-09-20T20:45:00.000Z',
          homeGoals: null,
          awayGoals: null,
          delayed: false,
        },
      ],
    }],
  }
}

test('Serie A platform writes require both fresh SuperAdmin role and PAT push permission', async () => {
  const runtime = new FakeRuntime(group())
  const client = new FakeClient()

  const deniedRole = await getSerieAAdminAccess(runtime, participant, client)
  assert.equal(deniedRole.canWrite, false)
  assert.match(deniedRole.reason ?? '', /SuperAdmin/i)
  assert.equal(client.repositoryReads, 0)

  client.pushes = false
  const deniedPush = await getSerieAAdminAccess(runtime, admin, client)
  assert.equal(deniedPush.canWrite, false)
  assert.match(deniedPush.reason ?? '', /push/i)

  client.pushes = true
  const allowed = await getSerieAAdminAccess(runtime, admin, client)
  assert.equal(allowed.canWrite, true)
  assert.equal(allowed.branch, 'main')
})

test('delayed updates are applied over a fresh calendar snapshot and preserve unrelated provider data', async () => {
  const runtime = new FakeRuntime(group())
  const client = new FakeClient()

  const result = await saveSerieADelayedChanges(runtime, admin, 15, [{
    serieADay: 3,
    home: 'roma',
    away: 'MILAN',
    delayed: true,
  }], client)

  assert.equal(result.changedGames, 1)
  assert.equal(result.calendar.days[0].games[0].delayed, true)
  assert.equal(result.calendar.days[0].games[0].homeGoals, 2)
  assert.equal(result.calendar.days[0].games[0].awayGoals, 1)
  assert.equal(result.calendar.days[0].games[1].date, '2026-09-20T20:45:00.000Z')
  assert.equal(runtime.writes.length, 1)
  assert.equal(runtime.writes[0].expectedSha, 'calendar-sha')
  assert.equal(runtime.writes[0].branch, 'main')
})

test('delayed update refuses a fixture that disappeared instead of overwriting a refreshed calendar by index', async () => {
  const runtime = new FakeRuntime(group())
  const client = new FakeClient()
  await assert.rejects(
    saveSerieADelayedChanges(runtime, admin, 15, [{ serieADay: 3, home: 'Juventus', away: 'Milan', delayed: true }], client),
    /non è più identificabile/i,
  )
  assert.equal(runtime.writes.length, 0)
})

test('platform jobs dispatch only after authorization and final votes require a day', async () => {
  const runtime = new FakeRuntime(group())
  const client = new FakeClient()

  await assert.rejects(
    dispatchSerieAPlatformJob(runtime, admin, { job: 'ingest-final-votes', season: 15 }, client),
    /richiede una giornata/i,
  )

  await dispatchSerieAPlatformJob(runtime, admin, { job: 'ingest-final-votes', season: 15, day: 3 }, client)
  assert.deepEqual(client.dispatches, [{
    owner: 'KeyserDSoze',
    repo: 'Fantazone',
    workflowId: 'background-jobs.yml',
    ref: 'main',
    inputs: { job: 'ingest-final-votes', season: '15', day: '3' },
  }])
})

test('platform mutation fails closed when PAT cannot push', async () => {
  const runtime = new FakeRuntime(group())
  const client = new FakeClient()
  client.pushes = false
  await assert.rejects(
    saveSerieADelayedChanges(runtime, admin, 15, [{ serieADay: 3, home: 'Roma', away: 'Milan', delayed: true }], client),
    /non ha permesso push/i,
  )
  assert.equal(runtime.writes.length, 0)
})

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }
function cloneOrNull<T>(value: T | null): T | null { return value == null ? null : clone(value) }
