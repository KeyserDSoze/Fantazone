# Background jobs migration

Fantazone does not recreate the legacy backend scheduler. Every historical Fantasoccer job is classified as either a **global platform producer**, a **group-owned mutation**, or an explicitly **retired derived/cache job**.

## Migration matrix

| Legacy job | Fantazone result |
|---|---|
| `SerieAJob` | **global:** `ingest-serie-a`; readable RealCalendar, full daily refresh plus live-day refresh during guarded live runs |
| `AllPlayersAndAllTeamsJob` | **global:** `ingest-master-data`; readable RealTeams/RealPlayers + reconciliation. Old per-group transfer fan-out is retired because current Team documents resolve global players by `playerKey` |
| `LiveVotesJob` | **global:** `ingest-live-votes`; SignedUri/protobuf adapter, readable live-vote JSON, five-minute RealCalendar guard |
| `LiveJob` | **retired:** `GroupLiveComposer` derives live group state locally from canonical inputs; no high-frequency cache commits |
| `FinalVotesJob` | **global:** `ingest-final-votes`; readable official votes + completeness check + automatic statistics rebuild |
| `PlayerOddsJob` | **global:** `ingest-player-odds`; readable probable-formation/availability snapshot |
| `PlayerImagesJob` | **global:** `ingest-player-images`; shared WebP assets served by Pages |
| `SetFormationJob` | **group-owned:** deterministic next-TeamDay propagation |
| `GroupsManagerJob` | **retired as a monolith:** pure scoring/rank/progression reducers + group-owned `recalculate-day` / `recalculate-all` |
| `NewsJob` | **retired:** the legacy job was disabled and the feature is not part of the active Fantazone product |
| `TeamHelperJob` | **retired as a scheduled job:** useful calculations are pure/local domain logic |
| `PushNotificationJob` | **split:** browser subscription/preferences + group-owned Web Push transport and manual test dispatch are implemented; automatic delivery waits for real VAPID/browser validation |
| `HallOfFameJob` | **group-owned:** rebuild Action |
| `MarketJob` | **group-owned:** serialized command/expiry processing |

There is no remaining legacy background job waiting for a code port. The open work is production/device validation, tracked by #5, #29, #37, #40 and #7.

## Hard runtime split

### Platform/global Actions

Only state shared by every group belongs in `KeyserDSoze/Fantazone/.github/workflows/background-jobs.yml`:

- `ingest-serie-a`;
- `ingest-master-data`;
- `rebuild-player-stats`;
- `ingest-live-votes`;
- `ingest-final-votes`;
- `ingest-player-odds`;
- `ingest-player-images`.

They write `data/serie-a/...` documents or shared static assets. The platform workflow never enumerates fantasy groups and never stores group PATs.

### Group-owned Actions

Every `Fantazone.<group>` repository owns its mutable fantasy state. Managed group workflows handle formation snapshots/propagation, market processing, auction outcomes, definitive recalculation and Hall-of-Fame rebuilds using that repository's short-lived `GITHUB_TOKEN`.

The managed runtime reads engine code and current global data from the platform repository while committing only the group's own `data/` changes. Current Team documents contain normalized player references; TeamDay snapshots freeze the resolved RealPlayer state for history, so later transfers never rewrite old matchdays.

See `docs/28-group-repository-lifecycle.md` and `docs/35-normalized-season-team.md`.

## Current production schedules

GitHub cron expressions are UTC.

| Producer | Schedule | Notes |
|---|---:|---|
| full Serie A calendar | `27 2 * * *` | refreshes all 38 rounds once per day so postponements and future kickoff changes converge |
| live votes | `*/5 * * * *` | dependency-free RealCalendar guard skips dependency installation and provider calls when no match is live |
| final votes | `7 3 * * *` and `7 4 * * *` | preserves the two legacy overnight attempts, staggered away from the top of the hour |
| master data | `17 4 * * *` | fail-closed structural validation before replacing canonical players/teams |
| player odds | `17 5 * * *` | global probable-formation / injury snapshot |
| player images | `17 3 3 * *` | monthly shared image refresh |

All scheduled producers share one non-cancelling concurrency group. Successful canonical diffs are rebased before push; unchanged JSON/assets produce no commit.

### Live calendar refresh

The old server refreshed calendar state frequently during the playing window. Re-running a 38-round HTTP ingestion every five minutes would be wasteful in GitHub Actions, so Fantazone splits that responsibility:

1. the daily `ingest-serie-a` run refreshes the full season;
2. the five-minute live guard identifies the canonical `season` and `serieADay` of an actually live match;
3. after dependencies are installed, that run refreshes **only that day** with `ingest-serie-a <day> <season>`;
4. `ingest-live-votes` then reads the refreshed canonical calendar context.

A calendar-source failure is isolated from the live-vote provider attempt: the live producer is still allowed to run, successful live canonical output may be committed, and the workflow then fails visibly so the calendar regression is not hidden. By contrast, if the selected producer itself fails, partial canonical output is not committed.

## Global producers

### `ingest-serie-a`

Writes:

```text
data/serie-a/calendars/<season-id>.json
```

The provider is the current Gazzetta calendar API. A full run requests rounds 1–38; a single-day run can update only an already initialized season and refuses to create a partial calendar. Season ids preserve the legacy Fantasoccer convention (`15 = 2026/27`).

The 2026/27 real provider path was validated during the production bootstrap. The canonical calendar now also drives the lightweight live schedule guard.

### `ingest-master-data`

Writes readable RealTeams/RealPlayers and performs the legacy active/inactive/reactivation/transfer reconciliation. A real-world transfer is persisted only in the global master; current fantasy Teams resolve it by `playerKey`.

The production source fails closed unless structural checks hold, including a complete Serie A club set, a plausible player count, team coverage, unique player keys and retention relative to the previous active master. The job keeps the legacy rule that player statistics are rebuilt automatically only when `playerCountChanged=true`.

### `rebuild-player-stats`

Reads canonical RealPlayers + official vote documents and writes:

```text
data/serie-a/stats/<season-id>.json
```

The reducer is deterministic and network-free.

### `ingest-final-votes`

Writes:

```text
data/serie-a/votes/official/<season-id>/<serie-a-day>.json
```

It preserves vote/card/bonus semantics, delayed-game synthetic sixes and completeness checks. Without an explicit day it mirrors legacy `FinalVotesJob` and selects `RealCalendar.LiveDay ?? LastDay`. Complete output rebuilds statistics for that day; incomplete output remains retryable.

The real 2026/27 provider has been positively validated with a complete 20-team matchday. Automatic runs are enabled twice nightly at 03:07 and 04:07 UTC. Manual explicit-day dispatch remains available for repairs.

### `ingest-live-votes`

Writes:

```text
data/serie-a/votes/live/<season-id>/<serie-a-day>.json
```

The SignedUri/protobuf protocol and legacy event mapping are preserved. Empty/unchanged output does not rewrite the snapshot. Scheduled runs are every five minutes, but provider access occurs only inside the canonical 2h15 live-match window.

The protobuf path has completed a real post-match call without the previous integer-overflow failure. The only remaining production gate is observing one **non-empty** real snapshot during an actual live match (#29/#37).

### `ingest-player-odds`

Writes:

```text
data/serie-a/chances/<season-id>/<serie-a-day>.json
```

It targets `RealCalendar.LiveDay ?? NextDay`, resets stale source flags, merges Fantagazzetta/Gazzetta/injury observations and isolates provider failures. The real provider chain has been validated and the producer is scheduled daily.

### `ingest-player-images`

Writes shared static files:

```text
src/app/public/images/players/<legacy-player-key>.webp
```

They are served as `https://fanta.plus/images/players/<legacy-player-key>.webp`. Existing files are retained, individual failures are isolated and the WebP signature is validated. The real catalog/media path has been validated with zero download failures in the production run used to enable the monthly schedule.

## Retired backend loops

### `LiveJob`

Fantazone derives live state instead of committing a high-frequency cache:

```text
Group / Calendar / Rank / TeamDay
+ global RealCalendar / official votes / live votes
        -> pure reducers
        -> GroupLiveComposer
        -> in-memory LiveGroup
```

### transfer fan-out from `AllPlayersAndAllTeamsJob`

The server used to rewrite the embedded Serie A club inside every fantasy roster after transfers. Runtime normalization removes that duplication:

```text
current Team: playerKey + fantasy-owned fields
                       ↓
              global RealPlayers
```

A TeamDay resolves and freezes the current RealPlayer data at snapshot time; historical TeamDays never change afterward.

### `GroupsManagerJob`

Its responsibilities are now explicit:

```text
official vote download             -> global `ingest-final-votes`
definitive fantasy team scoring    -> `calculateDefinitiveDay()`
canonical ranking rebuild          -> `calculateRankFromCalendar()`
Cup/NewCup advancement             -> `progressLeagueCalendar()`
persistence/rebuild                -> group-owned workflow
```

`recalculate-day` fails closed if official votes are missing. `recalculate-all` skips future/missing-vote days instead of inventing results.

## Push notifications

Web Push V1 is implemented without an application server: the browser stores its subscription/preferences in the group repository and the group Action signs/sends notifications with the repository secret `FANTAZONE_VAPID_PRIVATE_KEY`.

Automatic legacy event delivery remains intentionally disabled until one real browser subscription + secret + manual delivery succeeds. See `docs/38-zero-backend-push.md`.

## Migration rule

A producer/rebuild is considered complete only when:

1. representative legacy behavior is ported or intentionally retired;
2. the output is classified global vs group-owned;
3. deterministic business logic lives in shared TypeScript reducers;
4. provider adapters fail safely and have offline tests;
5. real external providers are validated before recurring schedules are enabled;
6. group-owned state is never mutated by the central platform Action;
7. operational checks that require real devices/networks remain explicitly tracked instead of being simulated in CI.
