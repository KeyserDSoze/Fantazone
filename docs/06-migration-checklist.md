# Migration checklist

`[ ]` pending, `[~]` in progress/scaffolded, `[x]` implemented with tests.

## Foundation

- [x] Initialize Fantazone repository and documentation.
- [x] Expo/React Native/Tamagui app; web export and Android/iOS Expo prebuild are green. Real-device acceptance remains an external validation gate, not missing implementation.
- [x] shared TypeScript domain/GitHub client/Actions runner.
- [x] GitHub Pages production deployment at canonical `https://fanta.plus` with automatic deploy from `main`.
- [x] readable canonical JSON; migrated documents avoid compact/single-letter persistence. Mutable season Team uses explicit reference schema v3 while the overall group model remains readable.
- [x] layered validation: deterministic unit/contract/filesystem tests plus Playwright Chromium desktop/mobile in CI; guarded real-GitHub integration workflow available with a dedicated test PAT.
- [x] web offline App Shell: unified Service Worker caches the Expo shell and a real Playwright test verifies reload after connectivity is removed.
- [x] local-first repository replica: web IndexedDB/native AsyncStorage persist group JSON plus the required compressed Serie A season packs without cloning Git history.

## Identity and groups

- [x] Google adapter intentionally remains disabled by product configuration; Microsoft is the configured production login and the disabled Google path is not a refactor blocker.
- [x] Microsoft web login after group selection through authorization-code + PKCE.
- [x] last verified Microsoft identity + OneDrive group catalog are cached locally so an already-used device can reopen without a fresh Graph request; an actual OneDrive mutation still requires network and a renewable/re-authenticated Microsoft session.
- [x] shared group PAT preflight validates token, exact repository, read/write access and canonical Fantazone documents before persistence/use.
- [x] readable Group initialization and `group.users` membership resolution.
- [x] first-admin bootstrap for newly created/legacy-empty groups.
- [x] invitation flow supports both email-bound access with a random out-of-band code and reusable shared-password access; the latter self-registers new Microsoft identities only as Participants.
- [x] group credential persistence: shared PAT synchronized in private OneDrive settings and cached locally; invitation links transfer only encrypted credential material and never the out-of-band code/password.
- [x] GroupSession shares per-group repositories plus global football repositories.
- [x] authenticated web session after provider email + selected-group membership resolution.
- [x] create a `Fantazone.<group>` repository from zero and bootstrap current canonical/managed files.
- [x] independent `GROUP_REPOSITORY_RUNTIME_VERSION` persisted in `fantazone.json` as managed workflow/schema metadata.
- [x] app-open runtime upgrade updates only Fantazone-managed workflow paths and preserves group/custom data.
- [x] pre-production runtime engine follows the single supported `main` branch; obsolete `group-runtime-vN` refs were removed because no production group requires backward compatibility yet.
- [x] initial offline hydration uses one group ZIP plus only the compressed Serie A season packs referenced by that group; pack hashes avoid unnecessary repeat downloads.
- [x] group sync checks `manifest.revision` immediately/every 60 seconds/on foreground, uses ETag conditional reads, preserves the durable replica on network loss and never masks GitHub authorization errors as offline success.
- [x] legacy global AppIdentity/user-administration surface retired: zero-backend membership is group-scoped in `config/group.json`; no replacement central user database is created.
- [~] native Microsoft OAuth authorization-code + PKCE, `fantaplus://auth` deep link, Expo system auth browser, SecureStore refresh-token persistence/rotation, silent restore and logout cleanup are implemented and contract-tested; Microsoft Entra mobile/desktop redirect registration plus real iOS/Android device validation remain external gates. Google remains intentionally disabled/unconfigured.

## UI parity

- [x] App shell/Home.
- [x] Calendar/Game/day/Formation UI.
- [x] Ranking/luck UI.
- [x] Live Serie A/votes, including a locally derived real Serie A standings table that updates from canonical/live RealCalendar scores.
- [x] Players/statistics/Teams.
- [x] Market/trades/group admin/settings: market/trades, account/group settings and SuperAdmin users/baskets/leagues are wired.
- [x] Cards scope decision: intentionally excluded from this refactor because no active Cards implementation exists yet; no placeholder is exposed as an active feature.
- [x] Hall of Fame/logs/patch notes: Hall of Fame and patch notes are wired; operational logs read actual GitHub Actions from platform + group instead of recreating backend log storage.
- [~] Push UX: browser Web Push preferences/subscriptions, Service Worker, group-owned readable settings, managed per-group Actions transport and manual test dispatch are implemented; a repository `FANTAZONE_VAPID_PRIVATE_KEY` secret and real delivery validation are required before automatic notifications are enabled. Native iOS/Android push remains pending.
- [~] Auction realtime UI implemented for active-auction discovery, Admin host controls, participant bidding, repair substitutions and reconnect status; Android/iOS Expo prebuild is green, while real multi-device validation/polish remains an external gate.
- [x] Product routing is exhaustive at compile time: every active `GroupProductRoute` resolves to a real screen and there is no generic “section in migration” runtime fallback.
- [x] shared operation-status UI reports spinner + understandable phase for app/group/OneDrive sync and distinguishes offline, locally pending and remotely synchronized state.

## Service/domain migrations

- [x] Group.
- [x] Calendar, including deterministic initial League/Cup/NewCup generation for idempotent SuperAdmin setup.
- [x] Ranking, including the legacy Parametro Fortuna reducer used by the ranking UI.
- [x] Team/Player fantasy-roster domain.
- [x] mutable season Team normalized to `playerKey + fantasy-owned fields`; RealPlayer data resolves from global master and legacy full Team documents migrate lazily on their next write.
- [x] immutable TeamDay keeps the full RealPlayer snapshot needed for historical correctness; future-day propagation refreshes mutable RealPlayer fields from the current master without rewriting older days.
- [x] LiveGroup readable contract/helpers; persisted adapter retained only for migration compatibility.
- [x] RealCalendar readable global schema + GitHub repository + timing projections.
- [x] legacy real Serie A `RealRank` cache retired: `buildRealRank()` reconstructs standings deterministically from the canonical RealCalendar, including already-published live scores, so no duplicate global persistence is required.
- [x] global RealTeams/RealPlayers readable master-data + reconciliation; real provider path validated and daily production scheduling enabled with fail-closed structural guards.
- [x] Vote/StatPlayer readable contracts + FinalValue/statistics reducers + rebuild job.
- [x] live/final Serie A vote producer logic and canonical repositories; live producer is scheduled with calendar guard and final votes run automatically at 03:07 and 04:07 UTC. Only one positive live-source observation during an active match remains an operational gate.
- [x] PlayerOdds/chance readable domain + global reducer/parsers/Action; real-source validation passed with a 593-player canonical snapshot and the central producer is scheduled daily at 05:17 UTC (#35 closed).
- [x] player-image catalog matching + global static WebP ingestion + frontend URL/fallback helper; real-source catalog/media validation passed with zero download failures and the central producer is scheduled monthly (#36 closed).
- [x] local fantasy team scoring reducer: official-over-live precedence, substitutions, Best Formation, defence/good-people/own-goal behavior.
- [x] local live Rank projection + `GroupLiveComposer`; legacy `LiveJob` retired.
- [x] definitive fantasy-day reducer using official votes only, including missing TeamDay and home-advantage parity.
- [x] full canonical Rank rebuild from calculated Calendar.
- [x] deterministic Cup/NewCup progression including Finals, Europa League and Supercoppa; perfect-tie randomness intentionally replaced by stable seeded choice.
- [x] Game/day: read composition, TeamDay/current-Team projection, vote enrichment and live/closed scoring UI are migrated; `TeamDay` remains an Action-owned immutable day snapshot.
- [x] Formations: owner/SuperAdmin authorization, validation, normalized current Team write, commit-timestamp TeamDay snapshotting and the legacy local automatic proposal based on chances/statistics/home-opponent score are migrated; automatic proposal remains reversible and is persisted only by the normal Save action.
- [x] offline formation outbox: a network failure stores a semantic formation intent locally, updates the UI immediately, then revalidates/replays it through the normal writer when connectivity returns; GitHub commit time remains the authoritative cutoff clock.
- [x] Group administration: users/roles, baskets/annual teams/co-owners, leagues/settings/initial Calendar+Rank and recalculation dispatch use fresh canonical group state with fail-closed integrity guards.
- [x] Serie A administration: manual delayed-game correction merges over a fresh global calendar with optimistic concurrency; producer actions dispatch through the platform workflow only after fresh SuperAdmin + repository push checks.
- [x] Serie A ingestion code/scheduling: calendar refreshes daily at 02:27 UTC, master data daily at 04:17 UTC, live votes every five minutes with a dependency-free calendar guard and live-day refresh, final votes at 03:07/04:07 UTC, odds daily and images monthly. Positive live-feed observation remains operational validation rather than missing implementation.
- [~] Statistics/chances/votes: deterministic reducers + producers implemented; official day 2 and chance day 3 are materialized from real providers, while one positive live-vote observation during an active match remains the final source-validation gate.
- [x] Market persistence/commands: append-only client commands + canonical group Action reducer with legacy voting/execution/expiry parity; Team mutations hydrate from global master and persist normalized references.
- [x] Hall of Fame readable cross-season reducer/repository + group-owned rebuild Action; legacy TODO player-record fields remain intentionally null.
- [~] Push notifications: readable per-user group preferences/subscriptions and browser Web Push transport are implemented; the global VAPID public key is origin-wide while the corresponding private key is accepted only as a GitHub Actions Secret. Manual delivery validation and automatic legacy event/reminder orchestration remain pending.
- [~] Auction: readable V1 host reducer, outcomes, active-session discovery, GitHub slow signaling, browser RTCPeerConnection/DataChannel/reconnect, native WebRTC bridge/runtime dependency and realtime UI implemented; Android/iOS Expo prebuild is green, while TURN and end-to-end multi-device validation remain external gates.

## Infrastructure backlog

- [x] legacy `buildApiUrl(...)` responsibilities removed from runtime code; composition now uses local domain/GitHub/Actions/WebRTC boundaries.
- [x] remove backend JWT/AppIdentity dependency from web login.
- [x] legacy `rystem.repository.client` runtime dependency replaced by GitHub adapters; the old name survives only in migration documentation/history.
- [x] legacy Azure/static application URLs removed from current runtime inventory; player images use `https://fanta.plus`.
- [x] SHA cache + optimistic concurrency for migrated mutable JSON.
- [x] managed group-workflow upgrades use current GitHub blob SHA and advance runtime metadata only after success.
- [x] current Team no longer duplicates global Serie A player master fields, eliminating per-group transfer fan-out and unnecessary nightly commits.
- [x] backend operational-log persistence retired; the SuperAdmin log viewer reads GitHub Actions runs directly for the public platform repository and authenticated group repository.
- [x] Web Push private VAPID material is excluded from platform/group JSON and versioned code; the managed group push workflow reads only `secrets.FANTAZONE_VAPID_PRIVATE_KEY` while the public key remains shared by the `fanta.plus` origin.
- [x] ETag conditional reads: GitHub content responses persist validators alongside JSON/SHA, `refresh:true` sends `If-None-Match`, `304 Not Modified` reuses durable cached JSON, changed `200` responses replace value/SHA/ETag, and older cache entries without ETag remain compatible.
- [x] transport-only offline fallback: refresh requests use the durable local snapshot after genuine network failure, while HTTP authorization/conflict errors remain authoritative.
- [x] one-time schema-v1→v2 runtime repository recovery is not required before launch: there are no production group repositories needing compact-schema recovery; the completed Azure migration tooling remains available for legacy import/recovery.
- [x] zero-backend authorization limitation documented: frontend/Actions enforce business rules, but a shared client-visible PAT cannot provide a cryptographic per-user write boundary.

## Background jobs

- [x] Serie A calendar ingestion: global producer is implemented/tested and scheduled daily at 02:27 UTC; guarded live-vote runs refresh only the current matchday before provider access.
- [x] player/team master-data ingestion: real `bootstrap-serie-a` Action validated the provider path on 2026-09-06; `ingest-master-data` is scheduled daily at 04:17 UTC with minimum roster/team coverage and active-retention guards. No per-group transfer propagation is required.
- [~] player statistics rebuild implemented and canonical season data exists; ongoing production refresh is driven by complete final-vote ingestion.
- [~] live/final votes: provider adapters + global Actions + parity tests implemented; `ingest-live-votes` is scheduled every five minutes with RealCalendar guard and live-day calendar refresh, `ingest-final-votes` is scheduled at 03:07/04:07 UTC, official day 2 real-source validation passed with 320 players / 20 teams, and only a positive live-feed observation remains outstanding.
- [x] player odds: reducer + three provider parsers + global Action implemented; real provider validation produced 593 canonical day-3 players and the central job is scheduled daily at 05:17 UTC (#35 closed).
- [x] player images: SDP catalog + matching + static WebP ingestion + global Action implemented; real provider validation recognized 295 existing assets with 0 failures, Pages/static export is green and the central job is scheduled monthly (#36 closed).
- [x] legacy `LiveJob`: retired; local `GroupLiveComposer` replaces it.
- [x] legacy `AllPlayersAndAllTeamsJob` group-roster transfer side effect: retired; mutable Teams resolve RealPlayer fields from global master by `playerKey`.
- [x] legacy `GroupsManagerJob`: retired; definitive scoring/ranking/progression use shared reducers and group-owned `recalculate-day` / `recalculate-all`.
- [x] day/full-season recalculation: filesystem orchestration + tests + group workflow implemented.
- [x] formation snapshot maintenance: current-Team pushes automatically trigger group runtime processing; commit timestamp selects the eligible day, snapshots remain frozen after cutoff and no day 39 is created.
- [x] next-formation propagation: fantasy formation fields copy forward only when target is missing; the new TeamDay refreshes RealPlayer snapshots from current master.
- [x] central Background jobs workflow contains only global/shared jobs; group mutations are excluded.
- [x] Market group workflow/reducer: serialized command processing + daily 02:00 UTC expiry maintenance.
- [x] HallOfFame group workflow/reducer: weekly Tuesday 03:00 UTC rebuild + manual dispatch.
- [x] Auction assignment outcome processing: realtime host emits one append-only assignment request; group runtime revalidates and commits normalized Team + outcome result atomically.
- [~] Push delivery: per-group manual Actions sender is implemented with VAPID Secret isolation; automatic reminder/live/market scheduling remains disabled until a real browser subscription and test delivery are verified. Deterministic deployment-reminder targeting/deduplication is implemented but not scheduled.

## Auction

- [x] readable checkpoint/command/event/outcome/signaling domain with legacy host business-rule parity.
- [x] GitHub signaling + browser offer/answer + ordered DataChannel adapter + host/participant realtime wiring implemented with tests.
- [x] timer/bid/idempotency/sequence-gap recovery, checkpoint resync and browser connection-state reconnect generation implemented.
- [x] canonical roster assignment crosses an append-only outcome boundary and is revalidated by the serialized group Action.
- [x] active-auction pointer/discovery lets clients resolve one canonical league/season session without technical auction IDs or GitHub directory listing.
- [~] browser/Tamagui Auction V1 UI supports creation/resume, legacy queue modes, host controls, participant bids, repair substitutions, explicit finish/reopen/archive and realtime reconnect status; real multi-device validation and UX enrichment remain pending.
