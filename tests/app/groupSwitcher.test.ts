import assert from 'node:assert/strict'
import test from 'node:test'
import {
  consumeManualGroupSwitchRequest,
  markManualGroupSwitchRequest,
} from '../../src/app/services/groupSwitcher'

test('manual group switch request is consumed exactly once', () => {
  assert.equal(consumeManualGroupSwitchRequest(), false)
  markManualGroupSwitchRequest()
  assert.equal(consumeManualGroupSwitchRequest(), true)
  assert.equal(consumeManualGroupSwitchRequest(), false)
})
