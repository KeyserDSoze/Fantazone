# Azure Blob → GitHub historical migration

This tool moves legacy Fantasoccer data from Azure Blob Storage into the readable Fantazone repositories. It is intentionally outside the app runtime: compact legacy JSON is decoded once and committed as the current canonical contracts.

The migration is **resumable and repeatable**. A normal rerun now performs an incremental Azure sync: it enumerates blob metadata, reuses cached bodies for unchanged blobs, downloads only new or changed canonical blobs, resumes already-converted staging records, and can add only missing GitHub paths with `-PreserveExisting`.

## What is migrated

### Group repository

For the selected Fantasoccer group:

- `group` → `config/group.json`;
- `calendar` → `data/groups/seasons/<season>/leagues/<league>/calendar.json`;
- `rank` → season `ranking.json`;
- `dailyrank` → day `ranking.json`;
- `team` → normalized season Team schema v3;
- `dailyteams` → immutable full TeamDay snapshots;
- `halloffame` → `data/groups/leagues/<league>/hall-of-fame.json`.

### Shared Fantazone repository

- `realcalendar` → `data/serie-a/calendars/<season>.json`;
- `realteamwrapper` → `data/serie-a/teams/<season>.json`;
- `realplayerswrapper` → `data/serie-a/players/<season>.json`;
- `official` / `live` → `data/serie-a/votes/<kind>/<season>/<day>.json`;
- `statplayerswrapper` → `data/serie-a/stats/<season>.json`;
- `chancedrealplayerwrapper` → `data/serie-a/chances/<season>/<day>.json`.

Containers without a canonical responsibility in Fantazone, binary assets and legacy Auction/Cards are inventoried but their content is not transformed.

## RealCalendar corruption protection

Legacy Rystem stores the repository key separately from the compact value. That matters for `RealCalendar`: older Fantasoccer jobs could request the provider's next-season calendar before the internal August 10 season switch and overwrite the previous season's blob. Some historical payloads also contain top-level `y = 0` even though their Azure/Rystem key is correct.

The migration therefore treats the **Azure/Rystem key as the canonical season id**, but it does not blindly rewrite the payload year. Every dated Serie A match must also fall inside that season's August-10-to-August-10 window. A zero `y` is repaired only when the dates prove the payload belongs to the keyed season.

If the current `realcalendar` blob belongs to the wrong season, the scanner automatically checks Azure Blob **version history** and selects the newest older version that validates for that key. This recovers overwritten historical calendars when Storage versioning was enabled. If no valid version exists, the record is quarantined, listed under `source.issues` in the migration report, and is not emitted as a canonical JSON file. The migration continues with the other blobs instead of importing knowingly wrong football data.

Recovered calendars are listed under `source.recoveries` in the report with the Azure `versionId` used.

## Prerequisites

- PowerShell 7+ recommended (Windows PowerShell 5.1 also works for the wrapper);
- Node.js 20+;
- `npm install` completed in Fantazone;
- Azure Storage connection string with read/list access to the old Blob Storage;
- GitHub PAT with Contents read/write access to the target group repository;
- GitHub PAT with Contents read/write access to the platform repository.

The tool uses `@azure/storage-blob`; Azure CLI is not required.

## Secret setup

Do not commit credentials. The PowerShell wrapper reads these environment variables or prompts securely when one is missing:

```powershell
$env:FANTAZONE_AZURE_CONNECTION_STRING = '<azure connection string>'
$env:FANTAZONE_GROUP_PAT = '<group repository PAT>'
$env:FANTAZONE_PLATFORM_PAT = '<platform repository PAT>'
```

## Recommended rerun: discover and add new blobs

For the common case "I have used the legacy app again and Azure now contains additional blobs", run the **same migration again** with `-PreserveExisting`:

```powershell
./scripts/migration/Invoke-FantazoneAzureMigration.ps1 `
  -GroupRepository 'KeyserDSoze/Fantazone.MyLeague' `
  -PlatformRepository 'KeyserDSoze/Fantazone' `
  -PreserveExisting
```

Dry-run remains the default, so this first invocation does not modify GitHub. On a normal rerun the tool:

1. enumerates the current Azure containers/blob metadata;
2. compares `ETag` (or, for older caches, last-modified + size) against the local cache;
3. reuses the cached raw entity for unchanged blobs;
4. downloads only new or modified canonical blobs;
5. resumes unchanged conversion checkpoints;
6. converts new/changed records;
7. inspects the current GitHub targets;
8. with `-PreserveExisting`, plans only paths that do not already exist.

After reviewing the report/staged trees, repeat with `-Apply`:

```powershell
./scripts/migration/Invoke-FantazoneAzureMigration.ps1 `
  -GroupRepository 'KeyserDSoze/Fantazone.MyLeague' `
  -PlatformRepository 'KeyserDSoze/Fantazone' `
  -PreserveExisting `
  -Apply
```

This is the **add-only incremental sync** mode: old GitHub files remain untouched and newly-created Azure entities are added automatically.

If an existing Azure entity changed and the corresponding canonical GitHub file must also be replaced, use `-Overwrite` instead of `-PreserveExisting`. The two switches are mutually exclusive.

## One-time repair of already-imported calendars

To repair the bad `RealCalendar` files produced by the earlier migration without opening every existing path to overwrite, add `-RepairImportedCalendars` together with `-PreserveExisting`:

```powershell
./scripts/migration/Invoke-FantazoneAzureMigration.ps1 `
  -GroupRepository 'KeyserDSoze/Fantazone.MyLeague' `
  -PlatformRepository 'KeyserDSoze/Fantazone' `
  -PreserveExisting `
  -RepairImportedCalendars
```

Review the dry-run report first. A path is allowed to bypass preservation only when the scanner has **proved** it is a repair candidate:

- the Azure/Rystem season key is valid and a zero payload/day year was normalized after date validation; or
- the current blob was invalid and a valid older Azure blob version was recovered.

Every other GitHub collision remains preserved. The report lists the exceptions under `repair.targetedPaths` and the writer result under `forcedOverwrites`.

Then apply the reviewed repair:

```powershell
./scripts/migration/Invoke-FantazoneAzureMigration.ps1 `
  -GroupRepository 'KeyserDSoze/Fantazone.MyLeague' `
  -PlatformRepository 'KeyserDSoze/Fantazone' `
  -PreserveExisting `
  -RepairImportedCalendars `
  -Apply
```

If a corrupted historical calendar has no valid Azure version, it appears in `source.issues` with its `targetPath` and **is not overwritten or fabricated**. That season needs a separate historical backfill/recovery source.

## Azure scan cache modes

Default cache path:

```text
migration-output/cache/azure-scan-v1.json
```

The cache contains inventory metadata and raw parsed contents for canonical containers. It never stores the Azure connection string, SAS, AccountKey or GitHub PATs. It can contain private Fantasoccer names/emails, so `migration-output/` remains gitignored and must stay private.

### Default: incremental sync

No cache switch is required. If a valid cache exists, it is used as a baseline while Azure metadata is enumerated. Unchanged blob bodies are reused; new/changed blobs are downloaded and the cache is replaced with the new snapshot.

Typical messages:

```text
[Cache] Incremental baseline loaded from ...\azure-scan-v1.json
[Cache] Azure metadata will be enumerated; unchanged blob bodies are reused and only new/changed blobs are downloaded.
```

### `-ReuseCache`

Use the existing cache **without contacting Azure at all**. This is useful when only migration code/mappers changed and you intentionally do not want to discover new source data:

```powershell
-ReuseCache
```

The command fails if no reusable cache exists.

### `-RefreshCache`

Ignore the cache and fully enumerate/download canonical Azure blobs again:

```powershell
-RefreshCache
```

Use this for a deliberate full source refresh or when you do not trust the cached metadata.

### `-NoCache`

Perform a full source scan without reading or writing the local cache:

```powershell
-NoCache
```

`-RefreshCache`, `-ReuseCache` and `-NoCache` are mutually exclusive.

A custom cache path can be selected with:

```powershell
-CachePath 'D:\private\fantazone-azure-scan.json'
```

## Resumable local staging

Every source record is converted independently into a Git-ready local tree. The default work directory for `KeyserDSoze/Fantazone.MyLeague` is:

```text
migration-output/
  work/
    KeyserDSoze_Fantazone.MyLeague/
      state.json
      progress.ndjson
      group-repo/
      platform-repo/
```

`progress.ndjson` is an append-only checkpoint keyed by exact Azure `container/blobName`. It records the source fingerprint and staged content fingerprint. A normal rerun resumes unchanged records immediately; a changed source blob invalidates only its own checkpoint and is reconverted.

If mapping fails, previous successful files/checkpoints are kept. Fix/pull the mapper and rerun. To deliberately rebuild all staging output while retaining the Azure cache:

```powershell
-ResetWork
```

A custom staging directory can be selected with:

```powershell
-WorkDir 'D:\private\fantazone-migration-work'
```

## Collision modes

- no switch: fail closed if any destination migration path already exists;
- `-PreserveExisting`: keep existing GitHub files and add only missing paths; recommended for recurring incremental imports;
- `-PreserveExisting -RepairImportedCalendars`: preserve every collision except proven `RealCalendar` repair candidates;
- `-Overwrite`: replace all existing canonical paths present in the migration plan.

`-Overwrite` and `-PreserveExisting` are mutually exclusive. `-RepairImportedCalendars` requires `-PreserveExisting`.

## Report

The report is written by default to:

```text
migration-output/azure-migration-<timestamp>.json
```

It contains:

- current Azure inventory (container/blob name, size, date and ETag when available);
- incremental source statistics: downloaded, reused and recovered-version counts;
- quarantined source issues and their target paths;
- historical Azure-version recoveries;
- cache mode/baseline information;
- staging/checkpoint paths and resume counts;
- selected legacy group;
- Azure blob → canonical GitHub path mappings;
- targeted calendar repair paths;
- GitHub collisions, forced repairs and planned/written counts.

It never contains the connection string or PAT values.

## Multiple groups

If repository-name auto-selection is ambiguous:

```powershell
-GroupId 'legacy-group-id'
```

## Empty repositories

An empty repository on its default branch is supported. A temporary bootstrap marker is used only to establish the first Git commit and is removed by the migration. An empty repository plus a custom non-default branch fails explicitly.

## Validation

Before applying a migration change locally:

```powershell
npm run test:migration
npm test
npm run typecheck
```

Recommended post-migration checks:

1. historical seasons are selectable;
2. Calendar and Ranking open for old seasons;
3. at least one season Team and immutable TeamDay are readable;
4. Hall of Fame is readable;
5. old Serie A players/teams/calendar and official/live votes are readable;
6. `source.issues` is reviewed, especially `invalid-realcalendar-season`;
7. `source.recoveries` is reviewed for any versioned calendar recovery;
8. `repair.targetedPaths` and `forcedOverwrites` are reviewed before applying a repair;
9. rerunning with `-PreserveExisting` produces mostly cache/staging reuse and no duplicate GitHub writes.

## Direct Node CLI

```powershell
node scripts/migration/migrate-azure-to-github.mjs `
  --group-repository 'KeyserDSoze/Fantazone.MyLeague' `
  --platform-repository 'KeyserDSoze/Fantazone' `
  --preserve-existing
```

Cache switches are `--refresh-cache`, `--reuse-cache`, `--no-cache` and `--cache <path>`. Staging switches are `--work-dir <path>` and `--reset-work`. Targeted repair is `--repair-imported-calendars` and requires `--preserve-existing`. Add `--apply` for writes. Use `--help` for the complete option list.
