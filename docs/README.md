# Fantazone documentation

This documentation is the migration contract from `KeyserDSoze/Fantasoccer` to Fantazone. A feature is considered migrated when its behavior is preserved or an intentional difference is documented and tested.

## Documents

1. [`01-feature-inventory.md`](01-feature-inventory.md) — user-facing and domain functionality discovered in Fantasoccer.
2. [`02-zero-server-architecture.md`](02-zero-server-architecture.md) — target zero-backend architecture.
3. [`03-github-data-contract.md`](03-github-data-contract.md) — repository naming, readable schema v2, onboarding and concurrency rules.
4. [`04-background-jobs.md`](04-background-jobs.md) — legacy job inventory and platform-vs-group Actions migration matrix.
5. [`05-webrtc-auction.md`](05-webrtc-auction.md) — SignalR-to-WebRTC migration and auction host protocol.
6. [`06-migration-checklist.md`](06-migration-checklist.md) — executable migration backlog.
7. [`07-runtime-topology.md`](07-runtime-topology.md) — global ingestion, group-owned workflows and device responsibilities.
8. [`08-legacy-service-matrix.md`](08-legacy-service-matrix.md) — old frontend services mapped to GitHub, Local, Actions or WebRTC.
9. [`09-event-demo.md`](09-event-demo.md) — event/workshop explanation path.
10. [`10-public-security-model.md`](10-public-security-model.md) — source/data visibility and credential boundaries.
11. [`11-repository-json-store.md`](11-repository-json-store.md) — typed JSON cache and SHA concurrency.
12. [`12-calendar-migration.md`](12-calendar-migration.md) — Calendar migration.
13. [`13-ranking-migration.md`](13-ranking-migration.md) — Ranking migration.
14. [`14-group-json-login-flow.md`](14-group-json-login-flow.md) — Group + group-first login.
15. [`15-group-session-runtime.md`](15-group-session-runtime.md) — selected-group composition root.
16. [`16-team-migration.md`](16-team-migration.md) — Team/Player migration.
17. [`17-readable-json-schema-v2.md`](17-readable-json-schema-v2.md) — readable schema-v2 policy.
18. [`18-live-group-schema-v2.md`](18-live-group-schema-v2.md) — LiveGroup readable contract; persisted adapter is compatibility-only.
19. [`19-web-oauth-group-invites.md`](19-web-oauth-group-invites.md) — external login, membership gate and email-bound Admin invites.
20. [`20-game-wrapper-composition.md`](20-game-wrapper-composition.md) — local GameWrapper composition replacing `/Game/Get`.
21. [`21-formation-write-side.md`](21-formation-write-side.md) — validated TeamDay formation writes replacing `Game/SaveTeam`.
22. [`22-global-real-calendar.md`](22-global-real-calendar.md) — shared Serie A calendar and timing projections.
23. [`23-global-serie-a-master-data.md`](23-global-serie-a-master-data.md) — RealTeams/RealPlayers ingestion and reconciliation.
24. [`24-player-statistics-and-votes.md`](24-player-statistics-and-votes.md) — vote contract, FinalValue/statistics reducers and rebuild job.
25. [`25-serie-a-vote-ingestion.md`](25-serie-a-vote-ingestion.md) — official/live Fantacalcio vote producers and provider mapping.
26. [`26-local-live-composition.md`](26-local-live-composition.md) — local team/rank reducers, GroupLiveComposer and retirement of LiveJob.
27. [`27-definitive-day-recalculation.md`](27-definitive-day-recalculation.md) — definitive scoring/ranking, deterministic Cup/NewCup progression and group-owned recalculation workflow.
28. [`28-group-repository-lifecycle.md`](28-group-repository-lifecycle.md) — create-from-zero group repositories, managed runtime versioning, workflow upgrades and pinned engine refs.

## Source of truth

Fantasoccer remains the product/behavior reference. Fantazone persists readable camelCase schema-v2 domain documents directly and does not recreate compact single-letter `*Raw` models.
