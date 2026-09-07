# Runtime topology: zero application servers

Fantazone separates platform data, group-owned state and the user device. There is no custom always-on application API between the client and GitHub.

## 1. Platform repository

`KeyserDSoze/Fantazone@main` contains:

- application source and GitHub Pages deployment;
- shared TypeScript domain/job engine;
- templates used to initialize group repositories;
- global football producers and normalized `data/serie-a/**`;
- compressed offline Serie A packs generated during the Pages build.

Global Actions fetch shared football data once. They never enumerate or mutate all fantasy groups.

## 2. Group repository

Each group owns one GitHub repository, with any valid repository name. It stores readable canonical state such as:

- `manifest.json` revision clock;
- `config/group.json` membership and structural model;
- `settings.json` display metadata;
- calendars, ranks, Teams and immutable TeamDays;
- market, auction outcomes and Hall of Fame state;
- `.github/workflows/fantazone-group.yml`.

The group workflow writes with that repository's short-lived `GITHUB_TOKEN`; Fantazone does not keep a central database of group PATs.

### Group Action execution

The current pre-production model intentionally has one supported engine branch: `main`.

```text
group workflow
    |
    +--> group/          selected group repository, writable
    +--> engine/         KeyserDSoze/Fantazone @ main
    +--> platform-data/  KeyserDSoze/Fantazone @ main, sparse data/
    |
    v
shared reducers/jobs
    |
    v
group data commit with repository GITHUB_TOKEN
```

`GROUP_REPOSITORY_RUNTIME_VERSION` is still stored in `fantazone.json`, but it is now a **managed workflow/schema version**, not a Git branch name. Because there are no production group installations requiring backwards compatibility yet, historical `group-runtime-vN` branches were removed. A frozen engine-ref release scheme can be reintroduced later if production compatibility actually requires it.

## Group bootstrap

The recommended flow is:

```text
Microsoft login
  -> user creates/selects GitHub repository
  -> user supplies fine-grained group PAT
  -> ensureGroupInitialized()
       -> create missing canonical bootstrap files
       -> install/update only Fantazone-managed workflow
       -> record runtime metadata
  -> GroupSessionRuntime.open()
  -> hydrate offline group + required Serie A data
```

Canonical/user-owned data is create-only during bootstrap. Existing group data and unrelated custom files/workflows are never replaced by an app upgrade.

## 3. User device: local-first runtime

The Expo web/native app owns:

- Microsoft human identity and cached last verified identity;
- OneDrive group catalog cache;
- local group PAT according to the current shared-credential model;
- IndexedDB on web / AsyncStorage on native for the readable repository replica;
- optimistic concurrency and ETag refreshes;
- an outbox for replay-safe offline operations;
- WebRTC auction realtime state.

### First online preparation

The first successful connection requires Internet. Fantazone downloads:

1. one ZIP archive of the group repository and materializes its JSON documents locally;
2. only the compressed Serie A season packs referenced by that group;
3. the normal web app shell, which the unified Service Worker caches for later offline startup.

The client does **not** clone Git history and does not fetch every group file separately.

### Normal startup

After the first successful login/sync, the app can reopen from local identity/settings/repository data. A live Microsoft Graph token is not required merely to inspect local group data.

OneDrive mutations do require network and a valid Microsoft session. If the previous Graph session cannot be renewed, Fantazone asks for Microsoft login at that operation boundary rather than blocking local startup.

### Synchronization

While a group is open:

- `manifest.json` is checked immediately, every 60 seconds and on foreground;
- unchanged revision means no group-wide download;
- changed revision triggers a fresh group snapshot;
- normal document refreshes use ETag/304;
- transport failure falls back to durable local JSON;
- GitHub permission/authentication failures remain real errors.

Formation saves are replay-safe: when offline, the requested positions are stored in an outbox and the UI immediately reports **saved on device**. On reconnection the intent is revalidated against current remote state and written normally. The GitHub commit timestamp, not device time, controls the matchday cutoff.

## User-visible operation state

Async operations use a common status surface. Long and short operations expose a spinner and plain-language phase such as:

- checking repository access;
- preparing group configuration;
- downloading offline data;
- checking for updates;
- sending locally queued changes;
- synchronizing OneDrive.

The persistent state distinguishes `synced`, `offline` and `pending changes` so users know whether a change is only local or already durable in GitHub.

## External infrastructure that may remain

Zero backend means zero custom Fantazone application server, not zero Internet infrastructure:

- GitHub-hosted runners execute Actions;
- GitHub Pages serves the app and offline data packs;
- Microsoft provides identity/OneDrive App Folder storage;
- WebRTC may need STUN/TURN;
- push delivery uses browser/Apple/Google infrastructure.

None of these hosts a central Fantazone application API or central group database.
