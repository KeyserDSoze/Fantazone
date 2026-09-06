import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appConfig = JSON.parse(readFileSync('src/app/app.json', 'utf8')) as {
  expo: {
    plugins: string[]
    android: { permissions?: string[] }
  }
}
const appPackage = JSON.parse(readFileSync('src/app/package.json', 'utf8')) as {
  dependencies: Record<string, string>
}
const pluginSource = readFileSync('src/app/plugins/withFantazoneDataChannelWebRtc.js', 'utf8')

test('pins the native WebRTC runtime and enables the Fantazone DataChannel config plugin', () => {
  assert.equal(appPackage.dependencies['react-native-webrtc'], '124.0.8')
  assert.ok(appConfig.expo.plugins.includes('./plugins/withFantazoneDataChannelWebRtc'))
})

test('DataChannel-only WebRTC configuration does not request media or overlay permissions', () => {
  const permissions = appConfig.expo.android.permissions ?? []
  assert.deepEqual(permissions.sort(), [
    'android.permission.ACCESS_NETWORK_STATE',
    'android.permission.CHANGE_NETWORK_STATE',
    'android.permission.INTERNET',
  ].sort())

  for (const forbidden of [
    'android.permission.CAMERA',
    'android.permission.RECORD_AUDIO',
    'android.permission.SYSTEM_ALERT_WINDOW',
    'NSCameraUsageDescription',
    'NSMicrophoneUsageDescription',
  ]) {
    assert.equal(pluginSource.includes(forbidden), false, `minimal WebRTC plugin must not add ${forbidden}`)
  }
})
