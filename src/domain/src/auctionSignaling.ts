export type AuctionSignalingRoom = {
  version: 1
  auctionId: string
  sessionId: string
  hostPeerId: string
  hostEmail: string
  createdAt: string
  expiresAt: string
}

export type AuctionSignalingPeer = {
  peerId: string
  email: string
  joinedAt: string
  lastSeenAt: string
  /** Increments whenever the participant requests a fresh RTC connection. */
  generation: number
}

export type AuctionSignalingPeerIndex = {
  version: 1
  auctionId: string
  sessionId: string
  peers: AuctionSignalingPeer[]
}

export type AuctionSessionDescription = {
  type: 'offer' | 'answer'
  sdp: string
}

export type AuctionSessionDescriptionSignal = {
  version: 1
  auctionId: string
  sessionId: string
  peerId: string
  kind: 'offer' | 'answer'
  description: AuctionSessionDescription
  createdAt: string
}

const DEFAULT_ROOM_TTL_MS = 12 * 60 * 60 * 1000
const MAX_SIGNALING_PEERS = 64

export function createAuctionSignalingRoom(input: {
  auctionId: string
  sessionId: string
  hostPeerId: string
  hostEmail: string
  now?: Date
  ttlMs?: number
}): AuctionSignalingRoom {
  const now = input.now ?? new Date()
  const ttlMs = input.ttlMs ?? DEFAULT_ROOM_TTL_MS
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('Auction signaling room TTL must be positive')
  const auctionId = required(input.auctionId, 'Auction id')
  const sessionId = required(input.sessionId, 'Session id')
  const hostPeerId = required(input.hostPeerId, 'Host peer id')
  const hostEmail = normalizeEmail(input.hostEmail)
  if (!hostEmail.includes('@')) throw new Error('Host email is not valid')
  return {
    version: 1,
    auctionId,
    sessionId,
    hostPeerId,
    hostEmail,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  }
}

export function createEmptyAuctionPeerIndex(room: AuctionSignalingRoom): AuctionSignalingPeerIndex {
  validateAuctionSignalingRoom(room)
  return { version: 1, auctionId: room.auctionId, sessionId: room.sessionId, peers: [] }
}

export function upsertAuctionSignalingPeer(
  index: AuctionSignalingPeerIndex,
  input: { peerId: string; email: string; at?: Date; restart?: boolean },
): AuctionSignalingPeerIndex {
  validateAuctionSignalingPeerIndex(index)
  const peerId = required(input.peerId, 'Peer id')
  const email = normalizeEmail(input.email)
  if (!email.includes('@')) throw new Error('Peer email is not valid')
  const at = (input.at ?? new Date()).toISOString()
  const peers = index.peers.map(peer => ({ ...peer }))
  const existing = peers.find(peer => peer.peerId === peerId)
  if (existing) {
    if (normalizeEmail(existing.email) !== email) throw new Error('Peer id is already registered by another identity')
    existing.lastSeenAt = at
    if (input.restart) existing.generation += 1
  } else {
    if (peers.length >= MAX_SIGNALING_PEERS) throw new Error('Auction signaling room is full')
    peers.push({ peerId, email, joinedAt: at, lastSeenAt: at, generation: 1 })
  }
  peers.sort((a, b) => a.joinedAt.localeCompare(b.joinedAt) || a.peerId.localeCompare(b.peerId))
  return { ...index, peers }
}

export function createAuctionSessionDescriptionSignal(input: {
  room: AuctionSignalingRoom
  peerId: string
  kind: 'offer' | 'answer'
  sdp: string
  now?: Date
}): AuctionSessionDescriptionSignal {
  validateAuctionSignalingRoom(input.room)
  const peerId = required(input.peerId, 'Peer id')
  const sdp = required(input.sdp, 'SDP')
  return {
    version: 1,
    auctionId: input.room.auctionId,
    sessionId: input.room.sessionId,
    peerId,
    kind: input.kind,
    description: { type: input.kind, sdp },
    createdAt: (input.now ?? new Date()).toISOString(),
  }
}

export function isAuctionSignalingRoomExpired(room: AuctionSignalingRoom, now = new Date()): boolean {
  validateAuctionSignalingRoom(room)
  return new Date(room.expiresAt).getTime() <= now.getTime()
}

export function validateAuctionSignalingRoom(room: AuctionSignalingRoom): void {
  if (room.version !== 1) throw new Error('Unsupported auction signaling room version')
  required(room.auctionId, 'Auction id')
  required(room.sessionId, 'Session id')
  required(room.hostPeerId, 'Host peer id')
  if (!normalizeEmail(room.hostEmail).includes('@')) throw new Error('Host email is not valid')
  validateDate(room.createdAt, 'room createdAt')
  validateDate(room.expiresAt, 'room expiresAt')
  if (new Date(room.expiresAt).getTime() <= new Date(room.createdAt).getTime()) {
    throw new Error('Auction signaling room expires before it starts')
  }
}

export function validateAuctionSignalingPeerIndex(index: AuctionSignalingPeerIndex): void {
  if (index.version !== 1) throw new Error('Unsupported auction signaling peer index version')
  required(index.auctionId, 'Auction id')
  required(index.sessionId, 'Session id')
  if (!Array.isArray(index.peers) || index.peers.length > MAX_SIGNALING_PEERS) throw new Error('Invalid auction signaling peers')
  const ids = new Set<string>()
  for (const peer of index.peers) {
    required(peer.peerId, 'Peer id')
    if (ids.has(peer.peerId)) throw new Error(`Duplicate signaling peer '${peer.peerId}'`)
    ids.add(peer.peerId)
    if (!normalizeEmail(peer.email).includes('@')) throw new Error('Peer email is not valid')
    if (!Number.isInteger(peer.generation) || peer.generation < 1) throw new Error('Peer generation must be a positive integer')
    validateDate(peer.joinedAt, 'peer joinedAt')
    validateDate(peer.lastSeenAt, 'peer lastSeenAt')
  }
}

export function validateAuctionSessionDescriptionSignal(signal: AuctionSessionDescriptionSignal): void {
  if (signal.version !== 1) throw new Error('Unsupported auction signaling description version')
  required(signal.auctionId, 'Auction id')
  required(signal.sessionId, 'Session id')
  required(signal.peerId, 'Peer id')
  if (signal.kind !== 'offer' && signal.kind !== 'answer') throw new Error('Invalid signaling description kind')
  if (signal.description?.type !== signal.kind) throw new Error('SDP type does not match signaling kind')
  required(signal.description.sdp, 'SDP')
  validateDate(signal.createdAt, 'description createdAt')
}

function validateDate(value: string, label: string): void {
  if (!value || !Number.isFinite(new Date(value).getTime())) throw new Error(`Invalid ${label}`)
}

function required(value: string, label: string): string {
  const normalized = value?.trim()
  if (!normalized) throw new Error(`${label} is required`)
  return normalized
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}
