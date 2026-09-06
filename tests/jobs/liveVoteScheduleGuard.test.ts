import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import test from 'node:test'

const SCRIPT = resolve('scripts/live-votes-schedule-guard.mjs')

async function runGuard(root: string, now: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [SCRIPT, '--root', root, '--now', now], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.on('error', reject)
    child.on('close', code => {
      if (code !== 0) reject(new Error(`guard exited ${code}: ${stderr}`))
      else resolvePromise(stdout.trim())
    })
  })
}

async function writeCalendar(root: string, games: Array<{ date: string | null; delayed: boolean }>) {
  const path = join(root, 'data/serie-a/calendars/15.json')
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify({
    year: 15,
    days: [{ year: 15, serieADay: 1, games: games.map(game => ({
      home: { name: 'Roma', abbreviation: 'rom' },
      away: { name: 'Milan', abbreviation: 'mil' },
      homeGoals: null,
      awayGoals: null,
      ...game,
    })) }],
  }), 'utf8')
}

test('scheduled live-vote guard runs during the legacy 2h15 live-match window', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fantazone-live-guard-'))
  await writeCalendar(root, [{ date: '2026-09-06T18:45:00Z', delayed: false }])
  assert.equal(await runGuard(root, '2026-09-06T20:00:00Z'), 'true')
  assert.equal(await runGuard(root, '2026-09-06T21:00:01Z'), 'false')
})

test('scheduled live-vote guard ignores future and delayed games', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fantazone-live-guard-'))
  await writeCalendar(root, [
    { date: '2026-09-06T22:00:00Z', delayed: false },
    { date: '2026-09-06T18:45:00Z', delayed: true },
  ])
  assert.equal(await runGuard(root, '2026-09-06T20:00:00Z'), 'false')
})

test('scheduled live-vote guard is a no-op when calendar data is absent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fantazone-live-guard-'))
  assert.equal(await runGuard(root, '2026-09-06T20:00:00Z'), 'false')
})
