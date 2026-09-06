# Background jobs migration

The current Fantasoccer background-job project contains the following jobs. None may disappear silently: a legacy job is either migrated, split, or explicitly retired with its replacement documented.

| Legacy job | Legacy intent | Fantazone target |
|---|---|---|
| `SerieAJob` | refresh Serie A/calendar/live source data | **global:** `ingest-serie-a` -> readable RealCalendar JSON; production validation/scheduling still pending |
| `AllPlayersAndAllTeamsJob` | refresh player/team master data and duplicate real-team changes into group rosters | **global:** `ingest-master-data` -> readable RealTeams/RealPlayers + reconciliation; runtime v8 current Teams resolve the global master by `playerKey`, so the old per-group propagation side effect is retired |
| `LiveVotesJob` | ingest live fantasy votes | **global:** `ingest-live-votes` -> SignedUri/protobuf adapter -> readable live vote JSON; scheduled every 5 minutes with RealCalendar guard |
| `LiveJob` | rebuild per-group live match/rank snapshot | **retired in #30:** `GroupLiveComposer` derives `LiveGroup` locally; no Action/cache loop |
| `FinalVotesJob` | ingest final votes | **global:** `ingest-final-votes` -> official vote JSON + completeness check + stats rebuild |
| `PlayerOddsJob` | ingest player odds/probabilities | **global:** `ingest-player-odds` Action; implementation complete, production validation/scheduling pending (#35) |
| `PlayerImagesJob` | refresh player images | **global:** `ingest-player-images` -> GitHub Pages WebP assets; implementation complete, production validation/scheduling pending (#36) |
| `SetFormationJob` | copy previous formation to next day when missing | **group-owned:** deterministic `set-next-formations`; new TeamDay refreshes RealPlayer fields from the current global master |
| `GroupsManagerJob` | definitive game calculation, ranking and knockout progression | **retired in #31:** shared reducers + group-owned `recalculate-day` / `recalculate-all` workflow |
| `NewsJob` | news ingestion, currently disabled | tracked; implement only if product keeps feature |
| `TeamHelperJob` | team helper calculations, currently disabled | pure/local domain calculation where still useful |
| `PushNotificationJob` | decide/send notifications | decision logic migrates; delivery requires explicit transport design |
| `HallOfFameJob` | historical/Hall of Fame aggregation | **group-owned:** weekly rebuild Action |
| `MarketJob` | scheduled market state processing | **group-owned:** serialized command processing + daily expiry Action |

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

They write shared `data/serie-a/...` documents or globally shared static assets once.

The central workflow must **not** expose formation propagation, fantasy-day recalculation, market processing, Hall-of-Fame rebuilds or any other command that mutates one particular group's state.

### Group-owned Actions

Every `Fantazone.<group>` repository owns its canonical fantasy state and receives Fantazone-managed group workflow files during bootstrap/runtime upgrades.

Current runtime v8 includes formation snapshot consolidation, next-formation propagation, market processing, auction assignment outcomes, definitive recalculation and Hall-of-Fame rebuilds. It deliberately does **not** include a player-transfer synchronization job.

The group workflow uses three checkouts with different purposes:

```text
group/          -> its own writable repository
engine/         -> KeyserDSoze/Fantazone @ group-runtime-vN (stable compatible code)
platform-data/  -> KeyserDSoze/Fantazone @ current data ref, data/ only
```

It runs the shared job implementation from `engine/`, reads the latest normalized football data from `platform-data/` and commits only group `data/` changes with that group's own short-lived `GITHUB_TOKEN`.

The platform therefore never enumerates all groups and never stores their PATs. Pinning engine code and refreshing global data are deliberately separate concerns.

See `docs/28-group-repository-lifecycle.md` for create/bootstrap/upgrade/versioning rules and `docs/35-normalized-season-team.md` for current Team versus TeamDay persistence.

## Implemented global jobs

### `ingest-serie-a`

Fetches Serie A calendar data into `data/serie-a/calendars/<season-id>.json`.

### `ingest-master-data`

Builds readable RealTeams/RealPlayers, preserves active/inactive/transfer reconciliation and triggers player-stat rebuild only on the legacy `playerCountChanged` condition.

A real-world transfer is persisted only here. Mutable season Team documents store `playerKey` references and resolve name/team/role/activity/visibility from this master at read time, so no fan-out update to every group repository is needed.

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

The SignedUri/protobuf protocol and legacy event mapping are preserved. Empty or unchanged provider output does not rewrite the snapshot. The production workflow is scheduled every five minutes; a lightweight RealCalendar guard exits before dependency installation/provider access when no match is live.

### `ingest-player-odds`

Writes one shared readable chance snapshot to:

```text
data/serie-a/chances/<season-id>/<serie-a-day>.json
```

It targets `RealCalendar.LiveDay ?? NextDay`, resets stale current-source flags, merges Fantagazzetta/Gazzetta/injury observations, isolates source failures and preserves the previous usable snapshot when every provider fails. The implementation is complete; a real production Action run and scheduling decision remain tracked by #35.

### `ingest-player-images`

Reads global RealPlayers plus the Lega Serie A SDP current/previous-season catalog and writes shared static files to:

```text
src/app/public/images/players/<legacy-player-key>.webp
```

They are served by Pages as `https://fanta.plus/images/players/<legacy-player-key>.webp`. Existing files are retained, individual download failures are isolated, and unavailable provider catalogs never destroy existing files. The legacy job stored WebP payloads behind `.jpg` names; Fantazone validates the WebP signature and uses the truthful `.webp` extension. Full details: `docs/29-player-images.md` and #36.

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

## Retired transfer fan-out from `AllPlayersAndAllTeamsJob`

The old server updated the embedded real club inside every active fantasy roster whenever the global player master changed. Runtime v8 removes that duplication:

```text
current Team: playerKey + fantasy-owned fields
                       ↓
              global RealPlayers
```

When a TeamDay is frozen, the reference is resolved and the full RealPlayer snapshot is persisted for history. Existing TeamDay documents are never rewritten after later transfers.

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

The operation chooses `LiveDay ?? LastDay`, never creates day 39 and never overwrites an existing next TeamDay. It copies fantasy-owned formation state from the source TeamDay, but refreshes the RealPlayer portion from the current season master before freezing the new target TeamDay. Thus a transfer between two matchdays affects the new snapshot without mutating the historical source day.

## Migration rule

Before enabling a producer/rebuild job:

1. port representative legacy behavior/tests;
2. identify whether it is a real producer/write or only a derived cache;
3. classify the output as **global** or **group-owned** before adding any Action;
4. keep deterministic business logic in shared TypeScript reducers;
5. use platform Actions only for globally shared data;
6. use group Actions only for group-owned persistence;
7. advance the group runtime only when existing group repositories must receive a managed artifact change;
8. validate manually through `workflow_dispatch` before any new production schedule is enabled.
