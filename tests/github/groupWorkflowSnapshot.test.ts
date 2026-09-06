import assert from 'node:assert/strict'
import test from 'node:test'
import {
  GROUP_RECALCULATION_WORKFLOW,
  GROUP_REPOSITORY_RUNTIME_VERSION,
  GROUP_RUNTIME_ENGINE_REF,
} from '../../src/github/src/index'

test('group runtime v4 snapshots formations and serializes market commands automatically', () => {
  assert.equal(GROUP_REPOSITORY_RUNTIME_VERSION, 4)
  assert.equal(GROUP_RUNTIME_ENGINE_REF, 'group-runtime-v4')
  assert.match(GROUP_RECALCULATION_WORKFLOW, /push:/)
  assert.match(GROUP_RECALCULATION_WORKFLOW, /manifest\.json/)
  assert.match(GROUP_RECALCULATION_WORKFLOW, /data\/groups\/seasons\/\*\/teams\/\*\/\*\.json/)
  assert.match(GROUP_RECALCULATION_WORKFLOW, /data\/groups\/seasons\/\*\/markets\/\*\/commands\/\*\.json/)
  assert.match(GROUP_RECALCULATION_WORKFLOW, /snapshot-formations/)
  assert.match(GROUP_RECALCULATION_WORKFLOW, /process-market/)
  assert.match(GROUP_RECALCULATION_WORKFLOW, /cron: '0 2 \* \* \*'/)
  assert.match(GROUP_RECALCULATION_WORKFLOW, /FANTAZONE_SOURCE_BEFORE: \$\{\{ github\.event\.before \}\}/)
  assert.match(GROUP_RECALCULATION_WORKFLOW, /fetch-depth: 0/)
  assert.match(GROUP_RECALCULATION_WORKFLOW, /git checkout -B "\$GITHUB_REF_NAME" "origin\/\$GITHUB_REF_NAME"/)
  assert.match(GROUP_RECALCULATION_WORKFLOW, /git stash push -u -m fantazone-action -- data/)
  assert.match(GROUP_RECALCULATION_WORKFLOW, /git reset --hard "origin\/\$GITHUB_REF_NAME"/)
  assert.match(GROUP_RECALCULATION_WORKFLOW, /Unable to persist Fantazone data after 3 attempts/)
})
