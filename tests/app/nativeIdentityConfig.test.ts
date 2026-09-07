import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_MICROSOFT_NATIVE_REDIRECT_URI,
  MICROSOFT_NATIVE_SCHEME,
} from '../../src/app/config/identity'

const appJsonPath = fileURLToPath(new URL('../../src/app/app.json', import.meta.url))

test('Expo native scheme matches the default Microsoft deep-link redirect', async () => {
  const appConfig = JSON.parse(await readFile(appJsonPath, 'utf8')) as {
    expo?: { scheme?: string; ios?: { bundleIdentifier?: string }; android?: { package?: string } }
  }

  assert.equal(appConfig.expo?.scheme, MICROSOFT_NATIVE_SCHEME)
  assert.equal(DEFAULT_MICROSOFT_NATIVE_REDIRECT_URI, `${appConfig.expo?.scheme}://auth`)
  assert.equal(appConfig.expo?.ios?.bundleIdentifier, 'com.keyserdsoze.fantaplus')
  assert.equal(appConfig.expo?.android?.package, 'com.keyserdsoze.fantazone')
})
