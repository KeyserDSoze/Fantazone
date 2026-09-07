import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const workflowPath = fileURLToPath(new URL('../../.github/workflows/background-jobs.yml', import.meta.url))

test('background workflow names runs with the effective platform job', async () => {
  const workflow = await readFile(workflowPath, 'utf8')

  assert.match(workflow, /^name: Background jobs$/m)
  assert.match(workflow, /^run-name: .*inputs\.job.*ingest-master-data.*ingest-live-votes/m)
  assert.match(workflow, /- ingest-player-odds/)
  assert.match(workflow, /- ingest-player-images/)
  assert.match(workflow, /FANTAZONE_JOB:/)
})
