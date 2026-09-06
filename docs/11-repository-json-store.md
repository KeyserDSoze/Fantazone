# Repository JSON store

The first GitHub client can read and write raw repository files, but product features should not know about base64 content, Contents API payloads or stale SHA errors. `GitHubJsonStore` is the persistence boundary for canonical JSON documents.

## Goals

- keep GitHub transport details out of React screens and business-domain code;
- allow public repository reads without requiring a PAT;
- parse/serialize canonical JSON in one place;
- cache documents by `owner/repo/path/ref`;
- optionally persist snapshots across application restarts without cloning a repository;
- carry the GitHub content SHA as an optimistic-concurrency token;
- avoid blind overwrites by fetching the current SHA before an uncached update;
- turn GitHub `409` / stale-version failures into `RepositoryWriteConflictError`;
- update local caches with the new SHA returned by GitHub after a successful write;
- invalidate group documents automatically when `manifest.revision` changes.

## Example

```ts
const github = new GitHubClient(groupPat)
const store = new GitHubJsonStore(github)

const location = {
  owner: 'KeyserDSoze',
  repo: 'Fantazone.Amici-del-Bar',
  path: 'config/group.json',
  ref: 'main',
}

const current = await store.readJson<GroupConfig>(location)

await store.writeJson(
  location,
  { ...current.value, title: 'Nuovo nome' },
  'group: rename',
  { expectedSha: current.sha },
)
```

A second writer using the old SHA receives a typed conflict instead of silently replacing newer state.

## Cache semantics

A normal `readJson` checks the in-memory snapshot first and, when configured, a durable application cache next. `readJson(..., { refresh: true })` bypasses both and captures the current GitHub SHA. Values returned to callers are defensive JSON copies so mutating an object in a component does not mutate the cached canonical value.

The application provides the durable adapter:

- web: IndexedDB (`fantazone-repository-cache`);
- iOS/Android: React Native AsyncStorage;
- GitHub package: storage-agnostic `RepositoryJsonPersistentCache` interface.

The durable cache stores only JSON snapshots plus their Git blob SHA. It is not a Git clone and does not contain repository history, refs, workflow files or the full repository tree.

Persistent-cache failures are deliberately non-fatal. GitHub remains the source of truth and a remote refresh can always repopulate the local cache.

## Revision synchronization

Every group repository contains `manifest.json` with a monotonically increasing `revision`.

Application writes go through `RepositoryRevisionContentClient`, which advances the manifest revision before writing the changed group document. Advancing first can produce a harmless no-op revision if the later document write conflicts, but it avoids the unsafe opposite state where canonical data changed without advancing the sync clock.

Managed group jobs also increment `manifest.revision` whenever they commit canonical `data/` changes.

While a group is open, the app checks only `manifest.json`:

- immediately after the runtime opens;
- every 60 seconds;
- whenever the application returns to the foreground.

If the revision is unchanged, no group documents are invalidated or downloaded. If it changes, cached documents for that group repository are removed while the freshly fetched manifest is preserved; `config/group.json` is then refreshed immediately so membership and group metadata are authoritative. Other documents are fetched lazily when their repositories/screens request them.

A revision observed from the app's own write is kept in the runtime, preventing the next poll from treating that local write as an unrelated remote update.

## Public reads

`new GitHubClient()` can read public repository content without an `Authorization` header. Operations involving `/user`, repository creation or writes still require a token. This separation is important for the planned public shared Serie A data source: spectators and demo users should not need a GitHub credential just to read canonical public data.

## What this does not solve yet

- HTTP `ETag` / `If-None-Match` conditional requests;
- fully offline authorization/session policy;
- automatic semantic merge after a write conflict;
- path/area-level manifest revisions for selectively invalidating only one logical subset;
- append-only command/event reducers for highly concurrent operations.

Those remain separate layers. A conflict should only be retried automatically when the domain operation is known to be idempotent/safely replayable.
