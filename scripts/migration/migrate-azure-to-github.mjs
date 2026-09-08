#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanAzureStorage } from './azure-source.mjs'
import { azureSourceFingerprint, loadAzureScanCache, saveAzureScanCache } from './scan-cache.mjs'
import { clearMigrationErrorSnapshot, writeMigrationErrorSnapshot } from './error-snapshot.mjs'
import { GitHubApi, writeFilesAtomically } from './github-writer.mjs'
import { writeFilesWithGit } from './git-writer.mjs'
import { markStagingGitResult, stageMigrationRecords } from './staging.mjs'

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))

function parseArgs(argv) {
  const result = {
    platformRepository: 'KeyserDSoze/Fantazone', branch: 'main', apply: false,
    overwrite: false, preserveExisting: false, refreshCache: false, reuseCache: false, noCache: false, resetWork: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => { if (++i >= argv.length) throw new Error(`${arg} requires a value`); return argv[i] }
    if (arg === '--group-repository') result.groupRepository = next()
    else if (arg === '--platform-repository') result.platformRepository = next()
    else if (arg === '--branch') result.branch = next()
    else if (arg === '--group-id') result.groupId = next()
    else if (arg === '--report') result.reportPath = next()
    else if (arg === '--cache') result.cachePath = next()
    else if (arg === '--work-dir') result.workDir = next()
    else if (arg === '--refresh-cache') result.refreshCache = true
    else if (arg === '--reuse-cache') result.reuseCache = true
    else if (arg === '--no-cache') result.noCache = true
    else if (arg === '--reset-work') result.resetWork = true
    else if (arg === '--apply') result.apply = true
    else if (arg === '--overwrite') result.overwrite = true
    else if (arg === '--preserve-existing') result.preserveExisting = true
    else if (arg === '--help' || arg === '-h') result.help = true
    else throw new Error(`Unknown argument '${arg}'`)
  }
  return result
}

function usage() {
  return `Fantazone Azure Blob -> GitHub migration\n\n` +
`Secrets are read only from environment variables:\n` +
`  FANTAZONE_AZURE_CONNECTION_STRING\n  FANTAZONE_GROUP_PAT\n  FANTAZONE_PLATFORM_PAT\n\n` +
`Usage:\n  node scripts/migration/migrate-azure-to-github.mjs --group-repository owner/Fantazone.Group [options]\n\n` +
`Options:\n  --platform-repository owner/repo   Shared Serie A repository (default KeyserDSoze/Fantazone)\n` +
`  --branch branch                   Target branch (default main)\n  --group-id id                     Explicit legacy group id when auto-selection is ambiguous\n` +
`  --report path                     JSON report path\n  --cache path                      Azure scan cache path\n` +
`  --work-dir path                   Local resumable staging directory\n` +
`  --refresh-cache                   Ignore cache and download every canonical Azure blob again\n` +
`  --reuse-cache                     Use the existing cache without contacting Azure\n` +
`  --no-cache                        Do not read or write the local Azure scan cache\n` +
`  --reset-work                      Delete and rebuild local staging/checkpoint state\n` +
`  --apply                           Commit staged trees and git push them to the target branch\n` +
`  --overwrite                       Replace canonical paths that already exist\n  --preserve-existing               Keep existing canonical paths and skip collisions\n` +
`  -h, --help                        Show this help\n`
}

function requireEnv(name) { const value = process.env[name]; if (!value?.trim()) throw new Error(`${name} is required`); return value }
function reportPath(value) {
  if (value) return resolve(value)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return resolve(REPO_ROOT, 'migration-output', `azure-migration-${stamp}.json`)
}
function scanCachePath(value) {
  return value ? resolve(value) : resolve(REPO_ROOT, 'migration-output', 'cache', 'azure-scan-v1.json')
}
function workPath(value, groupRepository) {
  if (value) return resolve(value)
  const safe = String(groupRepository).replace(/[^a-z0-9._-]+/gi, '_')
  return resolve(REPO_ROOT, 'migration-output', 'work', safe)
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KiB', 'MiB', 'GiB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1 }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

function formatElapsed(ms) {
  if (!Number.isFinite(ms) || ms < 1000) return `${Math.max(0, Math.round(ms ?? 0))} ms`
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function logAzureProgress(event) {
  if (event.type === 'container-start') {
    console.log(`[Azure] Container #${event.containerNumber}: ${event.container} - ${event.download ? 'canonical, syncing content' : 'inventory only'}`)
    return
  }
  if (event.type === 'container-progress') {
    const synced = event.download
      ? `, downloaded=${event.downloadedCount} (${formatBytes(event.downloadedBytes)}), reused=${event.reusedCount ?? 0}, recovered=${event.recoveredCount ?? 0}`
      : ''
    console.log(`[Azure] ${event.container}: enumerated=${event.blobCount}${synced}, elapsed=${formatElapsed(event.elapsedMs)}, current=${event.currentBlob}`)
    return
  }
  if (event.type === 'container-complete') {
    const synced = event.download
      ? `, downloaded=${event.downloadedCount} (${formatBytes(event.downloadedBytes)}), reused=${event.reusedCount ?? 0}, recovered=${event.recoveredCount ?? 0}`
      : ''
    console.log(`[Azure] ${event.container}: complete - blobs=${event.blobCount}${synced}, elapsed=${formatElapsed(event.elapsedMs)}`)
    return
  }
  if (event.type === 'scan-complete') {
    console.log(`[Azure] Scan complete - containers=${event.containerCount}, blobs=${event.blobCount}, canonical=${event.canonicalRecordCount}, downloaded=${event.downloadedCount}, reused=${event.reusedCount}, recovered=${event.recoveredVersionCount}, issues=${event.issueCount}`)
  }
}

function logStagingProgress(event) {
  if (event.type === 'workspace') {
    console.log(`[Stage] Work directory: ${event.workDir}`)
    console.log(`[Stage] Checkpoint found: completed=${event.completed}, skipped=${event.skipped}, total source records=${event.total}`)
    return
  }
  if (event.type === 'progress') {
    console.log(`[Stage] processed=${event.processed}/${event.total}, converted-now=${event.convertedThisRun}, resumed=${event.resumed}, group-files=${event.groupFiles}, platform-files=${event.platformFiles}, current=${event.recordId}`)
    return
  }
  if (event.type === 'failed') {
    console.log(`[Stage] Stopped at ${event.recordId}. Earlier staged files and checkpoint are preserved; rerun after the mapper is fixed.`)
    return
  }
  if (event.type === 'complete') {
    console.log(`[Stage] Ready - group-files=${event.groupFiles}, platform-files=${event.platformFiles}, converted-now=${event.convertedThisRun}, resumed=${event.resumed}`)
    console.log(`[Stage] Group tree: ${event.groupTree}`)
    console.log(`[Stage] Platform tree: ${event.platformTree}`)
    console.log(`[Stage] State: ${event.statePath}`)
  }
}

function logGitProgress(event) {
  if (event.type === 'clone') {
    console.log(`[Git] ${event.repository}: cloning target branch '${event.branch}' into isolated transport workspace...`)
    return
  }
  if (event.type === 'selection') {
    console.log(`[Git] ${event.repository}: staged=${event.total}, selected=${event.selected}, preserved-collisions=${event.collisions}`)
    return
  }
  if (event.type === 'commit') {
    console.log(`[Git] ${event.repository}: creating one commit with ${event.changed} changed files...`)
    return
  }
  if (event.type === 'push') {
    console.log(`[Git] ${event.repository}: pushing commit ${event.commit} to ${event.branch} (non-force)...`)
    return
  }
  if (event.type === 'complete') {
    console.log(`[Git] ${event.repository}: complete - written=${event.written}${event.commit ? `, commit=${event.commit}` : ', no new commit required'}`)
  }
}

async function obtainAzureScan(connectionString, args) {
  const cachePath = scanCachePath(args.cachePath)
  const cacheInfo = {
    enabled: !args.noCache,
    path: args.noCache ? null : cachePath,
    used: false,
    mode: args.noCache ? 'disabled' : args.refreshCache ? 'refresh' : args.reuseCache ? 'reuse' : 'incremental',
    createdAt: null,
    baselineCreatedAt: null,
  }
  let previousScan = null

  if (args.noCache) {
    console.log('[Cache] Disabled; Azure will be fully scanned for this run.')
  } else if (args.refreshCache) {
    console.log(`[Cache] Full refresh requested; ignoring existing cache at ${cachePath}`)
  } else {
    const cached = await loadAzureScanCache(cachePath, connectionString)
    if (cached.status === 'hit') {
      cacheInfo.used = true
      cacheInfo.createdAt = cached.createdAt
      cacheInfo.baselineCreatedAt = cached.createdAt
      if (args.reuseCache) {
        console.log(`[Cache] Reusing Azure scan without contacting Azure: ${cachePath}${cached.createdAt ? ` (${cached.createdAt})` : ''}`)
        console.log(`[Cache] Cached scan contains containers=${cached.scan.inventory.length}, canonical records=${cached.scan.records.length}`)
        return { scan: cached.scan, cacheInfo }
      }
      previousScan = cached.scan
      console.log(`[Cache] Incremental baseline loaded from ${cachePath}${cached.createdAt ? ` (${cached.createdAt})` : ''}`)
      console.log('[Cache] Azure metadata will be enumerated; unchanged blob bodies are reused and only new/changed blobs are downloaded.')
    } else {
      const detail = cached.reason ? `: ${cached.reason}` : ''
      if (args.reuseCache) throw new Error(`--reuse-cache requires a reusable Azure cache (${cached.status}${detail})`)
      console.log(`[Cache] No reusable Azure scan (${cached.status}${detail}).`)
    }
  }

  console.log(previousScan ? 'Synchronizing Azure Blob Storage incrementally...' : 'Scanning Azure Blob Storage metadata and canonical containers...')
  const scan = await scanAzureStorage(connectionString, { onProgress: logAzureProgress, previousScan })

  if (scan.recoveries?.length) {
    console.log(`[Azure] Recovered ${scan.recoveries.length} historical RealCalendar blob(s) from Azure version history.`)
    for (const recovery of scan.recoveries.slice(0, 10)) {
      console.log(`[Azure] Recovered ${recovery.container}/${recovery.blobName} from version ${recovery.versionId}${recovery.lastModified ? ` (${recovery.lastModified})` : ''}`)
    }
  }
  if (scan.issues?.length) {
    console.warn(`[Azure] ${scan.issues.length} source record(s) were quarantined and will not be migrated.`)
    for (const issue of scan.issues.slice(0, 10)) console.warn(`[Azure] ${issue.container}/${issue.blobName}: ${issue.detail ?? issue.reason}`)
  }

  if (!args.noCache) {
    const saved = await saveAzureScanCache(cachePath, connectionString, scan)
    if (saved.saved) {
      cacheInfo.createdAt = saved.createdAt
      console.log(`[Cache] Azure scan saved to ${cachePath}`)
      console.log('[Cache] Normal reruns now sync Azure incrementally; use --reuse-cache only when you intentionally want zero Azure reads.')
    } else {
      console.log(`[Cache] Scan was not cached: ${saved.reason}`)
    }
  }
  return { scan, cacheInfo }
}

async function dryRunTarget(pat, repository, branch, files, message, mode) {
  return writeFilesAtomically({
    api: new GitHubApi(pat), repository, branch, files, message, mode, apply: false,
  })
}

async function applyTargetWithGit(pat, repository, branch, files, message, mode, gitRoot) {
  return writeFilesWithGit({
    pat, repository, branch, files, message, mode, gitRoot, onProgress: logGitProgress,
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) { console.log(usage()); return }
  if (!args.groupRepository) throw new Error('--group-repository is required')
  if (args.overwrite && args.preserveExisting) throw new Error('--overwrite and --preserve-existing are mutually exclusive')
  if ([args.refreshCache, args.reuseCache, args.noCache].filter(Boolean).length > 1) {
    throw new Error('--refresh-cache, --reuse-cache and --no-cache are mutually exclusive')
  }
  const mode = args.overwrite ? 'overwrite' : args.preserveExisting ? 'preserve' : 'fail'

  const connectionString = requireEnv('FANTAZONE_AZURE_CONNECTION_STRING')
  const groupPat = requireEnv('FANTAZONE_GROUP_PAT')
  const platformPat = requireEnv('FANTAZONE_PLATFORM_PAT')

  const { scan, cacheInfo } = await obtainAzureScan(connectionString, args)
  const workDir = workPath(args.workDir, args.groupRepository)
  let plan
  try {
    plan = await stageMigrationRecords(scan.records, {
      ...args,
      workDir,
      sourceFingerprint: azureSourceFingerprint(connectionString),
      onProgress: logStagingProgress,
    })
  } catch (error) {
    try {
      const snapshotPath = await writeMigrationErrorSnapshot({ workDir, records: scan.records, args, error })
      console.error(`[Stage] Error snapshot: ${snapshotPath}`)
    } catch (snapshotError) {
      console.error(`[Stage] Could not write last-error.json: ${snapshotError.message}`)
    }
    throw error
  }
  await clearMigrationErrorSnapshot(workDir).catch(() => {})

  console.log(`Selected legacy group: ${plan.group.id} (${plan.group.name})`)
  console.log(`Planned files: group=${plan.groupFiles.length}, platform=${plan.platformFiles.length}, skipped=${plan.skipped.length}`)

  const groupMessage = 'feat: migrate legacy Fantasoccer data from Azure Blob Storage'
  const platformMessage = 'feat: import legacy Serie A data from Azure Blob Storage'
  let groupResult, platformResult

  if (args.apply) {
    const gitRoot = resolve(workDir, 'git-targets')
    console.log('[Git] Apply mode uses native git clone/commit/push; staged JSON files are not uploaded one-by-one through the GitHub REST API.')
    groupResult = await applyTargetWithGit(groupPat, args.groupRepository, args.branch, plan.groupFiles, groupMessage, mode, gitRoot)
    platformResult = await applyTargetWithGit(platformPat, args.platformRepository, args.branch, plan.platformFiles, platformMessage, mode, gitRoot)
    await markStagingGitResult(workDir, { group: groupResult, platform: platformResult })
  } else {
    groupResult = await dryRunTarget(groupPat, args.groupRepository, args.branch, plan.groupFiles, groupMessage, mode)
    platformResult = await dryRunTarget(platformPat, args.platformRepository, args.branch, plan.platformFiles, platformMessage, mode)
  }

  const output = {
    generatedAt: new Date().toISOString(), mode: args.apply ? 'apply' : 'dry-run', collisionMode: mode,
    transport: args.apply ? 'native-git' : 'github-api-inspection',
    source: {
      cache: cacheInfo,
      staging: plan.staging,
      stats: scan.stats ?? null,
      issues: scan.issues ?? [],
      recoveries: scan.recoveries ?? [],
      containers: scan.inventory.map(container => ({ name: container.name, downloaded: container.downloaded, blobCount: container.blobs.length, blobs: container.blobs })),
    },
    selectedGroup: { id: plan.group.id, name: plan.group.name },
    targets: { group: groupResult, platform: platformResult },
    files: { group: plan.groupFiles.map(x => ({ path: x.path, source: x.source })), platform: plan.platformFiles.map(x => ({ path: x.path, source: x.source })) },
    skipped: plan.skipped,
  }
  const target = reportPath(args.reportPath)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  console.log(`${args.apply ? 'Migration' : 'Dry-run'} completed. Report: ${target}`)
  if (!args.apply) console.log('No GitHub content was modified. Re-run with --apply after reviewing the staged trees and report.')
}

main().catch(error => { console.error(`Migration failed: ${error.message}`); process.exitCode = 1 })
