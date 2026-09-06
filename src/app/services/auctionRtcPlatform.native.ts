import { createInstalledNativeAuctionNegotiatorFactory } from './auctionNativeWebRtcRuntime.native'
import type { AuctionPlatformNegotiatorFactory } from './auctionRtcPlatform'

export function createAuctionPlatformNegotiatorFactory(): AuctionPlatformNegotiatorFactory {
  return createInstalledNativeAuctionNegotiatorFactory()
}
