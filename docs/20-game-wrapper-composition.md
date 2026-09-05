# GameWrapper local composition

The legacy `GET /Game/Get` endpoint built one compact `GameWrapperRaw` by reading Group, fantasy Calendar, real Serie A calendar, Team/TeamDay and score-enrichment services. Fantazone does not reproduce that endpoint or persist another aggregate JSON file.

## New boundary

`GroupGameComposer` is an application read-model composer:

```text
selected GroupSession
  + fantasy Calendar (group repository)
  + global RealCalendar (platform repository)
  + TeamDay (preferred)
  + Team (editable fallback only)
  -> ephemeral GameWrapper
```

`GameWrapper` is exported by the domain package for UI/shared typing, but it is explicitly not a persistence contract. There is no `game.json`, `GameWrapperRaw`, raw mapper or GitHub Game repository.

## Preserved legacy semantics

For a located Calendar game:

- `serieADay` comes from the containing fantasy `CalendarDay`;
- `nextSerieADay` is projected from the shared readable RealCalendar using the legacy live/last/next timing rules;
- `canEdit = serieADay >= nextSerieADay`;
- when the global RealCalendar document is missing, the composer uses `39`, matching the old controller fallback and marks `editabilitySource = legacy-fallback`;
- TeamDay is read first for each owner;
- when TeamDay is absent and the game is editable, the current season Team is used as fallback;
- when the game is locked, mutable season Team is never used to reconstruct historical state;
- only active players are projected into the game-team view;
- stored Calendar result remains authoritative.

The caller can no longer provide `nextSerieADay`. Timing is platform data, not client input.

## Deliberately staged behavior

The old controller also enriched players with live/final votes, chances and real matches, applied the correct formation after locking, and calculated missing points/goals. Those responsibilities depend on services that have not yet migrated.

The new wrapper therefore exposes `requiresScoreCalculation` when a game is locked and has no stored result. It does not fake enriched data or silently run incomplete calculations. Future slices will add typed player enrichment and the shared TeamCalculator/formation reducer around the same wrapper.

## Why this matters

The backend endpoint existed because the server was the only place that could join multiple repositories. Fantazone now joins group-owned documents with shared platform Serie A data directly in the application runtime. Keeping GameWrapper ephemeral avoids one more duplicated projection, one more mapper and one more source of stale state.
