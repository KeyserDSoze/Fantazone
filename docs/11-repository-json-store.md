# Repository JSON store and offline replica

`GitHubJsonStore` is the persistence boundary for canonical JSON documents. Product code does not deal directly with base64 Contents API payloads, stale SHA handling or HTTP cache validators.

## Responsibilities

- cache documents by `owner/repo/path/ref`;
- persist snapshots across application restarts;
- carry Git blob SHA for optimistic concurrency;
- use `ETag` / `If-None-Match` for cheap refreshes;
- preserve HTTP authorization/conflict errors as authoritative failures;
- fall back to the durable local snapshot only for transport/network failures;
- invalidate process memory when `manifest.revision` changes without destroying the last usable offline replica;
- refresh the durable replica only after newer remote data has been obtained successfully.

## Local storage

The application provides the durable adapter:

- web: IndexedDB database `fantazone-repository-cache`;
- iOS/Android: React Native AsyncStorage;
- credentials remain separate: localStorage on web for the current PAT model and SecureStore on native.

A cache entry contains the readable JSON value, its GitHub blob SHA when known and optionally its HTTP ETag. This is a materialized application database, **not a Git clone**: it contains no commit graph, refs or repository history.

## Offline hydration

Normal lazy reads still populate the cache, but a connected group also receives an explicit offline hydration pass.

### Group repository

The app downloads the selected group branch once through GitHub's ZIP archive endpoint. It parses the JSON documents client-side and materializes them in the same cache key space used by `GitHubJsonStore`.

This avoids a first-sync loop that performs one Contents API request for every group file.

### Shared Serie A data

The Pages deployment builds one compressed `.json.gz` pack per Serie A season from `data/serie-a/**`. A group snapshot extracts the season ids referenced by `config/group.json` and downloads only those season packs.

Each pack has a SHA-256 content hash in `/offline/serie-a/index.json`. A device that already has the same hash skips the pack; changed packs replace only the paths belonging to that season.

The result is:

```text
GitHub group repository --ZIP--> local group JSON
Fantazone Pages --------packs--> local Serie A JSON
                               |
                               v
                    IndexedDB / AsyncStorage
```

## Read semantics

A normal `readJson()` checks memory, then durable storage, then GitHub only when needed.

`readJson(..., { refresh: true })` asks GitHub for current data. When an ETag is available, unchanged content returns `304 Not Modified` and the cached JSON is reused.

If the network request itself cannot be made and a durable snapshot exists, the refresh returns that snapshot with `fromCache: true`. A real GitHub error such as `401`, `403`, `409` or `422` is never converted into offline success.

## Revision synchronization

Every group repository contains `manifest.json` with a monotonically increasing `revision`.

Application writes publish a two-phase revision around the canonical write:

1. increment revision with `updating: true`;
2. write the canonical document using optimistic concurrency;
3. increment revision again with `updating: false`.

Group Actions commit `data/**` and a stable manifest revision together.

While a group is open the app checks the manifest immediately, every 60 seconds and when the app returns to foreground. If the remote revision is unchanged, no group-wide refresh occurs. If it changed, stale **memory** is discarded, current membership/configuration is refreshed and a new ZIP snapshot replaces the durable group replica. The old durable copy is not deleted merely because a newer revision exists.

## Offline writes

Offline writes are not implemented as blind cached JSON replacement. Only operations with a safe semantic replay contract should enter an outbox.

Formation saves use an appendable local intent containing identity, fixture/team target and requested positions. When connectivity returns the app:

1. refreshes authoritative remote state;
2. revalidates membership and formation rules;
3. replays the formation save through the normal writer;
4. removes the outbox item only after GitHub accepts it.

The GitHub commit timestamp remains the authoritative cutoff clock. A formation prepared before kickoff but synchronized after kickoff therefore applies according to the actual remote commit time, not a user-controlled device clock.

Administrative, credential and OneDrive mutations remain online-only unless they receive an equally safe replay contract.

## Conflict rule

A second writer using an obsolete SHA receives `RepositoryWriteConflictError` instead of silently overwriting newer state. Automatic retry is allowed only where the domain operation is explicitly idempotent or semantically replayable.
