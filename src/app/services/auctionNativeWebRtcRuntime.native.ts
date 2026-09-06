import { RTCPeerConnection } from 'react-native-webrtc'
import {
  createNativeAuctionBrowserNegotiatorFactory,
  type ReactNativeWebRtcModuleLike,
} from './auctionNativeWebRtc'

/**
 * Native-only runtime entry point. Keeping the concrete react-native-webrtc import in
 * a `.native.ts` module prevents the static web bundle from evaluating native code.
 * Expo Go is intentionally unsupported: use the existing expo-dev-client build.
 */
export function createInstalledNativeAuctionNegotiatorFactory() {
  return createNativeAuctionBrowserNegotiatorFactory(installedReactNativeWebRtcModule())
}

export function installedReactNativeWebRtcModule(): ReactNativeWebRtcModuleLike {
  return { RTCPeerConnection: RTCPeerConnection as unknown as ReactNativeWebRtcModuleLike['RTCPeerConnection'] }
}
