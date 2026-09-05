# LiveGroup schema v2 migration

`LiveGroup` is rebuilt directly on readable schema v2 rather than merging the abandoned compact migration branch.

## Canonical path

```text
data/groups/live-group.json
```

## Document

```json
{
  "name": "Amici",
  "leagues": [
    {
      "id": "league-a",
      "name": "Serie A",
      "rounds": {
        "@": {
          "serieADay": 3,
          "number": 1,
          "games": []
        }
      },
      "rank": {
        "serieADay": 3,
        "rounds": {}
      }
    }
  ]
}
```

The old representation permitted a round value to be either one day or an array of days even though the client projection selected one day. Schema v2 removes that transport ambiguity: every live round is exactly one readable `CalendarDay`.

`GitHubLiveGroupRepository` reads/writes `LiveGroup` directly through the same `GitHubJsonStore` used by Group, Calendar, Rank and Team. Helpers preserve numeric round sorting, latest-round selection, pending-game aggregation and enhanced ranking behavior.
