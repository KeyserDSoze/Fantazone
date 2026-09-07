#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanAzureStorage } from './azure-source.mjs'
import { azureSourceFingerprint, loadAzureScanCache, saveAzureScanCache } from './scan-cache.mjs'
import { GitHubApi, writeFilesAtomically } from './github-writer.mjs'
import { markStagingGitResult, stageMigrationRecords } from './staging.mjs'

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))

function parseArgs(argv) {
  const result = {
    platformRepository: 'KeyserDSoze/Fantazone', branch: 'main', apply: false,
    overwrite: false, preserveExisting: false, refreshCache: false, noCache: false, resetWork: false,
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
`  --refresh-cache                   Ignore existing cache and scan Azure again\n` +
`  --no-cache                        Do not read or write the local Azure scan cache\n` +
`  --reset-work                      Delete and rebuild local staging/checkpoint state\n` +
`  --apply                           Perform GitHub writes (default is dry-run)\n` +
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
    console.log(`[Azure] Container #${event.containerNumber}: ${event.container} - ${event.download ? 'canonical, reading content' : 'inventory only'}`)
    return
  }
  if (event.type === 'container-progress') {
    const downloaded = event.download ? `, downloaded=${event.downloadedCount} (${formatBytes(event.downloadedBytes)})` : ''
    console.log(`[Azure] ${event.container}: enumerated=${event.blobCount}${downloaded}, elapsed=${formatElapsed(event.elapsedMs)}, current=${event.currentBlob}`)
    return
  }
  if (event.type === 'container-complete') {
    const downloaded = event.download ? `, downloaded=${event.downloadedCount} (${formatBytes(event.downloadedBytes)})` : ''
    console.log(`[Azure] ${event.container}: complete - blobs=${event.blobCount}${downloaded}, elapsed=${formatElapsed(event.elapsedMs)}`)
    return
  }
  if (event.type === 'scan-complete') {
    console.log(`[Azure] Scan complete - containers=${event.containerCount}, blobs=${event.blobCount}, canonical records downloaded=${event.downloadedCount}`)
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

async function obtainAzureScan(connectionString, args) {
  const cachePath = scanCachePath(args.cachePath)
  const cacheInfo = { enabled: !args.noCache, path: args.noCache ? null : cachePath, used: false, createdAt: null }

  if (args.noCache) {
    console.log('[Cache] Disabled; Azure will be scanned for this run.')
  } else if (args.refreshCache) {
    console.log(`[Cache] Refresh requested; ignoring existing cache at ${cachePath}`)
  } else {
    const cached = await loadAzureScanCache(cachePath, connectionString)
    if (cached.status === 'hit') {
      cacheInfo.used = true
      cacheInfo.createdAt = cached.createdAt
      console.log(`[Cache] Reusing Azure scan from ${cachePath}${cached.createdAt ? ` (${cached.createdAt})` : ''}`)
      console.log(`[Cache] Cached scan contains containers=${cached.scan.inventory.length}, canonical records=${cached.scan.records.length}`)
      return { scan: cached.scan, cacheInfo }
    }
    const detail = cached.reason ? `: ${cached.reason}` : ''
    console.log(`[Cache] No reusable Azure scan (${cached.status}${detail}).`)
  }

  console.log('Scanning Azure Blob Storage metadata and canonical containers...')
  const scan = await scanAzureStorage(connectionString, { onProgress: logAzureProgress })

  if (!args.noCache) {
    const saved = await saveAzureScanCache(cachePath, connectionString, scan)
    if (saved.saved) {
      cacheInfo.createdAt = saved.createdAt
      console.log(`[Cache] Azure scan saved to ${cachePath}`)
      console.log('[Cache] If mapping fails, rerun after updating the mapper: the next run will reuse this scan.')
    } else {
      console.log(`[Cache] Scan was not cached: ${saved.reason}`)
    }
  }
  return { scan, cacheInfo }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) { console.log(usage()); return }
  if (!args.groupRepository) throw new Error('--group-repository is required')
  if (args.overwrite && args.preserveExisting) throw new Error('--overwrite and --preserve-existing are mutually exclusive')
  if (args.refreshCache && args.noCache) throw new Error('--refresh-cache and --no-cache are mutually exclusive')
  const mode = args.overwrite ? 'overwrite' : args.preserveExisting ? 'preserve' : 'fail'

  const connectionString = requireEnv('FANTAZONE_AZURE_CONNECTION_STRING')
  const groupPat = requireEnv('FANTAZONE_GROUP_PAT')
  const platformPat = requireEnv('FANTAZONE_PLATFORM_PAT')

  const { scan, cacheInfo } = await obtainAzureScan(connectionString, args)
  const workDir = workPath(args.workDir, args.groupRepository)
  const plan = await stageMigrationRecords(scan.records, {
    ...args,
    workDir,
    sourceFingerprint: azureSourceFingerprint(connectionString),
    onProgress: logStagingProgress,
  })

  console.log(`Selected legacy group: ${plan.group.id} (${plan.group.name})`)
  console.log(`Planned files: group=${plan.groupFiles.length}, platform=${plan.platformFiles.length}, skipped=${plan.skipped.length}`)

  const groupResult = await writeFilesAtomically({
    api: new GitHubApi(groupPat), repository: args.groupRepository, branch: args.branch, files: plan.groupFiles,
    message: 'feat: migrate legacy Fantasoccer data from Azure Blob Storage', mode, apply: args.apply,
  })
  const platformResult = await writeFilesAtomically({
    api: new GitHubApi(platformPat), repository: args.platformRepository, branch: args.branch, files: plan.platformFiles,
    message: 'feat: import legacy Serie A data from Azure Blob Storage', mode, apply: args.apply,
  })

  if (args.apply) await markStagingGitResult(workDir, { group: groupResult, platform: platformResult })

  const output = {
    generatedAt: new Date().toISOString(), mode: args.apply ? 'apply' : 'dry-run', collisionMode: mode,
    source: {
      cache: cacheInfo,
      staging: plan.staging,
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
