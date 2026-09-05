# Fantazone documentation

This documentation is the migration contract from `KeyserDSoze/Fantasoccer` to Fantazone. A feature is considered migrated when its behavior is preserved or an intentional difference is documented and tested.

## Documents

1. [`01-feature-inventory.md`](01-feature-inventory.md) — user-facing and domain functionality discovered in Fantasoccer.
2. [`02-zero-server-architecture.md`](02-zero-server-architecture.md) — target zero-backend architecture.
3. [`03-github-data-contract.md`](03-github-data-contract.md) — repository naming, readable schema v2, group-first onboarding and concurrency rules.
4. [`04-background-jobs.md`](04-background-jobs.md) — legacy job inventory and GitHub Actions migration matrix.
5. [`05-webrtc-auction.md`](05-webrtc-auction.md) — SignalR-to-WebRTC migration and auction host protocol.
6. [`06-migration-checklist.md`](06-migration-checklist.md) — executable migration backlog.
7. [`07-runtime-topology.md`](07-runtime-topology.md) — shared/global ingestion vs per-group GitHub Action responsibilities.
8. [`08-legacy-service-matrix.md`](08-legacy-service-matrix.md) — old frontend services mapped to GitHub, local domain logic, Actions or WebRTC.
9. [`09-event-demo.md`](09-event-demo.md) — short and extended paths for explaining Fantazone at events/workshops.
10. [`10-public-security-model.md`](10-public-security-model.md) — public source repository vs private real-group data and credential boundaries.
11. [`11-repository-json-store.md`](11-repository-json-store.md) — typed JSON cache, SHA-based optimistic concurrency and GitHub reads.
12. [`12-calendar-migration.md`](12-calendar-migration.md) — Calendar domain + GitHub repository slice.
13. [`13-ranking-migration.md`](13-ranking-migration.md) — season/daily Ranking domain and Action-compatible write side.
14. [`14-group-json-login-flow.md`](14-group-json-login-flow.md) — readable Group persistence plus PAT → group → login → membership ordering.
15. [`15-group-session-runtime.md`](15-group-session-runtime.md) — selected-group composition root, shared repository cache and pre-login gate.
16. [`16-team-migration.md`](16-team-migration.md) — readable Team/Player persistence, season/day repositories and Ranking integration.
17. [`17-readable-json-schema-v2.md`](17-readable-json-schema-v2.md) — removal of single-letter properties and one-time migration policy.

## Source of truth

Fantasoccer remains the product/behavior reference. Fantazone intentionally does **not** preserve its single-letter serialization names. From schema v2 onward, canonical GitHub JSON uses the same readable camelCase names as `@fantazone/domain`.

Storage paths, caching and GitHub SHA handling remain infrastructure concerns; domain JSON is designed to be understandable by people, TypeScript, Python Actions and other tooling without a naming mapper.
