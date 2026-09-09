# Azure Blob → GitHub historical migration

This tool moves legacy Fantasoccer data from Azure Blob Storage into the readable Fantazone repositories. It is intentionally outside the app runtime: compact legacy JSON is decoded once and committed as the current canonical contracts.

The migration is **resumable and repeatable**. A normal rerun performs an incremental Azure sync: it enumerates blob metadata, reuses cached bodies for unchanged blobs, downloads only new or changed canonical blobs, resumes already-converted staging records, and with `-PreserveExisting` can add new paths or safely update a changed legacy path only when GitHub still matches the previous imported content.

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

Legacy Rystem stores the repository key separately from the compact value. That matters for `RealCalendar`: older Fantasoccer jobs could request the provider's next-season calendar before the internal August 10 season switch and overwrite the previous season's blob. Some historical payloads also omit `y` or contain `y = 0` even though their Azure/Rystem key is correct.

The migration therefore treats the **Azure/Rystem key as the canonical season id**. A missing or zero top-level/day `y` is repaired from that key, but every dated Serie A match must still fall inside the keyed season's August-10-to-August-10 window. This repairs absent metadata without disguising a calendar that was actually overwritten by another season.

If the current `realcalendar` blob explicitly declares another season, has dates outside the keyed season, or cannot be parsed, the scanner automatically checks Azure Blob **version history and snapshots**. Candidates are tried newest-first and accepted only when the same season/date validation succeeds. Snapshot enumeration is attempted with soft-deleted visibility when the Storage account permits it, then retried without deleted entries when that option is unavailable.

This can recover an overwritten historical calendar when either blob versioning or a suitable snapshot was retained. If no valid version or snapshot exists, Fantazone does **not** silently drop the calendar: the source is carried into staging as a deliberate fail-closed record, the migration stops, and `migration-output/work/<repo>/last-error.json` is written with the Azure/Rystem key, original parsed payload, expected destination and parser issue. If the Azure body is not valid JSON, the exact downloaded text is preserved under `source.rawText`.

Recovered calendars are listed under `source.recoveries` with their source kind (`version` or `snapshot`) and the corresponding Azure identifier.

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

## Recommended rerun: discover and safely synchronize legacy changes

For the common case "I have used the legacy app again and Azure now contains additional or modified blobs", run the **same migration again** with `-PreserveExisting`:

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
8. adds a path that is new in Azure and missing in GitHub;
9. for a changed Azure record whose GitHub path exists, compares the current GitHub content with the SHA-256 of the previous imported output;
10. updates the path automatically only when that comparison proves GitHub is still untouched; otherwise the path is preserved as a conflict.

After reviewing the report/staged trees, repeat with `-Apply`:

```powershell
./scripts/migration/Invoke-FantazoneAzureMigration.ps1 `
  -GroupRepository 'KeyserDSoze/Fantazone.MyLeague' `
  -PlatformRepository 'KeyserDSoze/Fantazone' `
  -PreserveExisting `
  -Apply
```

The resulting `-PreserveExisting` behavior is deliberately three-way:

- **new Azure blob → add** the missing canonical file;
- **changed Azure blob + GitHub still equals the previous import → safe update**;
- **changed Azure blob + GitHub has diverged → preserve GitHub and report a conflict**.

This means recurring imports can follow legitimate legacy changes without turning into a global overwrite. `-Overwrite` still exists for an intentional unconditional replacement of every colliding canonical path in the plan, but it should not be needed for normal incremental reruns.

## One-time repair of already-imported calendars

To repair bad `RealCalendar` files produced by an earlier migration without opening every existing path to overwrite, add `-RepairImportedCalendars` together with `-PreserveExisting`:

```powershell
./scripts/migration/Invoke-FantazoneAzureMigration.ps1 `
  -GroupRepository 'KeyserDSoze/Fantazone.MyLeague' `
  -PlatformRepository 'KeyserDSoze/Fantazone' `
  -PreserveExisting `
  -RepairImportedCalendars
```

Review the dry-run report first. A path is allowed to bypass preservation only when the scanner has **proved** it is a repair candidate:

- the Azure/Rystem season key is valid and a missing/zero payload/day year was normalized after date validation; or
- the current blob was invalid and a valid older Azure blob version or snapshot was recovered.

Every other GitHub collision follows normal preserve semantics. The report lists explicit repair exceptions under `repair.targetedPaths` and the writer result under `forcedOverwrites`.

Then apply the reviewed repair:

```powershell
./scripts/migration/Invoke-FantazoneAzureMigration.ps1 `
  -GroupRepository 'KeyserDSoze/Fantazone.MyLeague' `
  -PlatformRepository 'KeyserDSoze/Fantazone' `
  -PreserveExisting `
  -RepairImportedCalendars `
  -Apply
```

If a corrupted historical calendar has no valid Azure version or snapshot, the migration stops before GitHub write and `last-error.json` identifies that exact calendar. Fix/recover that source (or the mapper), then rerun without deleting the work directory.

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

## Resumable local staging and update provenance

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

For changed records, the journal also retains the SHA-256 of the **previous imported canonical content**. This is the proof used by `-PreserveExisting` to decide whether an existing GitHub file is safe to update. The replay logic can reconstruct that predecessor hash from existing 0.3.1 append-only journals, so migration work directories created before 0.3.2 continue to work without a reset.

Keep the work directory if you want provenance-aware safe updates across reruns. `-ResetWork` deliberately discards the local conversion history; after a reset, `-PreserveExisting` remains conservative for pre-existing paths because it can no longer prove which GitHub content came from the prior import.

If mapping fails, previous successful files/checkpoints are kept. `last-error.json` records the current source record, key/value, diagnostic destination and error. Fix/pull the mapper or recover the bad source, then rerun. To deliberately rebuild all staging output while retaining the Azure cache:

```powershell
-ResetWork
```

A custom staging directory can be selected with:

```powershell
-WorkDir 'D:\private\fantazone-migration-work'
```

## Collision modes

- no switch: fail closed if any destination migration path already exists;
- `-PreserveExisting`: add missing paths, safely update a changed source only when GitHub still matches the previous import, and preserve diverged collisions; recommended for recurring incremental imports;
- `-PreserveExisting -RepairImportedCalendars`: same safe behavior plus explicit overwrite of proven `RealCalendar` repair candidates;
- `-Overwrite`: replace all existing canonical paths present in the migration plan.

`-Overwrite` and `-PreserveExisting` are mutually exclusive. `-RepairImportedCalendars` requires `-PreserveExisting`.

## Report and last-error diagnostics

A successful dry-run/apply report is written by default to:

```text
migration-output/azure-migration-<timestamp>.json
```

It contains:

- current Azure inventory (container/blob name, size, date and ETag when available);
- incremental source statistics: downloaded, reused and recovered-history counts;
- historical Azure version/snapshot recoveries;
- cache mode/baseline information;
- staging/checkpoint paths and resume counts;
- selected legacy group;
- Azure blob → canonical GitHub path mappings;
- targeted calendar repair paths;
- GitHub collisions, safe updates, preserved conflicts, forced repairs and planned/written counts.

When staging fails, the authoritative diagnostic is:

```text
migration-output/work/<repository>/last-error.json
```

For a RealCalendar failure it contains the source `container`, `blobName`, Azure/Rystem `key`, original parsed `value`, parser `issue`, expected destination and, when JSON parsing itself failed, `rawText`.

Neither report contains the Azure connection string or GitHub PAT values.

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
6. `source.recoveries` is reviewed for any version/snapshot calendar recovery;
7. if migration fails, inspect `last-error.json` before resetting any work/cache state;
8. `repair.targetedPaths`, `safeUpdates`, `preservedCollisions` and `forcedOverwrites` are reviewed before applying changes;
9. rerunning with `-PreserveExisting` produces mostly cache/staging reuse and no duplicate GitHub writes.
