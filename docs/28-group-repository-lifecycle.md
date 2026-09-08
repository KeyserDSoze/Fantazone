# Group repository lifecycle and managed runtime

Every Fantazone group is an autonomous GitHub repository. Its GitHub name is a storage locator, not the fantasy-group identity, and may be any valid repository name.

## Ownership

### Platform repository

`KeyserDSoze/Fantazone@main` owns application code, shared reducers/jobs, global Serie A producers/data, Pages deployment and the maintained templates installed into group repositories.

### Group repository

The group owns its readable canonical state:

- `manifest.json`;
- `config/group.json`;
- root `settings.json`;
- `data/**` league/Team/TeamDay/rank/market/auction/history state;
- Fantazone-managed `.github/workflows/fantazone-group.yml`;
- any unrelated custom files/workflows added by the administrator.

Group Actions write with the repository's short-lived `GITHUB_TOKEN`. The platform repository never stores every group's PAT.

## Recommended first connection

1. User creates a repository, preferably private.
2. User creates a fine-grained PAT restricted to that repository.
3. Required permissions are `Contents: Read and write`, `Workflows: Read and write`, and `Actions: Read and write`.
4. User signs in with Microsoft and enters `owner/repository` + PAT + group display name.
5. Fantazone validates the exact repository and calls `ensureGroupInitialized()`.
6. The runtime opens the group and prepares its local offline replica.
7. Repository/PAT are persisted in the user's private OneDrive App Folder settings and locally according to the current shared-credential model.

A migrated repository may already contain `config/group.json` and `data/**` while still missing bootstrap/runtime files such as `manifest.json`, `settings.json`, `fantazone.json` or the managed workflow. In that state the existing readable `config/group.json` is sufficient to identify the repository as an existing Fantazone group: connection is allowed and `ensureGroupInitialized()` completes the missing contract without replacing migrated group data. A repository with no `config/group.json` is still rejected by the existing-group flow so Fantazone never invents an empty group over unclassified data.

## Bootstrap rules

`ensureGroupInitialized()` is idempotent.

Create-only user/canonical files include:

```text
manifest.json
config/group.json
settings.json
```

Fantazone-managed files include:

```text
.github/workflows/fantazone-group.yml
fantazone.json
```

A runtime upgrade may replace only Fantazone-managed paths. It never overwrites existing canonical `config/group.json`, `settings.json`, `data/**`, an existing manifest payload or unrelated custom workflows.

The metadata version is written last, after required managed workflow installation succeeds.

## Runtime version

`GROUP_REPOSITORY_RUNTIME_VERSION` remains an integer persisted in `fantazone.json`. It identifies the installed managed workflow/schema contract.

It is **not currently a Git branch version**.

The project has no production group repository that requires old engine compatibility, so the historical `group-runtime-v2` … `group-runtime-v8` branches were removed. The single supported engine ref is now:

```text
KeyserDSoze/Fantazone @ main
```

The group workflow currently checks out:

```text
group/          -> the writable group repository
engine/         -> KeyserDSoze/Fantazone @ main
platform-data/  -> KeyserDSoze/Fantazone @ main, sparse data/
```

If real production groups later require a frozen compatibility contract, immutable release refs/tags can be introduced at that point. We do not carry compatibility infrastructure before there is something to be compatible with.

## Local replica lifecycle

The first successful group connection requires Internet. Fantazone then prepares the device for offline use:

1. download one ZIP archive of the group branch;
2. materialize readable JSON into IndexedDB (web) or AsyncStorage (native);
3. extract the Serie A season ids used by the group;
4. download the corresponding compressed Pages data packs;
5. cache the web App Shell through the unified Service Worker.

The result is an application replica, not a Git clone. Commit history, refs and workflow source are not needed by normal offline screens.

On subsequent online openings the Serie A pack index is checked by content hash, so unchanged season packs are not downloaded again.

## Online synchronization

`manifest.revision` is the group-wide change clock. While a group is open the app checks it immediately, every 60 seconds and on foreground.

- unchanged stable revision: keep current cache;
- changed/in-flight revision: discard stale process memory, refresh authoritative membership/configuration and replace the local group snapshot after the remote copy succeeds;
- no network: continue using the durable replica;
- GitHub `401/403/409/422`: surface the real error instead of hiding it as offline state.

Normal individual document refreshes also use ETag conditional reads.

## Offline mutation rule

Offline mutation is opt-in by domain operation. We do not queue arbitrary JSON overwrites.

Formation saves are replay-safe and use a semantic outbox. The queued record describes the user's intended formation, not an old file image. On reconnection Fantazone refreshes remote state, revalidates identity/rules and executes the normal save. The outbox entry is removed only after GitHub accepts the write.

The remote GitHub commit timestamp remains the authoritative cutoff clock. Device time cannot be used to backdate a formation.

Credential changes, membership administration and OneDrive changes remain online-only until they have a safe replay design.

## Microsoft / OneDrive boundary

After one successful Microsoft login, the last verified identity and user group catalog are cached locally so local startup does not require a fresh Graph request.

An operation that actually changes OneDrive still requires Internet and a usable Microsoft Graph session. If the old session cannot be renewed, the application asks for Microsoft login at that point.

## UI operation contract

Every user-triggered asynchronous operation should immediately expose activity. The shared operation status surface shows a spinner plus a concise phase such as repository verification, local preparation, OneDrive synchronization or queued-write replay.

The user-facing states distinguish:

```text
Saved on device
Synchronizing
Synchronized with group
Offline / pending changes
```
