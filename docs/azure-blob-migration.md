# Azure Blob → GitHub historical migration

This is the one-time recovery tool for moving legacy Fantasoccer data from Azure Blob Storage into the current readable Fantazone repositories.

The migration is deliberately **outside the runtime**. Legacy compact JSON (`i`, `n`, `p`, `mg`, `pts`, …) is decoded here once and written as the current readable contracts; the app itself does not reintroduce `*Raw` compatibility models.

## What is migrated

### Group repository

For the selected Fantasoccer group:

- `group` → `config/group.json`;
- `calendar` → `data/groups/seasons/<season>/leagues/<league>/calendar.json`;
- `rank` → season `ranking.json`;
- `dailyrank` → day `ranking.json`;
- `team` → normalized season Team schema v3 (`playerKey` + fantasy-owned fields);
- `dailyteams` → immutable full readable TeamDay snapshots;
- `halloffame` → `data/groups/leagues/<league>/hall-of-fame.json`.

### Shared Fantazone repository

The shared Serie A data is written to the platform repository (default `KeyserDSoze/Fantazone`):

- `realcalendar` → `data/serie-a/calendars/<season>.json`;
- `realteamwrapper` → `data/serie-a/teams/<season>.json`;
- `realplayerswrapper` → `data/serie-a/players/<season>.json`;
- `official` / `live` → `data/serie-a/votes/<kind>/<season>/<day>.json`;
- `statplayerswrapper` → `data/serie-a/stats/<season>.json`;
- `chancedrealplayerwrapper` → `data/serie-a/chances/<season>/<day>.json`.

Containers that no longer have a canonical runtime responsibility (identity/settings/logs/notifications/LiveGroup), binary assets and legacy Auction/Cards are inventoried but their content is not transformed. In particular the migration never attempts to parse/decrypt legacy Auction AES payloads.

## Why the compact JSON is safe to decode

Legacy Rystem Blob Repository stores each repository entity as a JSON envelope:

```json
{
  "k": { "g": "group", "l": "league", "y": 15 },
  "v": { "...": "legacy compact domain JSON" }
}
```

The reader also accepts the older `Key` / `Value` names. Composite keys therefore come from the serialized key, not from guessing separators in a blob name.

The value mapper is type-specific. There is intentionally no generic rule such as “`p` always means players”: in different aggregates the same compact name means different things.

## Prerequisites

- PowerShell 7+ recommended (Windows PowerShell 5.1 also works for the wrapper);
- Node.js 20+;
- `npm install` completed in the Fantazone repository;
- Azure Storage connection string with read access to the old Blob Storage;
- a GitHub PAT with Contents read/write access to the target group repository;
- a GitHub PAT with Contents read/write access to the platform repository for shared Serie A data.

The tool uses `@azure/storage-blob`; Azure CLI is **not required**.

## Install

```powershell
git clone https://github.com/KeyserDSoze/Fantazone.git
cd Fantazone
git checkout feat/azure-blob-migration-tooling
npm install
npm run test:migration
```

## Recommended secret setup

Do not put PATs or the Azure connection string in files committed to Git. The PowerShell wrapper accepts values from environment variables:

```powershell
$env:FANTAZONE_AZURE_CONNECTION_STRING = '<azure connection string>'
$env:FANTAZONE_GROUP_PAT = '<group repository PAT>'
$env:FANTAZONE_PLATFORM_PAT = '<platform repository PAT>'
```

If one of these variables is absent, the wrapper prompts for it as a secure input.

## 1. Dry-run first

Dry-run is the default: it reads Azure, builds every converted JSON document, checks GitHub target paths and writes only a local report.

For a group repository called `Fantazone.MyLeague`:

```powershell
./scripts/migration/Invoke-FantazoneAzureMigration.ps1 `
  -GroupRepository 'KeyserDSoze/Fantazone.MyLeague' `
  -PlatformRepository 'KeyserDSoze/Fantazone' `
  -PreserveExisting
```

`-PreserveExisting` is recommended when `KeyserDSoze/Fantazone` already contains current-season Serie A data: historical missing paths are planned, existing canonical paths are skipped.

The report is created under `migration-output/azure-migration-<timestamp>.json` and contains:

- every Azure container and blob name/size/date discovered;
- which containers were actually downloaded;
- the selected legacy group id/name;
- every Azure blob → GitHub path mapping;
- collisions/skips;
- planned counts for group and platform repositories.

The report never contains the connection string or PAT values.

If the storage contains multiple groups and repository-name auto-selection is ambiguous, add:

```powershell
-GroupId 'legacy-group-id'
```

## 2. Apply

After reviewing the dry-run report, add `-Apply`:

```powershell
./scripts/migration/Invoke-FantazoneAzureMigration.ps1 `
  -GroupRepository 'KeyserDSoze/Fantazone.MyLeague' `
  -PlatformRepository 'KeyserDSoze/Fantazone' `
  -PreserveExisting `
  -Apply
```

Each target repository is updated with one Git tree/commit/ref fast-forward, not one commit per migrated file.

### Collision modes

Default (no switch): fail closed if any destination path already exists.

`-PreserveExisting`: keep existing files and migrate only missing canonical paths. This is the normal choice for the platform repository if it already has new-season data.

`-Overwrite`: replace existing canonical paths with migrated legacy data.

`-Overwrite` and `-PreserveExisting` are mutually exclusive.

## Empty target repositories

An empty repository on its default branch is supported. The writer creates a temporary `.fantazone-migration-bootstrap` marker only to establish the first Git commit, then removes that marker in the atomic migration tree. If an attempt fails after bootstrap, it performs best-effort marker cleanup.

An empty repository plus a non-default/custom target branch fails explicitly; bootstrap the default branch first instead of creating an invalid branch state.

## Azure connection strings

Standard connection strings supported by the Azure SDK work directly. The migration additionally handles:

- `BlobEndpoint + SharedAccessSignature` without requiring `AccountName`;
- SharedKey / `AccountKey` only when `AccountName` is also present;
- `UseDevelopmentStorage=true` for Azurite/local tests.

## Validation after migration

Run locally:

```powershell
npm run test:migration
npm test
npm run typecheck
```

Then inspect both GitHub commits listed in the apply report and run the normal Fantazone CI.

Recommended functional checks:

1. open the migrated group and verify available historical seasons;
2. open historical Calendar and Ranking pages;
3. inspect at least one season Team and one immutable TeamDay;
4. verify Hall of Fame;
5. inspect old Serie A players/teams/calendar and official votes;
6. compare report source counts against the Azure inventory;
7. run the same command again in dry-run with `-PreserveExisting`: all already imported paths should appear as collisions/skips rather than producing duplicates.

## Direct Node CLI

PowerShell is only a secret-safe convenience wrapper. The underlying CLI can also be run directly after setting the three environment variables:

```powershell
node scripts/migration/migrate-azure-to-github.mjs `
  --group-repository 'KeyserDSoze/Fantazone.MyLeague' `
  --platform-repository 'KeyserDSoze/Fantazone' `
  --preserve-existing
```

Add `--apply` for writes. Use `--help` for all options.
