# Migration checklist

`[ ]` pending, `[~]` in progress/scaffolded, `[x]` implemented with tests.

## Foundation

- [x] Initialize Fantazone repository.
- [x] Add target documentation structure.
- [~] Bootstrap Expo/React Native/Tamagui app.
- [~] Bootstrap shared TypeScript domain and GitHub client.
- [~] Bootstrap GitHub Actions and job runner.
- [~] GitHub Pages static export; canonical custom domain is `https://fanta.plus`.
- [x] Introduce readable JSON schema v2 and remove single-letter domain persistence for Group/Calendar/Rank/Team.
- [ ] Port Fantasoccer lint/format conventions.

## Identity and groups

- [ ] Wire Google login after group selection to the configured `fanta.plus` client.
- [ ] Wire Microsoft login after group selection to the configured `fanta.plus` client.
- [~] PAT validation and `Fantazone.*` repository discovery before login.
- [x] schema-v2 group initialization (`id/name/leagues/users/baskets`).
- [x] group-scoped membership resolution by authenticated email from `group.users`.
- [~] secure native PAT persistence and explicit web credential policy.
- [~] invite fragment import/share; QR pending.
- [~] group switch flow.
- [~] connected-group repository/login gate.
- [~] GroupSession runtime sharing Group/Calendar/Ranking/Team repositories.
- [ ] authenticated application session after Google/Microsoft membership resolution.

## UI parity

- [ ] App shell/navigation.
- [~] Light/dark themes.
- [ ] Home.
- [ ] Calendar UI.
- [ ] Game/day view.
- [ ] Formation/field/player cards/swaps.
- [ ] Ranking/luck UI.
- [ ] Live Serie A/live votes.
- [ ] Players/statistics.
- [ ] Teams UI.
- [ ] Market/trades.
- [ ] Cards administration.
- [ ] Group users/baskets/leagues administration.
- [ ] Settings/rules.
- [ ] Hall of Fame/logs/patch notes/push UX.

## Service/domain migrations

- [x] Group readable domain + GitHub read/write repository.
- [x] Calendar readable domain + GitHub read repository.
- [x] Ranking readable domain + season/day reads and writes.
- [x] Team/Player readable domain + season/day reads/writes + Ranking-derived money behavior.
- [ ] Game/day.
- [ ] Formations.
- [ ] Live group/results (rebuild on schema v2; do not merge the old compact branch).
- [ ] Real players / Serie A.
- [ ] Statistics/chances/votes.
- [ ] Market persistence and commands.

## API/storage replacement

- [ ] Replace every `buildApiUrl(...)` call.
- [~] Remove backend JWT/AppIdentity dependency; OAuth adapter pending.
- [~] Replace `rystem.repository.client` with GitHub adapters.
- [ ] Replace Azure/static storage URLs.
- [~] SHA-aware in-memory JSON cache.
- [ ] HTTP ETag / conditional GET.
- [~] optimistic concurrency conflict handling.
- [ ] one-time migration tooling for any schema-v1 compact group repositories/data.

## Background jobs

- [ ] SerieAJob / players-teams ingestion.
- [ ] live/final votes jobs.
- [ ] odds/images jobs.
- [ ] formation/groups manager jobs.
- [ ] HallOfFame/Market jobs.
- [ ] single-day and full-season recalculation.

## Auction

- [ ] Port auction domain/types/helpers using readable schema-v2 documents.
- [ ] Port auction UI.
- [ ] WebRTC host/participant abstraction and GitHub signaling.
- [ ] sequence/timer/bid validation/idempotency.
- [ ] checkpoint final player assignments to GitHub.
- [ ] reconnection/STUN/TURN/host-loss decisions.

## Definition of done

A migrated feature preserves Fantasoccer behavior where desired, persists readable schema-v2 JSON, has representative tests, and no longer depends on the legacy backend/storage transport. Do not add a second compact representation as a compatibility shortcut.
