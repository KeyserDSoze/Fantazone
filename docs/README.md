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
9. [`09-event-demo.md`](09-event-demo.md) — event/workshop explanation path.
10. [`10-public-security-model.md`](10-public-security-model.md) — source/data visibility and credential boundaries.
11. [`11-repository-json-store.md`](11-repository-json-store.md) — typed JSON cache and SHA concurrency.
12. [`12-calendar-migration.md`](12-calendar-migration.md) — Calendar migration.
13. [`13-ranking-migration.md`](13-ranking-migration.md) — Ranking migration.
14. [`14-group-json-login-flow.md`](14-group-json-login-flow.md) — Group + group-first login.
15. [`15-group-session-runtime.md`](15-group-session-runtime.md) — selected-group composition root.
16. [`16-team-migration.md`](16-team-migration.md) — Team/Player migration.
17. [`17-readable-json-schema-v2.md`](17-readable-json-schema-v2.md) — readable schema-v2 policy.
18. [`18-live-group-schema-v2.md`](18-live-group-schema-v2.md) — readable LiveGroup snapshot and helper migration.
19. [`19-web-oauth-group-invites.md`](19-web-oauth-group-invites.md) — `fanta.plus` Google/Microsoft login, group membership gate and email-bound Admin invites.
20. [`20-game-wrapper-composition.md`](20-game-wrapper-composition.md) — local ephemeral GameWrapper composition replacing the legacy `/Game/Get` aggregate endpoint.

## Source of truth

Fantasoccer remains the product/behavior reference. Fantazone persists readable camelCase schema-v2 domain documents directly and does not recreate single-letter `*Raw` naming models.
