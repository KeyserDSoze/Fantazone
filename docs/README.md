# Fantazone documentation

This documentation is the migration contract from `KeyserDSoze/Fantasoccer` to Fantazone. A feature is not considered migrated until its behavior is either preserved or an intentional difference is documented.

## Documents

1. [`01-feature-inventory.md`](01-feature-inventory.md) — user-facing and domain functionality discovered in Fantasoccer.
2. [`02-zero-server-architecture.md`](02-zero-server-architecture.md) — target zero-backend architecture.
3. [`03-github-data-contract.md`](03-github-data-contract.md) — repository naming, data layout, PAT onboarding and concurrency rules.
4. [`04-background-jobs.md`](04-background-jobs.md) — legacy job inventory and GitHub Actions migration matrix.
5. [`05-webrtc-auction.md`](05-webrtc-auction.md) — SignalR-to-WebRTC migration and auction host protocol.
6. [`06-migration-checklist.md`](06-migration-checklist.md) — executable migration backlog.
7. [`07-runtime-topology.md`](07-runtime-topology.md) — shared/global ingestion vs per-group GitHub Action responsibilities.
8. [`08-legacy-service-matrix.md`](08-legacy-service-matrix.md) — old frontend services mapped to GitHub, local domain logic, Actions or WebRTC.
9. [`09-event-demo.md`](09-event-demo.md) — short and extended paths for explaining Fantazone at events/workshops.
10. [`10-public-security-model.md`](10-public-security-model.md) — public-repository data classification and V1 credential boundaries.
11. [`11-repository-json-store.md`](11-repository-json-store.md) — typed JSON cache, SHA-based optimistic concurrency and public GitHub reads.
12. [`12-calendar-migration.md`](12-calendar-migration.md) — first end-to-end Fantasoccer repository-service migration using the shared domain + GitHubJsonStore pattern.

## Source of truth

The starting implementation is Fantasoccer. The legacy app already contains Expo/React Native, Tamagui, Google/Microsoft authentication, PWA behavior, theme switching, auction UI, league administration, market, cards, ranking, calendar, live Serie A, formations, teams, players, Hall of Fame, logs and push-notification features. Fantazone must preserve that product surface while replacing backend/storage/realtime integrations.

Documentation should be updated in the same PR that changes a migrated contract.
