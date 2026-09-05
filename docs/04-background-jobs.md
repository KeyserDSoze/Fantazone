# Background jobs migration

The current Fantasoccer background-job project contains the following jobs. None may disappear silently.

| Legacy job | Legacy intent | Fantazone target |
|---|---|---|
| `SerieAJob` | refresh Serie A/calendar/live source data | **implemented first slice:** `ingest-serie-a` manual Action -> global readable RealCalendar JSON; standings/live extensions still pending |
| `AllPlayersAndAllTeamsJob` | refresh player/team master data | **global slices implemented:** `ingest-master-data` -> readable RealTeams/RealPlayers + reconciliation; `playerCountChanged` triggers independent `rebuild-player-stats`; per-group Team transfer propagation remains split into #9 |
| `LiveVotesJob` | ingest live fantasy votes | **implemented/tested:** `ingest-live-votes` -> SignedUri/protobuf adapter -> readable live vote JSON; production source validation/scheduling still pending in #29 |
| `LiveJob` | ingest live match state | `ingest-live` Action |
| `FinalVotesJob` | ingest final votes | **implemented/tested:** `ingest-final-votes` -> readable official vote JSON + completeness check + stats rebuild; production source validation/scheduling still pending in #29 |
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

Fetches the Serie A calendar and writes `data/serie-a/calendars/<season-id>.json`. The Gazzetta base URL is configurable with `FANTAZONE_SERIE_A_CALENDAR_BASE_URL`. Full refresh queries days 1–38; day-only refresh requires an existing calendar.

### `ingest-master-data`

```text
RealCalendar
  -> derive RealTeams
  -> fetch Fantacalcio quotations HTML
  -> parse current RealPlayers
  -> reconcile with existing RealPlayers
  -> data/serie-a/teams/<season-id>.json
  -> data/serie-a/players/<season-id>.json
```

Fresh players are authoritative, historical missing players become inactive, returning players reactivate, transfers use the fresh team and legacy lowercase-ASCII player identity is preserved. `playerCountChanged` matches the old trigger for stats regeneration. Clubs intentionally come from canonical RealCalendar rather than day-1 official votes.

### `rebuild-player-stats`

Reads canonical `RealPlayers` plus `official` vote documents and writes `data/serie-a/stats/<season-id>.json`. The reducer preserves missing/no-vote counters, base/fantasy summatories, bonus/card/injury/special counters and per-game positiveness. Without an explicit day it uses the legacy `RealCalendar.LastDay?.SerieADay ?? 38` choice.

`ingest-master-data` invokes it only when `playerCountChanged=true`.

### `ingest-final-votes`

Reads the legacy Fantacalcio final-vote HTML source and writes:

```text
data/serie-a/votes/official/<season-id>/<serie-a-day>.json
```

It preserves season-label mapping, vote/bonus/card semantics, the 55 no-vote sentinel, card-without-vote fallback to 6, delayed-match synthetic sixes and the old completeness check based only on teams that actually played. Partial provider output remains persisted with `complete=false`; complete output triggers `rebuild-player-stats` for the same day.

Without an explicit day it mirrors `FinalVotesJob`: `RealCalendar.LiveDay ?? RealCalendar.LastDay`.

### `ingest-live-votes`

The active legacy live provider uses Fantacalcio `SignedUri` followed by a protobuf `.dat` resource. Fantazone keeps that protocol but decodes only the protobuf fields actually used by the legacy domain, without adding a general protobuf runtime dependency.

Output:

```text
data/serie-a/votes/live/<season-id>/<serie-a-day>.json
```

The resource season preserves legacy `internalSeason + 6`; all event mappings and the 55 no-vote sentinel are preserved. Existing player metadata stays untouched when a known player receives a new live Vote; new player keys are appended. Empty provider output does not rewrite the snapshot.

Without an explicit day the provider is contacted only while RealCalendar reports an actually live match.

Full vote details: `docs/24-player-statistics-and-votes.md`, `docs/25-serie-a-vote-ingestion.md`, issues #28/#29.

## Manual operations required

The Action dispatcher supports or must support:

- refresh one data source now;
- download/fetch live/final votes for one Serie A day;
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
5. validate the real production source manually;
6. only then enable `schedule`.

Calendar, master-data, statistics and live/final vote jobs are implemented and tested. The repository does not yet contain initialized `data/serie-a` production state, so real-source validation must start by running `ingest-serie-a` then `ingest-master-data`; no automatic schedule is enabled yet.
