# Migration checklist

`[ ]` pending, `[~]` in progress/scaffolded, `[x]` implemented with tests.

## Foundation

- [x] Initialize Fantazone repository and documentation.
- [~] Expo/React Native/Tamagui app.
- [~] shared TypeScript domain/GitHub client/Actions runner.
- [x] GitHub Pages production deployment at canonical `https://fanta.plus` with automatic deploy from `main`.
- [x] readable JSON schema v2; no single-letter persistence for migrated features.

## Identity and groups

- [~] Google web adapter implemented but product login intentionally disabled until configured.
- [x] Microsoft web login after group selection through authorization-code + PKCE.
- [~] PAT validation/repository discovery before login.
- [x] readable Group initialization and `group.users` membership resolution.
- [x] first-admin bootstrap for newly created/legacy-empty groups.
- [x] email-bound Admin/SuperAdmin invitation flow.
- [~] secure credential persistence and group switching; V1 web PAT still uses local storage.
- [x] GroupSession shares per-group repositories plus global football repositories.
- [x] authenticated web session after provider email + selected-group membership resolution.
- [x] create a `Fantazone.<group>` repository from zero and bootstrap current canonical/managed files.
- [x] independent `GROUP_REPOSITORY_RUNTIME_VERSION` persisted in `fantazone.json`.
- [x] app-open runtime upgrade updates only Fantazone-managed workflow paths and preserves group/custom data.
- [x] group runtime engine refs are versioned (`group-runtime-vN`) instead of following moving `main`.
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
- [x] Team/Player fantasy-roster domain.
- [x] LiveGroup readable contract/helpers; persisted adapter retained only for migration compatibility.
- [x] RealCalendar readable global schema + GitHub repository + timing projections.
- [x] global RealTeams/RealPlayers readable master-data + reconciliation.
- [x] Vote/StatPlayer readable contracts + FinalValue/statistics reducers + rebuild job.
- [x] live/final Serie A vote producer logic and canonical repositories; real-source production validation/scheduling remains operational work.
- [x] PlayerOdds/chance readable domain + global reducer/parsers/Action; real-source production validation/scheduling remains operational work (#35).
- [x] player-image catalog matching + global static WebP ingestion + frontend URL/fallback helper; real-source production validation/scheduling remains operational work (#36).
- [x] local fantasy team scoring reducer: official-over-live precedence, substitutions, Best Formation, defence/good-people/own-goal behavior.
- [x] local live Rank projection + `GroupLiveComposer`; legacy `LiveJob` retired.
- [x] definitive fantasy-day reducer using official votes only, including missing TeamDay and home-advantage parity.
- [x] full canonical Rank rebuild from calculated Calendar.
- [x] deterministic Cup/NewCup progression including Finals, Europa League and Supercoppa; perfect-tie randomness intentionally replaced by stable seeded choice.
- [~] Game/day: read composition, TeamDay write side and scoring core are migrated; actual screens/UI enrichment remain pending.
- [~] Formations: validation + owner/SuperAdmin authorization + TeamDay write implemented; UI and chance/stat automatic formation remain pending.
- [~] Serie A ingestion: core calendar/master/vote/chance/image producers implemented; production initialization/source validation/scheduling remain pending.
- [~] Statistics/chances/votes: deterministic reducers + producers implemented; production data bootstrap/validation remains pending.
- [x] Market persistence/commands: append-only client commands + canonical group Action reducer with legacy voting/execution/expiry parity.
- [x] Hall of Fame readable cross-season reducer/repository + group-owned rebuild Action; legacy TODO player-record fields remain intentionally null.
- [~] Auction: readable V1 host reducer, outcomes, GitHub slow signaling, browser RTCPeerConnection/DataChannel adapter and reconnect coordinator implemented; native adapter, TURN and UI/finalization remain pending.

## Infrastructure backlog

- [ ] Replace every legacy `buildApiUrl(...)` responsibility with local composition/GitHub/Actions/WebRTC; major Game, formation, live and recalculation endpoints are already removed conceptually.
- [x] remove backend JWT/AppIdentity dependency from web login.
- [~] replace `rystem.repository.client` with GitHub adapters.
- [~] replace Azure/static URLs: player-image pipeline/helper moved to `https://fanta.plus`; remaining legacy static URLs still need inventory/removal.
- [x] SHA cache + optimistic concurrency for migrated mutable JSON.
- [x] managed group-workflow upgrades use current GitHub blob SHA and advance runtime metadata only after success.
- [ ] ETag conditional reads.
- [ ] one-time schema-v1→v2 migration tooling if compact runtime repositories exist.
- [ ] strict per-user write authorization beyond client UI if required.

## Background jobs

- [~] Serie A calendar ingestion: implementation/tests/manual global Action ready; scheduling waits for production validation.
- [~] player/team master-data ingestion: global teams/players + reconciliation implemented; per-group transfer propagation remains pending.
- [~] player statistics rebuild implemented; real runtime data initialization remains pending.
- [~] live/final votes: provider adapters + manual global Actions + offline parity tests implemented; first real provider runs and scheduling remain pending (#29).
- [~] player odds: reducer + three provider parsers + global Action implemented; first real provider run and scheduling remain pending (#35).
- [~] player images: SDP catalog + matching + static WebP ingestion + global Action implemented; first real provider run/Pages asset validation and scheduling remain pending (#36).
- [x] legacy `LiveJob`: retired; local `GroupLiveComposer` replaces it.
- [x] legacy `GroupsManagerJob`: retired; definitive scoring/ranking/progression use shared reducers and group-owned `recalculate-day` / `recalculate-all`.
- [x] day/full-season recalculation: filesystem orchestration + tests + group workflow implemented.
- [x] legacy `SetFormationJob` behavior: deterministic `set-next-formations` group job + parity tests; automatic schedule intentionally not enabled yet (#32).
- [x] central Background jobs workflow contains only global/shared jobs; group mutations are excluded.
- [x] Market group workflow/reducer: serialized command processing + daily 02:00 UTC expiry maintenance.
- [x] HallOfFame group workflow/reducer: weekly Tuesday 03:00 UTC rebuild + manual dispatch.
- [x] Auction assignment outcome processing: realtime host emits one append-only assignment request; group runtime v6 revalidates and commits Team + outcome result atomically.

## Auction

- [x] readable checkpoint/command/event/outcome/signaling domain with legacy host business-rule parity.
- [x] GitHub signaling + browser offer/answer + ordered DataChannel adapter + host/participant realtime wiring implemented with tests.
- [x] timer/bid/idempotency/sequence-gap recovery, checkpoint resync and browser connection-state reconnect generation implemented.
- [x] canonical roster assignment crosses an append-only outcome boundary and is revalidated by the serialized group Action.
- [ ] native iOS/Android RTCPeerConnection adapter.
- [ ] production TURN credential strategy for restrictive NAT/firewall networks.
- [ ] Auction screens/UI and final end-to-end device validation.

## Definition of done

A feature preserves desired Fantasoccer behavior, uses readable schema-v2 JSON, has representative tests and no longer depends on the legacy backend/storage transport. Group-owned behavior must be deployable and upgradeable inside each `Fantazone.<group>` repository rather than being centralized in the platform repository.
