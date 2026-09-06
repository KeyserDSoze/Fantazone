import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createAuctionSessionDescriptionSignal,
  createAuctionSignalingRoom,
  createEmptyAuctionPeerIndex,
  isAuctionSignalingRoomExpired,
  upsertAuctionSignalingPeer,
  validateAuctionSessionDescriptionSignal,
} from '../../src/domain/src/index'

test('creates expiring normalized signaling rooms and peer indexes', () => {
  const room = createAuctionSignalingRoom({
    auctionId: 'auction-1',
    sessionId: 'session-1',
    hostPeerId: 'host-peer',
    hostEmail: ' HOST@Example.com ',
    now: new Date('2026-09-06T18:00:00Z'),
    ttlMs: 60_000,
  })

  assert.equal(room.hostEmail, 'host@example.com')
  assert.equal(room.expiresAt, '2026-09-06T18:01:00.000Z')
  assert.equal(isAuctionSignalingRoomExpired(room, new Date('2026-09-06T18:00:59Z')), false)
  assert.equal(isAuctionSignalingRoomExpired(room, new Date('2026-09-06T18:01:00Z')), true)
  assert.deepEqual(createEmptyAuctionPeerIndex(room), {
    version: 1,
    auctionId: 'auction-1',
    sessionId: 'session-1',
    peers: [],
  })
})

test('upserts peer heartbeats without allowing peer-id identity takeover', () => {
  const room = createAuctionSignalingRoom({
    auctionId: 'auction-1', sessionId: 'session-1', hostPeerId: 'host', hostEmail: 'host@example.com',
    now: new Date('2026-09-06T18:00:00Z'),
  })
  const first = upsertAuctionSignalingPeer(createEmptyAuctionPeerIndex(room), {
    peerId: 'alice-device', email: 'Alice@Example.com', at: new Date('2026-09-06T18:00:01Z'),
  })
  const heartbeat = upsertAuctionSignalingPeer(first, {
    peerId: 'alice-device', email: 'alice@example.com', at: new Date('2026-09-06T18:00:05Z'),
  })

  assert.equal(heartbeat.peers.length, 1)
  assert.equal(heartbeat.peers[0]?.email, 'alice@example.com')
  assert.equal(heartbeat.peers[0]?.joinedAt, '2026-09-06T18:00:01.000Z')
  assert.equal(heartbeat.peers[0]?.lastSeenAt, '2026-09-06T18:00:05.000Z')
  assert.throws(
    () => upsertAuctionSignalingPeer(heartbeat, { peerId: 'alice-device', email: 'mallory@example.com' }),
    /another identity/i,
  )
})

test('description signals bind SDP type, auction, session and peer', () => {
  const room = createAuctionSignalingRoom({
    auctionId: 'auction-1', sessionId: 'session-1', hostPeerId: 'host', hostEmail: 'host@example.com',
  })
  const signal = createAuctionSessionDescriptionSignal({
    room,
    peerId: 'alice-device',
    kind: 'offer',
    sdp: 'v=0\r\n...',
    now: new Date('2026-09-06T18:00:00Z'),
  })

  assert.doesNotThrow(() => validateAuctionSessionDescriptionSignal(signal))
  assert.deepEqual(signal.description, { type: 'offer', sdp: 'v=0\r\n...' })
  assert.throws(
    () => validateAuctionSessionDescriptionSignal({ ...signal, description: { type: 'answer', sdp: signal.description.sdp } }),
    /does not match/i,
  )
})
