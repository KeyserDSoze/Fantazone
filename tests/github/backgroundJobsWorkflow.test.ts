import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('platform background workflow schedules calendar, guarded live votes, final votes and recurring platform ingestion', async () => {
  const workflow = await readFile('.github/workflows/background-jobs.yml', 'utf8')
  assert.match(workflow, /cron: '\*\/5 \* \* \* \*'/)
  assert.match(workflow, /cron: '27 2 \* \* \*'/)
  assert.match(workflow, /cron: '7 3 \* \* \*'/)
  assert.match(workflow, /cron: '7 4 \* \* \*'/)
  assert.match(workflow, /cron: '17 4 \* \* \*'/)
  assert.match(workflow, /github\.event\.schedule == '27 2 \* \* \*' && 'ingest-serie-a'/)
  assert.match(workflow, /github\.event\.schedule == '7 3 \* \* \*' && 'ingest-final-votes'/)
  assert.match(workflow, /github\.event\.schedule == '7 4 \* \* \*' && 'ingest-final-votes'/)
  assert.match(workflow, /github\.event\.schedule == '17 4 \* \* \*' && 'ingest-master-data'/)
  assert.match(workflow, /github\.event_name == 'schedule' && 'ingest-live-votes'/)
  assert.match(workflow, /node scripts\/live-votes-schedule-guard\.mjs --github-output/)
  assert.match(workflow, /ingest-serie-a "\$\{\{ steps\.live_guard\.outputs\.day \}\}" "\$\{\{ steps\.live_guard\.outputs\.season \}\}"/)
  assert.match(workflow, /continue-on-error: true/)
  assert.match(workflow, /Live votes were still attempted and canonical diffs were committed, but the Serie A calendar refresh failed\./)
  assert.match(workflow, /No Serie A match is live; skipping dependency install and provider calls\./)
  assert.match(workflow, /group: fantazone-platform-background-jobs/)
  assert.match(workflow, /cancel-in-progress: false/)
})
