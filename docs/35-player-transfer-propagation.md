# Serie A player transfer propagation

Legacy `AllPlayersAndAllTeamsJob` combined two responsibilities:

1. refresh the global Serie A RealPlayers/RealTeams master;
2. propagate a changed real club into active players embedded in every fantasy Team.

Fantazone splits these responsibilities because the platform repository must never enumerate or mutate every group repository.

## Global side

`ingest-master-data` owns:

```text
data/serie-a/players/<season>.json
data/serie-a/teams/<season>.json
```

`reconcileRealPlayers()` records added, inactive, reactivated and transferred legacy player keys in the producer result.

The global producer never needs a group PAT and never writes `Fantazone.<group>` repositories.

## Group-owned side

Group runtime v7 adds:

```text
sync-player-transfers
```

and schedules it daily at `05:30 UTC`.

The group workflow already checks out current platform `data/`, so the job compares each current-season canonical Team with the latest global `RealPlayers` document.

For every fantasy player whose `status === Active`:

- match by the legacy normalized player key;
- if the master player exists and the real team name changed, copy only the canonical `RealTeam` snapshot;
- preserve fantasy price, revenue, status, formation position, visibility and all other player fields;
- preserve Team `lastUpdate`, matching the useful legacy behavior;
- ignore master players not present in the fantasy roster;
- ignore sold/removed historical roster entries.

Only current canonical Team documents are changed:

```text
data/groups/seasons/<season>/teams/<basket>/<owner>.json
```

Immutable day snapshots under `data/groups/seasons/<season>/days/...` are deliberately never rewritten. A real-world transfer discovered today must not mutate a formation snapshot that represented an earlier matchday.

## Persistence and concurrency

The job runs inside the existing group-maintenance concurrency lock. If `manifest.json` has `updating=true`, the job defers rather than racing a client two-phase write.

Changed Team files are committed by the managed group workflow together with one manifest revision increment. If no active fantasy player changed real club, the workflow creates no data commit.

## Scheduling note

The legacy server ran the combined master/group job daily at 05:00. Fantazone keeps the group propagation close to that cadence while separating global ingestion from group mutation.

The group schedule consumes whatever canonical master is currently available on platform `main`. Production scheduling/validation of `ingest-master-data` remains a separate global-producer concern; the group job is idempotent and safely no-ops when the master has not changed.

## Tests

Coverage includes:

- pure reducer updates only active players;
- sold/history entries are preserved;
- unrelated player fields and Team `lastUpdate` remain unchanged;
- filesystem orchestration updates current Team documents only;
- TeamDay snapshots remain immutable;
- missing canonical Teams are reported without creating synthetic data;
- client `manifest.updating` causes a safe defer;
- group runtime v7 contains the manual job and daily schedule.
