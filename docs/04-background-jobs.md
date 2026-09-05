# Background jobs migration

The current Fantasoccer background-job project contains the following jobs. None may disappear silently: a legacy job is either migrated, split, or explicitly retired with its replacement documented.

| Legacy job | Legacy intent | Fantazone target |
|---|---|---|
| `SerieAJob` | refresh Serie A/calendar/live source data | **implemented first slice:** `ingest-serie-a` global Action -> readable RealCalendar JSON; production validation/scheduling still pending |
| `AllPlayersAndAllTeamsJob` | refresh player/team master data | **global slices implemented:** `ingest-master-data` -> readable RealTeams/RealPlayers + reconciliation; per-group transfer propagation remains separate |
| `LiveVotesJob` | ingest live fantasy votes | **implemented/tested:** `ingest-live-votes` -> SignedUri/protobuf adapter -> readable live vote JSON |
| `LiveJob` | rebuild per-group live match/rank snapshot | **retired in #30:** `GroupLiveComposer` derives `LiveGroup` locally; no Action/cache loop |
| `FinalVotesJob` | ingest final votes | **implemented/tested:** `ingest-final-votes` -> official vote JSON + completeness check + stats rebuild |
| `PlayerOddsJob` | ingest player odds/probabilities | `ingest-player-odds` Action |
| `PlayerImagesJob` | refresh player images | `ingest-player-images` Action/assets |
| `SetFormationJob` | copy previous formation to next day when missing | deterministic group-owned formation job, still pending |
| `GroupsManagerJob` | definitive game calculation, ranking and knockout progression | **retired in #31:** shared reducers + group-owned `recalculate-day` / `recalculate-all` workflow |
| `NewsJob` | news ingestion, currently disabled | tracked; implement only if product keeps feature |
| `TeamHelperJob` | team helper calculations, currently disabled | pure domain calculation where still useful |
| `PushNotificationJob` | decide/send notifications | decision logic migrates; delivery requires explicit transport design |
| `HallOfFameJob` | historical/Hall of Fame aggregation | group-owned rebuild Action |
| `MarketJob` | scheduled market state processing | group-owned Action/domain reducer |

## Runtime split

Fantazone deliberately separates global producers from group calculations.

### Platform/global Actions

These fetch or rebuild shared Serie A data once:

- `ingest-serie-a`;
- `ingest-master-data`;
- `rebuild-player-stats`;
- `ingest-live-votes`;
- `ingest-final-votes`;
- future global odds/images producers.

They run in `KeyserDSoze/Fantazone` and write `data/serie-a/...`.

### Group-owned Actions

Every `Fantazone.<group>` repository receives `.github/workflows/fantazone-group.yml`. It currently exposes:

- `recalculate-day`;
- `recalculate-all`.

The workflow checks out both the group repository and public Fantazone engine/data. It executes the shared reducers and commits only the group repository's `data/` files with that repository's own `GITHUB_TOKEN`.

Therefore the platform workflow does **not** expose `rebuild-groups`, `recalculate-day` or `recalculate-all` and never stores PATs for fantasy groups.

## Implemented global jobs

### `ingest-serie-a`

Fetches Serie A calendar data into `data/serie-a/calendars/<season-id>.json`.

### `ingest-master-data`

Builds readable RealTeams/RealPlayers, preserves active/inactive/transfer reconciliation and triggers player-stat rebuild only on the legacy `playerCountChanged` condition.

### `rebuild-player-stats`

Reads canonical RealPlayers + official vote documents and writes `data/serie-a/stats/<season-id>.json` with the legacy statistics semantics.

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

## Migration rule

Before enabling a producer/rebuild job:

1. port representative legacy behavior/tests;
2. identify whether it is a real producer/write or only a derived cache;
3. keep deterministic business logic in shared TypeScript reducers;
4. use platform Actions only for global producers;
5. use group Actions only for group-owned persistence;
6. validate manually through `workflow_dispatch` before any schedule is enabled.

No automatic production schedule is enabled yet for the remaining external producers.
