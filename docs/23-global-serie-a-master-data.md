# Global Serie A master data

This slice migrates the useful global-data behavior of legacy `AllPlayersAndAllTeamsJob` without recreating its unrelated side effects in one monolithic job.

## Legacy source of truth

Private repository: `https://github.com/KeyserDSoze/Fantasoccer`.

Relevant legacy code:

- `Fantasoccer.Business.BackgroundJobs/IngestionData/AllPlayersAndAllTeamsJob.cs`
- `Fantasoccer.Business/Services/AllPlayers/FantagazzettaAllPlayers.cs`
- `Fantasoccer.Domain/SerieA/Players/RealPlayer.cs`
- `RealPlayersWrapper.cs` / `RealTeamWrapper.cs`

## Canonical schema-v2 documents

Global data stays in the Fantazone platform repository:

```text
data/serie-a/teams/<seasonId>.json
data/serie-a/players/<seasonId>.json
```

`seasonId` uses the historical Fantasoccer convention (`15 = 2026/27`).

Example teams document:

```json
{
  "year": 15,
  "teams": [
    { "name": "Inter", "abbreviation": "int" },
    { "name": "Roma", "abbreviation": "rom" }
  ]
}
```

Example player entry:

```json
{
  "name": "Mario Rossi",
  "team": { "name": "Roma", "abbreviation": "rom" },
  "role": 3,
  "isActive": true,
  "visible": true
}
```

There are no `RealPlayerRaw`, `RealPlayersWrapperRaw` or one-letter JSON fields.

## Team discovery

Legacy Fantasoccer discovered clubs from official votes for Serie A day 1 and then used those clubs to resolve the Fantacalcio quotations page.

Fantazone intentionally derives `RealTeams` from the already normalized global `RealCalendar` instead. This removes a bootstrap dependency on final-vote ingestion and gives the master-data job one canonical source for club names/abbreviations.

The job refuses to update master data when the calendar contains fewer than 20 unique clubs by default.

## Player source and parsing

The current provider remains the legacy quotations page:

```text
https://www.fantacalcio.it/quotazioni-fantacalcio
```

It can be overridden with `FANTAZONE_PLAYERS_SOURCE_URL`.

The adapter:

- reads `.player-row` entries;
- skips `out-of-game` rows as the legacy implementation did;
- maps `p/d/c/a` to GoalKeeper/Defensor/Midfielder/Forward;
- resolves the row team against RealCalendar-derived abbreviations;
- fails on unknown club abbreviations instead of persisting a broken relation;
- fails closed when zero valid players are returned.

Provider HTML is never persisted as the canonical model.

## Reconciliation semantics

`reconcileRealPlayers()` mirrors the useful legacy behavior:

1. fresh source players are authoritative and remain in source order;
2. an existing player still present in the source uses the fresh representation, including transfers;
3. a previously inactive player returning in the source becomes active again;
4. historical players missing from the fresh source are appended with `isActive=false`;
5. `visible` and other historical fields of missing players remain preserved;
6. the legacy key remains `name.toLowerCase().replace(/[^a-z]/g, '')`;
7. duplicate resulting legacy keys fail loudly because they would make identity ambiguous.

The reconciliation result also reports added, inactive, reactivated and transferred player keys plus the legacy `playerCountChanged` signal.

## Job

`ingest-master-data` now runs through the normal TypeScript jobs workspace and manual Background jobs Action.

Order:

```text
RealCalendar
   -> derive RealTeams
   -> fetch Fantacalcio quotations HTML
   -> parse current RealPlayers
   -> read existing global RealPlayers if present
   -> reconcile active/inactive/transfers
   -> write readable teams + players JSON
   -> normal workflow commit of data/
```

The Action source URL can be configured with repository variable `FANTAZONE_PLAYERS_SOURCE_URL`.

## Deliberately separate follow-ups

The old job also regenerated player statistics when total player count changed and traversed every fantasy group to update transferred players inside every Team document.

Fantazone does **not** keep those as hidden side effects of global ingestion:

- derived statistics regeneration becomes its own deterministic job/reducer;
- group Team reconciliation becomes a group-scoped job/action using that group's own repository authorization.

This preserves behavior while respecting the platform-data vs group-data boundary.
