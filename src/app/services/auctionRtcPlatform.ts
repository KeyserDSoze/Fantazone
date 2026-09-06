import { BrowserAuctionRtcNegotiator, type BrowserAuctionRtcOptions } from './auctionBrowserWebRtc'
import type { AuctionRtcNegotiator } from './auctionWebRtcSignaling'

export type AuctionPlatformNegotiatorFactory = (options: BrowserAuctionRtcOptions) => AuctionRtcNegotiator

/** Web/default implementation. Metro resolves auctionRtcPlatform.native.ts on iOS/Android. */
export function createAuctionPlatformNegotiatorFactory(): AuctionPlatformNegotiatorFactory {
  return options => new BrowserAuctionRtcNegotiator(options)
}
