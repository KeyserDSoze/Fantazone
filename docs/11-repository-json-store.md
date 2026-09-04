# Repository JSON store

The first GitHub client can read and write raw repository files, but product features should not know about base64 content, Contents API payloads or stale SHA errors. `GitHubJsonStore` is the persistence boundary for canonical JSON documents.

## Goals

- keep GitHub transport details out of React screens and business-domain code;
- allow public repository reads without requiring a PAT;
- parse/serialize canonical JSON in one place;
- cache documents by `owner/repo/path/ref`;
- carry the GitHub content SHA as an optimistic-concurrency token;
- avoid blind overwrites by fetching the current SHA before an uncached update;
- turn GitHub `409` / stale-version failures into `RepositoryWriteConflictError`;
- update the local cache with the new SHA returned by GitHub after a successful write;
- support explicit cache invalidation after manifest/revision changes.

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

A normal `readJson` can return the in-memory snapshot. `readJson(..., { refresh: true })` bypasses it and captures the current GitHub SHA. Values returned to callers are defensive JSON copies so mutating an object in a component does not mutate the cached canonical value.

The cache is intentionally an optimization, not an offline database. The future manifest watcher can invalidate selected documents when `manifest.revision` changes.

## Public reads

`new GitHubClient()` can read public repository content without an `Authorization` header. Operations involving `/user`, repository creation or writes still require a token. This separation is important for the planned public shared Serie A data source: spectators and demo users should not need a GitHub credential just to read canonical public data.

## What this does not solve yet

- HTTP `ETag` / `If-None-Match` conditional requests;
- persistent/offline cache across application restarts;
- automatic semantic merge after a write conflict;
- append-only command/event reducers for highly concurrent operations.

Those remain separate layers. A conflict should only be retried automatically when the domain operation is known to be idempotent/safely replayable.
