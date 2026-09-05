# Migration checklist

This is the living backlog. `[ ]` means not yet migrated; `[~]` means scaffolded/being migrated; `[x]` means parity tests exist and legacy integration has been removed.

## Foundation

- [x] Initialize Fantazone repository.
- [x] Add target documentation structure.
- [~] Bootstrap Expo/React Native/Tamagui app.
- [~] Bootstrap shared TypeScript domain and GitHub client.
- [~] Bootstrap GitHub Actions and job runner.
- [~] Add GitHub Pages web deployment (workflow + static export implemented; repository Pages source still needs one-time GitHub Actions enablement).
- [ ] Port Fantasoccer lint/format/test conventions.
- [~] Public educational/demo experience and event documentation.

## Identity and groups

- [ ] Port Google login after group selection.
- [ ] Port Microsoft login after group selection.
- [~] PAT validation and `Fantazone.*` repository discovery before login.
- [~] group/repository initialization contract.
- [~] preserve legacy `GroupRaw` JSON (`i/n/l/u/b`) directly in `config/group.json`.
- [~] group-scoped membership lookup by authenticated email.
- [~] secure native PAT persistence and V1 web credential persistence policy.
- [~] invite link + QR generation/import (fragment codec/import + link sharing implemented; QR pending).
- [~] group switch when one PAT can access multiple `Fantazone.*` repositories (discovery/choice implemented; full switch UX pending).
- [~] connected-group dashboard / repository status surface.
- [~] group members/roles domain parity; administration UI still pending.
- [ ] authenticated GroupSession provider: repository + Group + external identity + UserOfAGroup.

## UI parity

- [ ] App shell/navigation.
- [~] Light/dark themes.
- [ ] Home.
- [ ] Calendar screen (domain + GitHub read repository migrated; UI still pending).
- [ ] Game/day view.
- [ ] Formation/field/player cards/swaps.
- [ ] Ranking/luck screen (domain + GitHub season/daily repository migrated; UI/luck calculation still pending).
- [ ] Live Serie A/live votes.
- [ ] Players/statistics.
- [ ] Teams.
- [ ] Market.
- [ ] Trades.
- [ ] Cards administration.
- [ ] Group users/baskets/leagues administration.
- [ ] Settings/rules.
- [ ] Hall of Fame.
- [ ] Logs.
- [ ] Patch notes/version update UX.
- [ ] Push notification UX.

## Service/domain migrations

- [~] Group raw contract, mappings/helpers and GitHub read/write repository.
- [~] Calendar raw contract, mappings/helpers and GitHub read repository.
- [~] Ranking raw contract, mappings/helpers, season/daily reads and Action-compatible writes.
- [ ] Teams.
- [ ] Game/day.
- [ ] Formations.
- [ ] Live group/results.
- [ ] Real players / Serie A.
- [ ] Statistics/chances/votes.
- [ ] Market persistence and commands.

## API/storage replacement

- [ ] Replace every `buildApiUrl(...)` call.
- [ ] Remove backend JWT exchange dependency from repository operations.
- [~] Replace `rystem.repository.client` storage endpoints with GitHub repository adapters (Group + Calendar + Ranking implemented; remaining services pending).
- [ ] Replace Azure/static storage URLs with repository content URLs.
- [~] Add SHA-aware in-memory JSON cache.
- [ ] Add HTTP ETag / conditional GET support.
- [~] Add optimistic-concurrency conflict handling.
- [~] Support unauthenticated reads of public canonical repository data.
- [ ] Introduce append-only commands/events only where a high-contention feature needs them; keep canonical legacy JSON projections unchanged.

## Background jobs

- [ ] SerieAJob.
- [ ] AllPlayersAndAllTeamsJob.
- [ ] LiveVotesJob.
- [ ] LiveJob.
- [ ] FinalVotesJob.
- [ ] PlayerOddsJob.
- [ ] PlayerImagesJob.
- [ ] SetFormationJob.
- [ ] GroupsManagerJob.
- [ ] NewsJob decision/migration.
- [ ] TeamHelperJob decision/migration.
- [ ] PushNotificationJob decision/migration.
- [ ] HallOfFameJob.
- [ ] MarketJob.
- [ ] single-day recalculation.
- [ ] full-season/all-days recalculation.

## Auction

- [ ] Port auction domain types/helpers.
- [ ] Port auction screen/components unchanged where possible.
- [ ] Implement WebRTC host/participant abstraction.
- [ ] GitHub-based signaling.
- [ ] host sequence/event protocol.
- [ ] timer synchronization.
- [ ] bid validation and idempotency.
- [ ] team/budget broadcast updates.
- [ ] player assignment checkpoint to GitHub.
- [ ] pause/resume/close/reset.
- [ ] emoji/reaction channel.
- [ ] reconnection/snapshot recovery.
- [ ] STUN config.
- [ ] TURN/fallback decision.
- [ ] host-loss UX; later host migration.

## Definition of done

A feature is migrated only when the corresponding Fantasoccer screen/service behavior is represented by tests or fixtures, its persisted raw JSON contract is preserved unless an explicit migration says otherwise, and the old HTTP/SignalR/storage dependency is gone.
