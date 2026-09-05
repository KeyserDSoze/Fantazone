# Background jobs migration

The current Fantasoccer background-job project contains the following jobs. None may disappear silently.

| Legacy job | Legacy intent | Fantazone target |
|---|---|---|
| `SerieAJob` | refresh Serie A/calendar/live source data | **implemented first slice:** `ingest-serie-a` manual Action -> global readable RealCalendar JSON; standings/live extensions still pending |
| `AllPlayersAndAllTeamsJob` | refresh player/team master data | **global slices implemented:** `ingest-master-data` -> readable RealTeams/RealPlayers + reconciliation; `playerCountChanged` now triggers independent `rebuild-player-stats`; per-group Team transfer propagation remains split into #9 |
| `LiveVotesJob` | ingest live fantasy votes | `ingest-live-votes` Action tracked in #29 |
| `LiveJob` | ingest live match state | `ingest-live` Action |
| `FinalVotesJob` | ingest final votes | `ingest-final-votes` Action, manually dispatchable by day; tracked in #29 |
| `PlayerOddsJob` | ingest player odds/probabilities | `ingest-player-odds` Action |
| `PlayerImagesJob` | refresh player images | `ingest-player-images` Action/assets |
| `SetFormationJob` | copy previous formation to next day when missing | deterministic `set-next-formations` job |
| `GroupsManagerJob` | update/recalculate group state | `rebuild-groups` job |
| `NewsJob` | news ingestion, currently disabled | tracked; implement only if product keeps feature |
| `TeamHelperJob` | team helper calculations, currently disabled | migrate to pure domain calculation or Action |
| `PushNotificationJob` | decide/send notifications | decision logic migrates; delivery requires explicit transport design |
| `HallOfFameJob` | historical/Hall of Fame aggregation | `rebuild-hall-of-fame` Action |
| `MarketJob` | scheduled market state processing | `process-market` Action/domain reducer |

## Legacy scheduling discovered

The current host configures frequent jobs including Serie A every 5 minutes, live/live-votes/push roughly every minute, daily master/market/group jobs and scheduled final-vote/odds/Hall-of-Fame refreshes. GitHub scheduled workflows have coarser operational characteristics, so exact cadence must be revalidated rather than copied blindly.

## Current job runtime

`src/jobs` is a TypeScript workspace sharing `@fantazone/domain` and `@fantazone/github` with the application. CI typechecks and tests it like the other workspaces.

The dispatcher receives:

```text
npm run job --workspace=@fantazone/jobs -- <job> [day] [season-id]
```

`Background jobs` exposes the same inputs through `workflow_dispatch`. Implemented jobs write canonical files into the checked-out repository; the workflow commits only `data/` changes after successful execution.

### `ingest-serie-a`

The first migrated producer fetches the Serie A calendar and writes `data/serie-a/calendars/<season-id>.json` using the readable `RealCalendar` domain contract.

The Gazzetta response is isolated in a source adapter. Its base URL defaults to the one used by Fantasoccer and is configurable with `FANTAZONE_SERIE_A_CALENDAR_BASE_URL`.

Full refresh queries days 1–38. A day-only refresh requires an existing calendar and replaces that day; it never creates a partial calendar accidentally. The current-source adapter refuses historical season ids so current fixtures cannot be mislabeled as a backfill.

### `ingest-master-data`

The legacy `AllPlayersAndAllTeamsJob` mixed platform master-data ingestion, statistics regeneration and writes into every fantasy-group Team. Fantazone deliberately splits those responsibilities.

The implemented global master-data slice does:

```text
RealCalendar
  -> derive RealTeams
  -> fetch Fantacalcio quotations HTML
  -> parse current RealPlayers
  -> reconcile with existing RealPlayers
  -> write data/serie-a/teams/<season-id>.json
  -> write data/serie-a/players/<season-id>.json
```

Important parity rules:

- fresh source players are authoritative;
- historical players missing from the source remain with `isActive=false`;
- returning players become active again;
- real-team transfers come from the fresh source representation;
- legacy player identity is lowercase ASCII letters only;
- `playerCountChanged` matches the legacy condition that triggered statistics regeneration.

Intentional architecture difference: clubs are derived from canonical RealCalendar instead of bootstrapping RealTeams from official day-1 votes.

The current quotations source defaults to `https://www.fantacalcio.it/quotazioni-fantacalcio` and can be overridden with `FANTAZONE_PLAYERS_SOURCE_URL`.

### `rebuild-player-stats`

Player statistics are now a separate deterministic global reducer/job. Inputs are canonical `RealPlayers` plus one `official` vote document per Serie A day. Output is:

```text
data/serie-a/stats/<season-id>.json
```

The job preserves the legacy missing/no-vote counters, base/fantasy summatories, bonus/card/injury/special counters and per-game positiveness. `calculateVoteValue()` ports the required `TeamCalculator.FinalValue` behavior, including goalkeeper clean sheet.

Without an explicit day, rebuild uses the legacy `RealCalendar.LastDay?.SerieADay ?? 38` choice. The job is also manually dispatchable for a specific day.

`ingest-master-data` invokes this job only when reconciliation reports `playerCountChanged=true`, exactly matching the old trigger; transfer-only changes do not trigger stats regeneration.

The vote JSON contract and repository are already defined, but external live/final vote producers remain #29.

Full details: `docs/23-global-serie-a-master-data.md`, `docs/24-player-statistics-and-votes.md`, issues #27/#28/#29.

## Manual operations required

The Action dispatcher must support at least:

- refresh one data source now;
- download/fetch votes for one Serie A day;
- rebuild player statistics;
- recalculate one fantasy day;
- recalculate all days for a season/group;
- rebuild standings;
- rebuild Hall of Fame;
- repair/validate repository data.

## Migration rule

Before enabling a scheduled job:

1. port its legacy tests/behavior;
2. capture representative legacy input/output fixtures;
3. verify deterministic output;
4. enable `workflow_dispatch` first;
5. only then enable `schedule`.

`ingest-serie-a`, `ingest-master-data` and `rebuild-player-stats` are implemented/tested and manually dispatchable. External source jobs still require successful production validation before any schedule is enabled.
