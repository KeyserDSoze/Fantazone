# Auction realtime lifecycle

Fantazone uses GitHub only as a slow rendezvous and durability boundary for auctions. Bid traffic must not become repository commits.

## Connection lifecycle

1. The host publishes one signaling room for the auction/session.
2. A participant registers one stable `peerId` with a monotonic `generation`.
3. The host creates a complete non-trickle SDP offer for that exact peer generation.
4. The participant publishes an answer for the same generation.
5. Once the ordered `fantazone-auction-v1` DataChannel opens, the participant stops GitHub signaling polling and requests the current auction checkpoint from the host.
6. Commands/events then travel only over the DataChannel. Durable assignment outcomes continue to cross the existing GitHub Action boundary.

## Reconnect

A participant keeps the same `peerId` across reconnects. `RTCPeerConnection.connectionState === failed` triggers an immediate reconnect; `disconnected` gets a short grace period first. Reconnect increments the peer `generation`, causing the host to discard the old negotiator and publish a fresh offer.

Offer and answer documents also carry the peer generation. This prevents a stale answer left in GitHub from being applied to a newly created `RTCPeerConnection`.

Every reopened DataChannel asks for a full checkpoint before normal realtime traffic continues. The checkpoint restores the participant sequence cursor and makes missed events harmless.

## Network traversal

The default ICE configuration uses Cloudflare STUN (`stun:stun.cloudflare.com:3478`) and accepts an injected ICE-server list. TURN credentials are deliberately not embedded in the client. A production TURN strategy remains required for restrictive NAT/firewall cases.

## Browser

`BrowserAuctionRtcNegotiator` wraps the browser `RTCPeerConnection`, waits for complete non-trickle ICE gathering and exposes the ordered DataChannel through the transport-agnostic realtime controller.

## Native iOS/Android

`auctionNativeWebRtc.ts` is a structural bridge for the `react-native-webrtc` module. The upstream native API exposes the same peer-connection/data-channel surface used by the browser negotiator, so Fantazone deliberately reuses the already-tested negotiation, signaling and reconnect implementation instead of maintaining a second protocol stack.

The bridge is injected: importing the web bundle or running Node CI does not load a native module. The actual Expo development/production build still needs the compatible `react-native-webrtc` package and `@config-plugins/react-native-webrtc` config plugin installed and configured. This final package/native-build integration is kept separate so an unsupported native dependency cannot break the web application.
