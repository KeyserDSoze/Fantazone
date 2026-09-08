import assert from 'node:assert/strict'
import test from 'node:test'
import { isNewerVersion } from '../../src/app/components/VersionUpdateBanner'

test('detects newer semantic application versions', () => {
  assert.equal(isNewerVersion('0.2.1', '0.2.0'), true)
  assert.equal(isNewerVersion('0.3.0', '0.2.9'), true)
  assert.equal(isNewerVersion('1.0.0', '0.9.9'), true)
  assert.equal(isNewerVersion('0.2.1', '0.2.1'), false)
  assert.equal(isNewerVersion('0.2.0', '0.2.1'), false)
})
