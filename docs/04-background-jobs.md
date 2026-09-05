# Background jobs migration

The current Fantasoccer background-job project contains the following jobs. None may disappear silently.

| Legacy job | Legacy intent | Fantazone target |
|---|---|---|
| `SerieAJob` | refresh Serie A/calendar/live source data | **implemented first slice:** `ingest-serie-a` manual Action -> global readable RealCalendar JSON; standings/live extensions still pending |
| `AllPlayersAndAllTeamsJob` | refresh player/team master data | `ingest-master-data` Action |
| `LiveVotesJob` | ingest live fantasy votes | `ingest-live-votes` Action |
| `LiveJob` | ingest live match state | `ingest-live` Action |
| `FinalVotesJob` | ingest final votes | `ingest-final-votes` Action, also manually dispatchable by day |
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

The first migrated producer is deliberately narrow: it fetches the Serie A calendar and writes `data/serie-a/calendars/<season-id>.json` using the exact readable `RealCalendar` domain contract.

The Gazzetta response is isolated in a source adapter. Its base URL defaults to the one used by Fantasoccer and is configurable with `FANTAZONE_SERIE_A_CALENDAR_BASE_URL`.

Full refresh queries days 1–38. A day-only refresh requires an existing calendar and replaces that day; it never creates a partial calendar accidentally. The current-source adapter refuses historical season ids so current fixtures cannot be mislabeled as a backfill.

## Manual operations required

The Action dispatcher must support at least:

- refresh one data source now;
- download/fetch votes for one Serie A day;
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

`ingest-serie-a` is currently at step 4: implementation and deterministic tests exist, but the external source still needs a successful manual production run before any schedule is added.
