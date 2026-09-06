const { AndroidConfig, createRunOncePlugin } = require('expo/config-plugins')

/**
 * Fantazone uses react-native-webrtc only for auction DataChannels. The community
 * plugin enables camera, microphone, overlay and Bluetooth permissions intended for
 * audio/video calling; those are deliberately not requested here.
 *
 * React Native autolinking installs the native module itself. This plugin only makes
 * the Android network permissions explicit in generated projects.
 */
function withFantazoneDataChannelWebRtc(config) {
  return AndroidConfig.Permissions.withPermissions(config, [
    'android.permission.INTERNET',
    'android.permission.ACCESS_NETWORK_STATE',
    'android.permission.CHANGE_NETWORK_STATE',
  ])
}

module.exports = createRunOncePlugin(
  withFantazoneDataChannelWebRtc,
  'with-fantazone-datachannel-webrtc',
  '1.0.0',
)
