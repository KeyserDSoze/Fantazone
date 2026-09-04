# Background jobs migration

The current Fantasoccer background-job project contains the following jobs. None may disappear silently.

| Legacy job | Legacy intent | Fantazone target |
|---|---|---|
| `SerieAJob` | refresh Serie A/calendar/live source data | `ingest-serie-a` Action + committed normalized JSON |
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

## Job implementation strategy

Use TypeScript/Node for the first migration because it can share domain types/calculators with the React Native client and has low startup/compile overhead in Actions.

Each job implements:

```ts
export interface BackgroundJob {
  name: string
  run(context: JobContext): Promise<JobResult>
}
```

Inputs are repository files and external HTTP sources. Outputs are written to a workspace, validated, then committed atomically when possible. Raw fetched pages/responses may be uploaded as workflow artifacts for debugging.

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
