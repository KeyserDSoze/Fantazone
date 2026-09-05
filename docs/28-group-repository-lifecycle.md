# Group repository lifecycle and managed runtime

Every Fantazone fantasy group is an autonomous GitHub repository:

```text
Fantazone.<group-name>
```

The platform repository (`KeyserDSoze/Fantazone`) does **not** own group state and does not execute group maintenance on behalf of every group. It contains the application, shared TypeScript engine, global football producers/data and maintained templates copied into group repositories.

## Ownership boundary

### Platform-owned/global

- application source and GitHub Pages deployment;
- shared domain/job engine;
- Serie A calendar/master data/vote producers;
- other data fetched once for every group;
- source templates for Fantazone-managed group workflow files.

### Group-owned

Each `Fantazone.<group>` contains its own:

- `config/group.json`;
- leagues, baskets, rosters and budgets;
- TeamDay formations;
- fantasy calendars/results/rankings;
- market/history/Hall of Fame state;
- auction durable state;
- `.github/workflows/fantazone-group.yml` and future Fantazone-managed group workflows.

Those workflows execute in the group repository and write with that repository's `GITHUB_TOKEN`. The platform never stores the PATs for all groups.

## Creating a group from zero

`createAndInitializeGroup()` is the complete creation boundary:

```text
user chooses "create group"
        |
        v
GitHub createRepository(Fantazone.<normalized-name>, auto_init)
        |
        v
ensureGroupInitialized()
        |
        +--> manifest.json                 create only
        +--> config/group.json             create only + first admin
        +--> .github/workflows/...         Fantazone managed
        +--> fantazone.json                runtime metadata
        v
group ready to open
```

A new repository is private by default. The initial administrator is written directly into readable schema-v2 `config/group.json` and must later prove the same email through the configured external identity provider.

## Runtime version is independent from app version

Not every UI patch needs repository changes, so group workflow compatibility has its own integer:

```text
GROUP_REPOSITORY_RUNTIME_VERSION
```

`fantazone.json` records the runtime installed in that specific group:

```json
{
  "schemaVersion": 2,
  "kind": "fantazone-group",
  "groupName": "Amici",
  "groupRuntimeVersion": 2,
  "createdAt": "...",
  "updatedAt": "..."
}
```

The runtime version is incremented only when a mandatory managed artifact changes. For example:

- runtime 1: definitive day/full-season recalculation;
- runtime 2: recalculation + `set-next-formations`.

Future market/Hall-of-Fame/repair workflows can advance the runtime again.

## Upgrade on application open

Opening a saved or newly selected group is also the upgrade boundary:

```text
new app opens Fantazone.<group>
        |
        v
ensureGroupInitialized()
        |
        +--> current runtime + current managed workflow
        |       -> zero writes
        |
        +--> old runtime / old managed workflow
                -> update only Fantazone-managed paths using current blob SHA
                -> write new groupRuntimeVersion last
        |
        v
GroupSessionRuntime.open()
```

The metadata version is written **after** required managed workflows succeed. A failed workflow update therefore cannot incorrectly mark a repository as upgraded.

## Files that an upgrade may and may not replace

Fantazone currently owns this managed path:

```text
.github/workflows/fantazone-group.yml
```

It may be replaced when its maintained template changes. The file contains a warning that local edits are overwritten.

Runtime upgrades must never overwrite existing canonical group data, including:

```text
config/group.json
data/**
manifest.json (existing content)
```

Custom files and custom workflows with other names are also untouched. This gives administrators a safe extension point without letting app upgrades destroy their repository customizations.

## Central workflow rule

`.github/workflows/background-jobs.yml` in the platform repository exposes only platform/global producers and rebuilds. Group-only commands are deliberately absent from that workflow.

The shared CLI can contain both global and group job implementations because the execution boundary is explicit. Group jobs require:

```text
FANTAZONE_GROUP_REPO_ROOT
FANTAZONE_PLATFORM_REPO_ROOT
```

Without those roots they refuse to run as central platform jobs.

## Stable code, fresh global data

A group Action needs two different views of `KeyserDSoze/Fantazone`:

```text
engine/         -> group-runtime-vN   (stable code compatible with installed runtime)
platform-data/  -> main               (latest shared data/serie-a files)
```

This distinction is essential. Pinning the whole platform checkout would freeze votes/calendar; following `main` for the engine would silently change group business logic before that group had upgraded.

Runtime v2 therefore installs a workflow equivalent to:

```text
checkout Fantazone @ group-runtime-v2 -> engine/
checkout Fantazone @ main, data/ only -> platform-data/
run job from engine/
FANTAZONE_PLATFORM_REPO_ROOT = platform-data/
```

A future dedicated `Fantazone.Data` repository can replace the second checkout without changing the group ownership model.

## Publishing a new group runtime

Production group workflows must not follow a moving engine ref. Each runtime gets a never-moved compatibility ref such as:

```text
group-runtime-v2
group-runtime-v3
```

Release order:

1. implement the shared engine/template changes for runtime `N`;
2. pass typecheck, tests and application build;
3. create/freeze `group-runtime-vN` at that validated engine commit;
4. make the managed workflow template reference that engine ref;
5. raise `GROUP_REPOSITORY_RUNTIME_VERSION` when required;
6. deploy the application;
7. each group upgrades independently the next time it is opened/managed.

The engine ref must never be moved after publication. If behavior changes, publish a new runtime number.

## Permissions

Creating or updating `.github/workflows/*` requires a GitHub credential allowed to modify workflow files. Bootstrap/runtime upgrade reports a specific error when this permission is missing.

Once installed, normal group Actions use the short-lived `GITHUB_TOKEN` of their own repository for canonical group-state commits; no central Fantazone secret database is required.
