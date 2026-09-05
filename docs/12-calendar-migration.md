# Calendar migration

Calendar was the first complete feature moved from the Fantasoccer repository framework to GitHub.

## Repository scope

The selected `Fantazone.<group>` repository already identifies the group, so Calendar uses:

```text
data/groups/seasons/<season>/leagues/<league>/calendar.json
```

`GitHubCalendarRepository` reads this through the shared `GitHubJsonStore`.

## Schema v2

The canonical file is a `Calendar` document directly:

```json
{
  "year": 15,
  "rounds": {
    "@": [
      {
        "serieADay": 3,
        "number": 1,
        "games": []
      }
    ]
  }
}
```

Games/results/points likewise use readable names (`homeOwner`, `awayOwner`, `defensiveBonus`, `isCancelled`, `homeGoals`, ...). The former naming mapper is gone.

## Preserved behavior

- result-type and has-value helpers;
- fantasy goal thresholds;
- round/day/game helpers;
- pending games;
- case-insensitive team lookup;
- enhanced calendar projection;
- cache reuse through the shared JSON store.

Generation/recalculation Actions must produce this same readable Calendar shape.
