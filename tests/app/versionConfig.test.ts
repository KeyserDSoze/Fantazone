import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { APP_VERSION } from '../../src/app/config/version'

function readJson(relativeUrl: string): any {
  return JSON.parse(readFileSync(fileURLToPath(new URL(relativeUrl, import.meta.url)), 'utf8'))
}

test('release version stays synchronized across app metadata and update manifest', () => {
  const rootPackage = readJson('../../package.json')
  const appPackage = readJson('../../src/app/package.json')
  const expoConfig = readJson('../../src/app/app.json')
  const publishedVersion = readJson('../../src/app/public/version.json')

  assert.equal(rootPackage.version, APP_VERSION)
  assert.equal(appPackage.version, APP_VERSION)
  assert.equal(expoConfig.expo.version, APP_VERSION)
  assert.equal(publishedVersion.version, APP_VERSION)
})
