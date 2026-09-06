import { RTCPeerConnection } from 'react-native-webrtc'
import type { ReactNativeWebRtcModuleLike } from './auctionNativeWebRtc'

/** Native-only module entry resolved by Metro for iOS/Android builds. */
export const nativeAuctionWebRtcModule: ReactNativeWebRtcModuleLike = {
  RTCPeerConnection: RTCPeerConnection as unknown as ReactNativeWebRtcModuleLike['RTCPeerConnection'],
}
