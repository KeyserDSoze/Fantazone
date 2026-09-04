# WebRTC auction architecture

## Objective

Replace the existing SignalR hub with peer-to-peer WebRTC DataChannels while preserving the live-auction product surface.

## Topology

Use a star topology:

```text
participant A ----\
participant B -----\
participant C ------> AUCTIONEER/HOST
participant D -----/
participant E ----/
```

The auctioneer device is the authoritative temporary server. Participants do not form a full mesh.

## Host responsibilities

- maintain canonical in-memory `AuctionState`;
- validate bids, budgets, role and auction status;
- assign a monotonic `sequence` to every accepted event;
- update/reset timers;
- resolve player assignment;
- broadcast accepted events/snapshots;
- reject stale/invalid client commands;
- periodically checkpoint enough state for recovery;
- commit finalized player assignments/outcomes to GitHub.

## Event protocol

Client -> host command example:

```json
{
  "type": "PLACE_BID",
  "commandId": "uuid",
  "auctionId": "...",
  "participantId": "...",
  "amount": 27,
  "clientTime": 1788550000000
}
```

Host -> peers accepted event:

```json
{
  "type": "BID_ACCEPTED",
  "sequence": 193,
  "commandId": "uuid",
  "participantId": "...",
  "amount": 27,
  "hostTime": 1788550000042
}
```

Every peer applies events strictly by host sequence and requests a snapshot when a gap is detected.

## Signaling without an application server

GitHub can be used as slow rendezvous/signaling storage:

```text
realtime/auctions/<id>/signaling/<peerId>/offer.json
realtime/auctions/<id>/signaling/<peerId>/answer.json
```

To minimize commits, gather ICE candidates before publishing SDP when practical. Once the DataChannel is established, stop GitHub polling for realtime auction traffic.

A future alternative may use manual QR/local signaling for participants physically in the same room.

## STUN/TURN

Configure STUN for normal NAT traversal. Some networks cannot establish direct P2P connectivity and require TURN relay. Fantazone must expose connection diagnostics and a fallback policy; strict zero-external-infrastructure mode cannot promise universal connectivity.

## Recovery

V1: the auctioneer device must remain online. If it disappears, pause the auction and require host recovery/reconnect.

V2: implement host migration using the latest checkpoint + peer event log, elect a new host, create a new WebRTC star, then resume at the next sequence.

## GitHub persistence boundary

Do not commit every bid. Commit checkpoints and finalized business events such as `PLAYER_ASSIGNED`, pause/close checkpoints and final auction result. This avoids rate-limit/concurrency problems and keeps Git history meaningful.
