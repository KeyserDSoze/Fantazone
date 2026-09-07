# Group repository lifecycle and managed runtime

Every Fantazone fantasy group is an autonomous GitHub repository. The repository name is **not** the fantasy-group identity and no longer has to follow a `Fantazone.*` naming convention.

A repository may be called, for example:

```text
fantazone-amici-del-bar
lega-2026
fantacalcio
qualsiasi-altro-nome-github-valido
```

`Fantazone.<group-name>` remains a valid legacy/convenience convention, not a contract.

The platform repository (`KeyserDSoze/Fantazone`) does **not** own group state and does not execute group maintenance on behalf of every group. It contains the application, shared TypeScript engine, global football producers/data and maintained templates copied into group repositories.

## Ownership boundary

### Platform-owned/global

- application source and GitHub Pages deployment;
- shared domain/job engine;
- Serie A calendar/master data/vote producers;
- other data fetched once for every group;
- source templates for Fantazone-managed group workflow files.

### Group-owned

Each group repository contains its own:

- `settings.json`: presentation metadata such as the current group display name and league display names;
- `config/group.json`: structural fantasy model, stable IDs, users, baskets and league definitions;
- leagues, rosters and budgets;
- TeamDay formations;
- fantasy calendars/results/rankings;
- market/history/Hall of Fame state;
- auction durable state;
- `.github/workflows/fantazone-group.yml` and future Fantazone-managed group workflows.

Those workflows execute in the group repository and write with that repository's `GITHUB_TOKEN`. The platform never stores the PATs for all groups.

## Stable identity versus display names

The GitHub repository full name (`owner/repository`) is the durable storage locator. Inside the fantasy model, IDs such as `group.id`, `league.id` and `basket.id` are durable keys used by paths and historical data.

Human-facing names are allowed to change without changing those identifiers. Root `settings.json` is the presentation layer:

```json
{
  "version": 1,
  "group": {
    "name": "Amici del Bar"
  },
  "leagues": {
    "serie-a": { "name": "Campionato" },
    "coppa": { "name": "Coppa del Nonno" }
  }
}
```

Renaming the group or a league therefore does **not** rename the GitHub repository, league IDs, paths, calendar files or historical results. `config/group.json` names remain readable fallback/compatibility fields while `settings.json` is the repository-owned display override.

Older repositories without `settings.json` are upgraded lazily when `GroupSessionRuntime` opens: current readable names seed version 1 and subsequent renames are written only through the display-settings boundary.

## Recommended creation flow

The product deliberately recommends creating the repository **before** the PAT. This lets the fine-grained token be restricted to exactly one repository.

```text
1. user creates a GitHub repository (private recommended, any name)
2. user creates a fine-grained PAT scoped only to that repository
3. repository permissions:
      Contents  -> Read and write
      Workflows -> Read and write
      Actions   -> Read and write
4. user enters owner/repository + PAT + display group name
5. Fantazone calls ensureGroupInitialized()
6. GroupSessionRuntime opens and creates/loads settings.json
```

The creation screen links directly to GitHub repository creation and fine-grained PAT creation and explains these permissions. `Actions: Read and write` is needed for manual workflow dispatch/log operations; `Workflows: Read and write` is needed to install or upgrade managed files under `.github/workflows/`; `Contents: Read and write` covers canonical JSON and normal repository state.

`ensureGroupInitialized()` initializes an existing repository without depending on its name:

```text
existing owner/repository
        |
        v
ensureGroupInitialized()
        |
        +--> manifest.json                 create only
        +--> config/group.json             create only + first admin
        +--> .github/workflows/...         Fantazone managed
        +--> fantazone.json                runtime metadata
        v
GroupSessionRuntime.open()
        |
        +--> settings.json                 create only when missing
        v
group ready
```

Unrelated existing files are untouched. A new repository should normally be private. The initial administrator is written directly into readable schema-v2 `config/group.json` and must later prove the same email through Microsoft login.

`createAndInitializeGroup()` still exists as a programmatic/legacy convenience and may create a `Fantazone.<normalized-name>` repository automatically, but the application onboarding no longer requires or suggests that naming contract.

## Runtime version is independent from app version

Not every UI patch needs repository changes, so group workflow compatibility has its own integer:

```text
GROUP_REPOSITORY_RUNTIME_VERSION
```

`fantazone.json` records the runtime installed in that specific group. Its `groupName` field is compatibility/runtime metadata, not the authoritative display-name source; UI display names come from `settings.json` when present.

The runtime version is incremented only when a mandatory managed artifact changes.

## Upgrade on application open

Opening a saved or newly selected group is also the upgrade boundary:

```text
new app opens owner/repository
        |
        v
ensureGroupInitialized()
        |
        +--> current runtime + current managed workflow
        |       -> zero workflow writes
        |
        +--> old runtime / old managed workflow
                -> update only Fantazone-managed paths using current blob SHA
                -> write new groupRuntimeVersion last
        |
        v
GroupSessionRuntime.open()
        |
        +--> load/create settings.json
        +--> overlay display names on readable Group
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
settings.json
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

The shared fine-grained group PAT should be scoped to the exact group repository and grant only what Fantazone needs:

- `Contents: Read and write`;
- `Workflows: Read and write`;
- `Actions: Read and write`.

Creating or updating `.github/workflows/*` fails explicitly when Workflows write is absent. The real integration test against `Fantazone.Test` verifies that permission on an actual clean bootstrap.

Once installed, normal group Actions use the short-lived `GITHUB_TOKEN` of their own repository for canonical group-state commits; no central Fantazone secret database is required.
