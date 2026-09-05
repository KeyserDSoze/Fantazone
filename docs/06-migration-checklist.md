# Migration checklist

`[ ]` pending, `[~]` in progress/scaffolded, `[x]` implemented with tests.

## Foundation

- [x] Initialize Fantazone repository and documentation.
- [~] Expo/React Native/Tamagui app.
- [~] shared TypeScript domain/GitHub client/Actions runner.
- [x] GitHub Pages production deployment at canonical `https://fanta.plus` with automatic deploy from `main`.
- [x] readable JSON schema v2; no single-letter persistence for migrated features.

## Identity and groups

- [~] Google web adapter implemented but product login intentionally disabled until its web client is configured (`EXPO_PUBLIC_GOOGLE_LOGIN_ENABLED=false`).
- [x] Microsoft web login after group selection through authorization-code + PKCE; `common` authority by default and `https://fanta.plus` redirect.
- [~] PAT validation/repository discovery before login.
- [x] readable Group initialization and `group.users` membership resolution.
- [x] first-admin bootstrap for newly created/legacy-empty groups.
- [x] email-bound Admin/SuperAdmin group invitation flow: census member first, then share repository/PAT/expected-email link.
- [~] secure credential persistence and group switching; V1 web PAT still uses local storage.
- [x] GroupSession shares per-group repositories plus the global platform RealCalendar repository around one JSON store.
- [x] authenticated web session after provider email + selected-group membership resolution.
- [ ] native Google/Microsoft OAuth redirects/deep links for iOS/Android.

## UI parity

- [ ] App shell/Home.
- [ ] Calendar/Game/day/Formation UI.
- [ ] Ranking/luck UI.
- [ ] Live Serie A/votes.
- [ ] Players/statistics/Teams.
- [ ] Market/trades/cards/group admin/settings.
- [ ] Hall of Fame/logs/patch notes/push UX.

## Service/domain migrations

- [x] Group.
- [x] Calendar.
- [x] Ranking.
- [x] Team/Player.
- [x] LiveGroup readable snapshot/helpers/repository.
- [x] RealCalendar readable global schema + GitHub repository + legacy live/last/next timing projections.
- [~] Game/day: local GameWrapper composition and TeamDay formation persistence now derive editability from global RealCalendar; live player enrichment and score calculation still pending.
- [~] Formations: authoritative validation + owner/SuperAdmin authorization + RealCalendar-controlled TeamDay GitHub write implemented; field-editing UI and chance/stat-based optimal formation still pending.
- [ ] Real players / Serie A ingestion.
- [ ] Statistics/chances/votes.
- [ ] Market persistence/commands.

## Infrastructure backlog

- [ ] Replace every legacy `buildApiUrl(...)` responsibility with local composition/GitHub/Actions/WebRTC; `/Game/Get` and `Game/SaveTeam` are removed conceptually by `GroupGameComposer` + `GroupFormationWriter`.
- [x] remove backend JWT/AppIdentity dependency from the web login boundary.
- [~] replace `rystem.repository.client` with GitHub adapters.
- [ ] replace Azure/static URLs.
- [x] SHA cache + optimistic concurrency for migrated mutable JSON, including create-only races.
- [ ] ETag conditional reads.
- [ ] one-time schema-v1→v2 migration tooling if any compact runtime repositories exist.
- [ ] strict per-user write authorization beyond the client UI (repository rules, signed commands or trusted command service) if required.

## Background jobs

- [ ] Serie A/player/team ingestion.
- [ ] live/final votes, odds/images.
- [ ] formation/groups manager.
- [ ] HallOfFame/Market.
- [ ] day/full-season recalculation.

## Auction

- [ ] readable schema-v2 auction domain/state.
- [ ] UI + WebRTC host/participants + GitHub signaling.
- [ ] timer/bid/idempotency/reconnection/STUN/TURN.

## Definition of done

A feature preserves desired Fantasoccer behavior, uses readable schema-v2 JSON, has representative tests and no longer depends on the legacy backend/storage transport.
