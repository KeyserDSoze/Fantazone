# Background jobs migration

The current Fantasoccer background-job project contains the following jobs. None may disappear silently: a legacy job is either migrated, split, or explicitly retired with its replacement documented.

| Legacy job | Legacy intent | Fantazone target |
|---|---|---|
| `SerieAJob` | refresh Serie A/calendar/live source data | **global:** `ingest-serie-a` -> readable RealCalendar JSON; production validation/scheduling still pending |
| `AllPlayersAndAllTeamsJob` | refresh player/team master data | **global:** `ingest-master-data` -> readable RealTeams/RealPlayers + reconciliation; per-group transfer propagation remains separate |
| `LiveVotesJob` | ingest live fantasy votes | **global:** `ingest-live-votes` -> SignedUri/protobuf adapter -> readable live vote JSON |
| `LiveJob` | rebuild per-group live match/rank snapshot | **retired in #30:** `GroupLiveComposer` derives `LiveGroup` locally; no Action/cache loop |
| `FinalVotesJob` | ingest final votes | **global:** `ingest-final-votes` -> official vote JSON + completeness check + stats rebuild |
| `PlayerOddsJob` | ingest player odds/probabilities | **global:** `ingest-player-odds` Action |
| `PlayerImagesJob` | refresh player images | **global:** `ingest-player-images` Action/assets |
| `SetFormationJob` | copy previous formation to next day when missing | **group-owned:** deterministic `set-next-formations`, runtime-v2 workflow (#32) |
| `GroupsManagerJob` | definitive game calculation, ranking and knockout progression | **retired in #31:** shared reducers + group-owned `recalculate-day` / `recalculate-all` workflow |
| `NewsJob` | news ingestion, currently disabled | tracked; implement only if product keeps feature |
| `TeamHelperJob` | team helper calculations, currently disabled | pure/local domain calculation where still useful |
| `PushNotificationJob` | decide/send notifications | decision logic migrates; delivery requires explicit transport design |
| `HallOfFameJob` | historical/Hall of Fame aggregation | **group-owned future workflow/reducer**, never a platform job |
| `MarketJob` | scheduled market state processing | **group-owned future workflow/reducer**, never a platform job |

## Hard runtime split

Fantazone deliberately separates shared/global producers from group-owned mutations.

### Platform/global Actions

Only work whose output is shared by every fantasy group belongs in `KeyserDSoze/Fantazone/.github/workflows/background-jobs.yml`:

- `ingest-serie-a`;
- `ingest-master-data`;
- `rebuild-player-stats`;
- `ingest-live-votes`;
- `ingest-final-votes`;
- global odds/images producers.

They write shared `data/serie-a/...` once.

The central workflow must **not** expose formation propagation, fantasy-day recalculation, market processing, Hall-of-Fame rebuilds or any other command that mutates one particular group's state.

### Group-owned Actions

Every `Fantazone.<group>` repository owns its canonical state and receives Fantazone-managed group workflow files during bootstrap/runtime upgrades.

Runtime v2 currently exposes:

- `recalculate-day`;
- `recalculate-all`;
- `set-next-formations`.

Future group-owned capabilities such as market/Hall-of-Fame/repair will be added by advancing the group repository runtime version and upgrading the managed workflow in each repository.

The group workflow uses three checkouts with different purposes:

```text
group/          -> its own writable repository
engine/         -> KeyserDSoze/Fantazone @ group-runtime-vN (stable compatible code)
platform-data/  -> KeyserDSoze/Fantazone @ current data ref, data/ only
```

It runs the shared job implementation from `engine/`, reads the latest normalized football data from `platform-data/` and commits only group `data/` changes with that group's own short-lived `GITHUB_TOKEN`.

The platform therefore never enumerates all groups and never stores their PATs. Pinning engine code and refreshing global data are deliberately separate concerns.

See `docs/28-group-repository-lifecycle.md` for create/bootstrap/upgrade/versioning rules.

## Implemented global jobs

### `ingest-serie-a`

Fetches Serie A calendar data into `data/serie-a/calendars/<season-id>.json`.

### `ingest-master-data`

Builds readable RealTeams/RealPlayers, preserves active/inactive/transfer reconciliation and triggers player-stat rebuild only on the legacy `playerCountChanged` condition.

### `rebuild-player-stats`

Reads canonical RealPlayers + official vote documents and writes `data/serie-a/stats/<season-id>.json` with legacy statistics semantics.

### `ingest-final-votes`

Writes:

```text
data/serie-a/votes/official/<season-id>/<serie-a-day>.json
```

It preserves vote/card/bonus semantics, delayed-game synthetic sixes and completeness checks. Complete output triggers the statistics rebuild for the same day.

### `ingest-live-votes`

Writes:

```text
data/serie-a/votes/live/<season-id>/<serie-a-day>.json
```

The SignedUri/protobuf protocol and legacy event mapping are preserved. Empty provider output does not rewrite the snapshot.

## Retired `LiveJob`

Legacy `LiveJob` was only a high-frequency cache builder. Fantazone replaces it with:

```text
canonical Group/Calendar/Rank/TeamDay
+ global RealCalendar/official/live votes
        -> pure reducers
        -> GroupLiveComposer
        -> in-memory LiveGroup
```

No periodic derived-state commit is required.

## Retired `GroupsManagerJob`

Legacy `GroupsManagerJob` mixed several responsibilities. Fantazone splits them explicitly:

```text
official vote download             -> global `ingest-final-votes`
definitive fantasy team scoring    -> `calculateDefinitiveDay()`
canonical ranking rebuild          -> `calculateRankFromCalendar()`
Cup/NewCup advancement             -> `progressLeagueCalendar()`
persistence/rebuild                -> group-owned workflow
```

`recalculate-day` fails closed when its official vote document is missing. `recalculate-all` skips future/missing-vote days instead of creating fake 0-0 results, while still allowing already-completed Cup/NewCup calendars to advance.

Full details: `docs/27-definitive-day-recalculation.md` and issue #31.

## `SetFormationJob` migration

The legacy hourly process is now a deterministic group operation. It chooses `LiveDay ?? LastDay`, never creates day 39, never overwrites an existing next TeamDay and copies the current TeamDay forward only when the next one is missing.

The operation belongs to the group's runtime because it mutates group formations. It is available through `Fantazone.<group>/.github/workflows/fantazone-group.yml`; it is deliberately absent from the central Background jobs workflow. No automatic hourly schedule is enabled yet.

## Migration rule

Before enabling a producer/rebuild job:

1. port representative legacy behavior/tests;
2. identify whether it is a real producer/write or only a derived cache;
3. classify the output as **global** or **group-owned** before adding any Action;
4. keep deterministic business logic in shared TypeScript reducers;
5. use platform Actions only for globally shared data;
6. use group Actions only for group-owned persistence;
7. advance the group runtime only when existing group repositories must receive a managed artifact change;
8. validate manually through `workflow_dispatch` before any schedule is enabled.

No automatic production schedule is enabled yet for the remaining external producers.
