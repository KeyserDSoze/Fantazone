import assert from 'node:assert/strict'
import test from 'node:test'
import {
  GROUP_RECALCULATION_WORKFLOW,
  GROUP_REPOSITORY_RUNTIME_VERSION,
  GROUP_RUNTIME_ENGINE_REF,
} from '../../src/github/src/index'

test('group runtime v9 serializes maintenance and publishes one compact offline snapshot', () => {
  assert.equal(GROUP_REPOSITORY_RUNTIME_VERSION, 9)
  assert.equal(GROUP_RUNTIME_ENGINE_REF, 'main')
  assert.match(GROUP_RECALCULATION_WORKFLOW, /push:/)
  assert.match(GROUP_RECALCULATION_WORKFLOW, /manifest\.json/)
  assert.match(GROUP_RECALCULATION_WORKFLOW, /config\/group\.json/)
  assert.match(GROUP_RECALCULATION_WORKFLOW, /settings\.json/)
  assert.match(GROUP_RECALCULATION_WORKFLOW, /fantazone\.json/)
  assert.match(GROUP_RECALCULATION_WORKFLOW, /\.github\/workflows\/fantazone-group\.yml/)
  assert.match(GROUP_RECALCULATION_WORKFLOW, /data\/groups\/seasons\/\*\/teams\/\*\/\*\.json/)
  assert.match(GROUP_RECALCULATION_WORKFLOW, /data\/groups\/seasons\/\*\/markets\/\*\/commands\/\*\.json/)
  assert.match(GROUP_RECALCULATION_WORKFLOW, /data\/groups\/seasons\/\*\/auctions\/\*\/outcomes\/\*\.json/)
  assert.match(GROUP_RECALCULATION_WORKFLOW, /snapshot-formations/)
  assert.match(GROUP_RECALCULATION_WORKFLOW, /process-market/)
  assert.match(GROUP_RECALCULATION_WORKFLOW, /process-auction-outcomes/)
  assert.doesNotMatch(GROUP_RECALCULATION_WORKFLOW, /sync-player-transfers/)
  assert.doesNotMatch(GROUP_RECALCULATION_WORKFLOW, /30 5 \* \* \*/)
  assert.match(GROUP_RECALCULATION_WORKFLOW, /rebuild-hall-of-fame/)
  assert.match(GROUP_RECALCULATION_WORKFLOW, /cron: '0 2 \* \* \*'/)
  assert.match(GROUP_RECALCULATION_WORKFLOW, /cron: '0 3 \* \* 2'/)
  assert.match(GROUP_RECALCULATION_WORKFLOW, /github\.event\.schedule == '0 3 \* \* 2'/)
  assert.match(GROUP_RECALCULATION_WORKFLOW, /FANTAZONE_SOURCE_BEFORE: \$\{\{ github\.event\.before \}\}/)
  assert.match(GROUP_RECALCULATION_WORKFLOW, /fetch-depth: 0/)
  assert.match(GROUP_RECALCULATION_WORKFLOW, /git checkout -B "\$GITHUB_REF_NAME" "origin\/\$GITHUB_REF_NAME"/)
  assert.match(GROUP_RECALCULATION_WORKFLOW, /git stash push -u -m fantazone-action -- data/)
  assert.match(GROUP_RECALCULATION_WORKFLOW, /git reset --hard "origin\/\$GITHUB_REF_NAME"/)
  assert.match(GROUP_RECALCULATION_WORKFLOW, /build-group-offline-pack\.mjs/)
  assert.match(GROUP_RECALCULATION_WORKFLOW, /\.fantazone\/offline\/group-snapshot\.json\.gz/)
  assert.match(GROUP_RECALCULATION_WORKFLOW, /offline: refresh group snapshot/)
  assert.match(GROUP_RECALCULATION_WORKFLOW, /Unable to publish the compact offline snapshot after 3 attempts/)
  assert.match(GROUP_RECALCULATION_WORKFLOW, /Unable to persist Fantazone data after 3 attempts/)
})
