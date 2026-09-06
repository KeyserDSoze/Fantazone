export type ActiveAuctionPointer = {
  version: 1
  leagueId: string
  season: number
  auctionId: string | null
  updatedAt: string
}

export function createActiveAuctionPointer(input: {
  leagueId: string
  season: number
  auctionId: string | null
  updatedAt?: Date
}): ActiveAuctionPointer {
  const leagueId = required(input.leagueId, 'League id')
  if (!Number.isInteger(input.season) || input.season < 1) throw new Error('Auction season must be a positive integer')
  const auctionId = input.auctionId === null ? null : required(input.auctionId, 'Auction id')
  return {
    version: 1,
    leagueId,
    season: input.season,
    auctionId,
    updatedAt: (input.updatedAt ?? new Date()).toISOString(),
  }
}

export function validateActiveAuctionPointer(value: ActiveAuctionPointer): void {
  if (value.version !== 1) throw new Error('Unsupported active auction pointer version')
  required(value.leagueId, 'League id')
  if (!Number.isInteger(value.season) || value.season < 1) throw new Error('Auction season must be a positive integer')
  if (value.auctionId !== null) required(value.auctionId, 'Auction id')
  if (!value.updatedAt || !Number.isFinite(new Date(value.updatedAt).getTime())) {
    throw new Error('Active auction pointer updatedAt is invalid')
  }
}

function required(value: string, label: string): string {
  const normalized = value?.trim()
  if (!normalized) throw new Error(`${label} is required`)
  return normalized
}
