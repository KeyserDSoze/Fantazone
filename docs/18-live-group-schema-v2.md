# LiveGroup schema v2 migration

`LiveGroup` remains the readable contract for the live fantasy read model, but it is no longer canonical persisted runtime state.

## Historical compatibility path

```text
data/groups/live-group.json
```

This path was introduced while replacing the old compact storage format. `GitHubLiveGroupRepository` still reads/writes it for migration compatibility and tests, but new runtime code must prefer `GroupLiveComposer`.

## Read model

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

The old representation permitted a round value to be either one day or an array of days even though the client projection selected one day. Schema v2 keeps every live round as exactly one readable `CalendarDay`.

## Current runtime source

`GroupLiveComposer` derives this object in memory from:

```text
Group + Calendar + Rank + TeamDay
                +
RealCalendar + official/live votes
                |
                v
            LiveGroup
```

No backend aggregate call and no periodic per-group `live-group.json` write is required.

Helpers such as `LiveLeagueHelper` and `LiveGroupHelper` remain valid because they operate on the read-model contract, regardless of whether it came from an old JSON file or the new local composer.

The migration and LiveJob-retirement rationale is documented in `docs/26-local-live-composition.md` and issue #30.
