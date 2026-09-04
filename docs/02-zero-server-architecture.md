# Zero-server architecture

## Goal

Fantazone should have no always-on Fantazone application server. The client is hosted statically and persistent application state is represented as versioned files in GitHub repositories.

```text
                       +----------------------+
                       | GitHub repository    |
                       | config / data / state|
                       +----^-------------^---+
                            |             |
                   REST read/write       commits
                            |             |
+----------------+          |      +------+---------+
| Expo RN / Web  |----------+      | GitHub Actions|
| Tamagui client |                 | ingestion/jobs |
+-------+--------+                 +----------------+
        |
        | WebRTC DataChannel during auction
        v
+------------------+
| Auctioneer device|
| authoritative host
+------------------+
```

## Runtime responsibilities

### Client

- Google/Microsoft user identity.
- Group onboarding and PAT storage.
- GitHub repository discovery.
- Direct GitHub data reads/writes.
- ETag/SHA-based caching and optimistic concurrency.
- Pure calculations when inexpensive and deterministic.
- WebRTC peer and auction state machine.
- Offline/read cache where possible.

### GitHub repository

- group configuration;
- users/roles known to the group;
- leagues/baskets/competitions;
- teams and formations;
- calendars, votes, results, standings and historical state;
- market/trades and completed auction outcomes;
- static assets and normalized external-data snapshots;
- command/event log where append-only semantics reduce conflicts;
- manifest/version files for cheap polling.

### GitHub Actions

- external data ingestion/parsing;
- derived-state rebuilds;
- single-day and full-history recalculation;
- data validation/repair;
- static web build/deploy;
- CI/tests.

Canonical app data should be committed to the repository. Workflow artifacts are useful for raw downloads, diagnostics and intermediate snapshots but are not the application's durable database.

## Realtime

Normal screens may poll a lightweight manifest with ETags and refresh only when its revision changes. The auction must not use GitHub polling for every bid. WebRTC DataChannels carry realtime events and the auctioneer device assigns the authoritative sequence number. GitHub receives checkpoints/finalized events only.

## Identity versus repository authorization

Google/Microsoft login answers "who is this person inside Fantazone?". The V1 GitHub PAT answers "which GitHub repositories may this installation modify?". These are intentionally separate concepts.

A future migration may replace PATs with GitHub App/OAuth authorization without changing the `RepositoryClient` interface.

## Known zero-server boundaries

- Web push delivery may require vendor infrastructure and cannot be assumed to be implementable solely with static hosting.
- WebRTC can usually connect P2P using STUN, but some networks require TURN relay for reliable connectivity. TURN is network infrastructure, not application business backend, but strict zero-infrastructure mode cannot guarantee connectivity on every NAT/firewall.
- Browser scraping is often blocked by source-site CORS. Such ingestion belongs in Actions.
