export function remainingAuctionSeconds(
  biddingStartedAt: string | null | undefined,
  secondsPerAuction: number,
  now: Date = new Date(),
): number | null {
  if (!Number.isFinite(secondsPerAuction) || secondsPerAuction <= 0) {
    throw new Error('Auction countdown duration must be positive')
  }
  if (!biddingStartedAt) return null
  const startedAt = new Date(biddingStartedAt).getTime()
  if (!Number.isFinite(startedAt)) return 0
  const elapsedMs = Math.max(0, now.getTime() - startedAt)
  return Math.max(0, Math.ceil(secondsPerAuction - elapsedMs / 1000))
}
