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

`auctionNativeWebRtc.ts` is the structural bridge for `react-native-webrtc`. The upstream native API exposes the peer-connection/data-channel surface used by the browser negotiator, so Fantazone deliberately reuses the already-tested negotiation, signaling and reconnect implementation instead of maintaining a second protocol stack.

The application now installs `react-native-webrtc@124.0.8`. The concrete package import lives only in `auctionNativeWebRtcRuntime.native.ts`, which converts the installed native module into the existing auction negotiator factory. The web bundle therefore never evaluates `react-native-webrtc` native code.

Expo Go is not supported because the package contains native code; native auction testing must use the existing `expo-dev-client` / generated native build. We intentionally do **not** add `@config-plugins/react-native-webrtc` yet: its published compatibility table currently stops at Expo SDK 56 while Fantazone targets SDK 57. The package is left to React Native/Expo autolinking until SDK-57 config-plugin support is explicitly published and reviewed.

The remaining native gate is a clean Expo prebuild plus iOS/Android device build and an end-to-end DataChannel auction test. No camera or microphone permission is required for the auction transport itself because it uses DataChannel only.
