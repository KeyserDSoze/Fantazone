# Normalized current Team and immutable TeamDay snapshots

Fantazone keeps two intentionally different representations of a fantasy roster.

## Mutable season Team

The current season Team is mutable group-owned state, but Serie A player identity/master data is not group-owned. Runtime v8 therefore persists only a reference plus fantasy-specific fields:

```json
{
  "version": 3,
  "name": "My Team",
  "owner": "owner@example.com",
  "additionalOwners": [],
  "players": [
    {
      "playerKey": "mariorossi",
      "price": 17,
      "revenue": 0,
      "status": 0,
      "position": 3
    }
  ],
  "moneyFromRank": 0,
  "lastUpdate": "2026-09-07T00:00:00.000Z"
}
```

`playerKey` uses the legacy-compatible `getPlayerKey()` normalization. Name, real Serie A team, real role, active state and visibility are resolved from the shared canonical master:

```text
data/serie-a/players/<season>.json
```

Consequences:

- a real-world transfer requires one global master-data update only;
- no group repository needs a nightly transfer-propagation commit;
- every current-Team read sees the latest canonical RealPlayer data;
- fantasy-owned price/revenue/status/formation position remain in the group repository;
- current Team JSON is smaller and has one source of truth for Serie A metadata.

The in-memory domain `Team` remains hydrated with full `Player` objects. Repository and Action boundaries hydrate `playerKey` references before executing existing domain reducers and encode them back to the compact current-Team representation after mutations.

## Immutable TeamDay

A TeamDay represents what was true for one fantasy matchday and therefore deliberately stores a full snapshot.

It includes the mutable real-world fields needed for deterministic historical behavior:

- player name;
- Serie A team;
- real role;
- active state;
- visibility where applicable;
- fantasy price/revenue/status/formation position.

This means a later transfer or master-data correction never rewrites an already frozen TeamDay.

When `snapshot-formations` freezes a current Team, it resolves its player references against the canonical master and writes the full snapshot. When `set-next-formations` creates a missing future TeamDay from the previous TeamDay, it preserves the fantasy formation fields but refreshes the RealPlayer portion from the current master before freezing the new day.

## Legacy current Team migration

Existing group repositories can still contain the previous full current-Team JSON. Runtime v8 reads that format directly. The next normal current-Team write encodes it as version 3, so migration is lazy and does not require a destructive bulk rewrite.

TeamDay files are never migrated to reference form: their duplication is intentional historical state.

## Market, auction and group Actions

Any job that mutates a current Team follows the same boundary:

```text
season Team JSON (playerKey refs)
        +
global RealPlayers master
        ↓
hydrated in-memory Team
        ↓
domain reducer
        ↓
encode SeasonTeamDocument v3
```

Market proposal/state and other immutable business records may retain full player snapshots when the snapshot itself is part of the historical transaction semantics.

## Removed transfer synchronization

Runtime v7 briefly introduced a daily per-group `sync-player-transfers` job. Runtime v8 removes it completely because normalized current Teams make it redundant. The global `ingest-master-data` producer is the only place that needs to observe and persist real-world transfers.
