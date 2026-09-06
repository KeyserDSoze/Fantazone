import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('platform background workflow schedules guarded live votes every five minutes', async () => {
  const workflow = await readFile('.github/workflows/background-jobs.yml', 'utf8')
  assert.match(workflow, /cron: '\*\/5 \* \* \* \*'/)
  assert.match(workflow, /github\.event_name == 'schedule' && 'ingest-live-votes' \|\| inputs\.job/)
  assert.match(workflow, /node scripts\/live-votes-schedule-guard\.mjs/)
  assert.match(workflow, /No Serie A match is live; skipping dependency install and provider calls\./)
  assert.match(workflow, /group: fantazone-platform-background-jobs/)
  assert.match(workflow, /cancel-in-progress: false/)
})
