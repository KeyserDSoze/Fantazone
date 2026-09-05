# Global RealCalendar migration

The legacy backend stored `RealCalendar` in Repository Framework with compact one-letter JSON and exposed computed properties such as `LiveDay`, `LastDay`, `NextDay`, `LiveGames` and `LiveSerieADay` from C#.

Fantazone keeps only the canonical readable data and computes timing locally.

## Global data location

Serie A calendar data belongs to the platform repository, not to each fantasy-group repository:

```text
KeyserDSoze/Fantazone
└── data/serie-a/calendars/<year>.json
```

A readable document looks like:

```json
{
  "year": 2026,
  "days": [
    {
      "year": 2026,
      "serieADay": 1,
      "games": [
        {
          "home": { "name": "Roma", "abbreviation": "ROM" },
          "away": { "name": "Inter", "abbreviation": "INT" },
          "date": "2026-08-22T18:45:00Z",
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

`GroupSessionRuntime` now has two repository targets:

```text
target
  -> Fantazone.<group>
  -> Group, fantasy Calendar, Rank, Team, TeamDay, LiveGroup

platformTarget
  -> KeyserDSoze/Fantazone
  -> RealCalendar now; RealPlayers/votes later
```

Both use the same `GitHubJsonStore`, whose cache key already includes owner/repository/path/ref.

## Game and formation integration

`GroupGameComposer` no longer accepts `nextSerieADay` from callers. It loads RealCalendar and derives editability itself. Missing platform data preserves the old `/Game/Get` fallback of day 39.

`GroupFormationWriter` no longer accepts `nextSerieADay` or `liveSerieADay`. A SuperAdmin override on a locked game is allowed only when the refreshed shared RealCalendar says that exact Serie A day is live.

## Remaining work

This migration provides the data contract, repository and timing projections. The ingestion Action that fetches the actual Serie A schedule/results is still pending, as are RealPlayers, chances, live/final votes and score calculation.
