# Global RealCalendar migration

The legacy backend stored `RealCalendar` in Repository Framework with compact one-letter JSON and exposed computed properties such as `LiveDay`, `LastDay`, `NextDay`, `LiveGames` and `LiveSerieADay` from C#.

Fantazone keeps only the canonical readable data and computes timing locally.

## Season key

`RealCalendar.year` deliberately keeps the same **internal Fantazone season id** used by fantasy Calendar, Team and Rank. It is not a Gregorian year.

```text
15 = 2026/27
16 = 2027/28
```

This matches the legacy `FantacalcioTime.ActualYear` convention and avoids translation at every group-data join.

## Global data location

Serie A calendar data belongs to the platform repository, not to each fantasy-group repository:

```text
KeyserDSoze/Fantazone
└── data/serie-a/calendars/<season-id>.json
```

A readable 2026/27 document therefore starts as:

```json
{
  "year": 15,
  "days": [
    {
      "year": 15,
      "serieADay": 1,
      "games": [
        {
          "home": { "name": "Roma", "abbreviation": "rom" },
          "away": { "name": "Inter", "abbreviation": "int" },
          "date": "2026-08-22T18:45:00.000Z",
          "homeGoals": null,
          "awayGoals": null,
          "delayed": false
        }
      ]
    }
  ]
}
```

Dates stay ISO-8601 strings in JSON. No `Date` object, derived live state or current timestamp is persisted.

## Preserved timing rules

`RealCalendarHelper` ports the old C# behavior as pure functions with an injectable `now`:

- a game is live from kickoff through kickoff + 2h15;
- delayed games are excluded;
- a Serie A day is considered active from the first valid kickoff until the last valid kickoff + 10h15;
- `LastDay` is the highest-numbered day whose last non-delayed game is at least 2h15 in the past;
- `NextDay = (LiveDay ?? LastDay ?? 0) + 1` when that numbered day exists;
- `LiveSerieADay` and `IsLive` are projections only.

The explicit clock dependency makes tests deterministic and prevents local UI state from becoming a source of truth.

## Runtime topology

`GroupSessionRuntime` has two repository targets:

```text
target
  -> Fantazone.<group>
  -> Group, fantasy Calendar, Rank, Team, TeamDay, LiveGroup

platformTarget
  -> KeyserDSoze/Fantazone
  -> RealCalendar now; RealPlayers/votes later
```

Both use the same `GitHubJsonStore`, whose cache key includes owner/repository/path/ref.

## Game and formation integration

`GroupGameComposer` no longer accepts `nextSerieADay` from callers. It loads RealCalendar and derives editability itself. Missing platform data preserves the old `/Game/Get` fallback of day 39.

`GroupFormationWriter` no longer accepts `nextSerieADay` or `liveSerieADay`. A SuperAdmin override on a locked game is allowed only when the refreshed shared RealCalendar says that exact Serie A day is live.

## `ingest-serie-a`

The first platform ingestion job produces this canonical document directly. The legacy Gazzetta source is isolated behind an adapter instead of leaking its response shape into the domain.

Default source:

```text
https://api2-mtc.gazzetta.it/api/
```

It can be replaced through `FANTAZONE_SERIE_A_CALENDAR_BASE_URL` without changing domain or persistence code.

The mapper preserves the old source semantics:

- `FULL` and `LIVE` expose scores;
- `POSTPONED` marks the game delayed;
- missing team names are ignored;
- source UTC dates are normalized to ISO instants;
- a full run queries days 1–38;
- a day-only run replaces that day in an already existing calendar and refuses to create an incomplete calendar from scratch;
- the current Gazzetta adapter may only write the current internal season id, preventing current data from being mislabeled as historical data.

The job is manually dispatchable through `Background jobs`; scheduling can be added after the source behavior is validated in production.

## Remaining work

RealPlayers, standings, chances, live/final votes, score calculation and any historical/backfill-specific Serie A source remain pending.
