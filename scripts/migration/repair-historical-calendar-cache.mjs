#!/usr/bin/env node
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { recoverHistoricalSerieACalendar } from './historical-calendar-source.mjs'
import { loadAzureScanCache, saveAzureScanCache } from './scan-cache.mjs'

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))

function parseArgs(argv) {
  const result = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => { if (++i >= argv.length) throw new Error(`${arg} requires a value`); return argv[i] }
    if (arg === '--cache') result.cachePath = next()
    else throw new Error(`Unknown argument '${arg}'`)
  }
  return result
}

function cachePath(value) {
  return value ? resolve(value) : resolve(REPO_ROOT, 'migration-output', 'cache', 'azure-scan-v1.json')
}

function sameCalendar(record, issue) {
  return record?.container === 'realcalendar' && Number(record?.key) === Number(issue?.key)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const connectionString = process.env.FANTAZONE_AZURE_CONNECTION_STRING
  if (!connectionString?.trim()) throw new Error('FANTAZONE_AZURE_CONNECTION_STRING is required')

  const target = cachePath(args.cachePath)
  const cached = await loadAzureScanCache(target, connectionString)
  if (cached.status !== 'hit') {
    console.log(`[Repair] Historical fallback preflight skipped: Azure cache is ${cached.status}.`)
    return
  }

  const scan = cached.scan
  const calendarIssues = (scan.issues ?? []).filter(issue => issue?.container === 'realcalendar' && Number.isInteger(Number(issue?.key)) && Number(issue.key) > 0)
  if (!calendarIssues.length) {
    console.log('[Repair] Historical fallback preflight: no unresolved RealCalendar issues in cache.')
    return
  }

  const records = [...(scan.records ?? [])]
  const issues = [...(scan.issues ?? [])]
  const recoveries = [...(scan.recoveries ?? [])]
  let repaired = 0

  for (const issue of calendarIssues) {
    const season = Number(issue.key)
    console.log(`[Repair] RealCalendar ${season} has no valid Azure history; checking verified historical Serie A ${season} fallback...`)
    const historical = await recoverHistoricalSerieACalendar(season)
    if (!historical.record) {
      console.warn(`[Repair] Historical fallback unavailable for season ${season}: ${historical.error ?? 'unknown error'}`)
      continue
    }

    const recordIndex = records.findIndex(record => sameCalendar(record, issue))
    if (recordIndex >= 0) records[recordIndex] = historical.record
    else records.push(historical.record)

    const issueIndex = issues.findIndex(candidate => candidate === issue || (
      candidate?.container === 'realcalendar' && Number(candidate?.key) === season
    ))
    if (issueIndex >= 0) issues.splice(issueIndex, 1)

    recoveries.push({
      container: 'realcalendar',
      blobName: String(season),
      key: season,
      sourceKind: 'historical-openfootball',
      sourceUrl: historical.url,
      reason: issue.detail ?? issue.reason ?? 'Azure RealCalendar was unrecoverable.',
    })
    repaired += 1
    console.log(`[Repair] RealCalendar ${season} recovered from ${historical.url}`)
  }

  if (!repaired) {
    console.log('[Repair] Historical fallback preflight completed without cache changes.')
    return
  }

  const stats = {
    ...(scan.stats ?? {}),
    recoveredHistoricalSourceCount: Number(scan.stats?.recoveredHistoricalSourceCount ?? 0) + repaired,
  }
  await saveAzureScanCache(target, connectionString, { ...scan, records, issues, recoveries, stats })
  console.log(`[Repair] Historical fallback preflight updated ${repaired} RealCalendar record(s) in ${target}`)
}

main().catch(error => {
  console.error(`[Repair] Historical fallback preflight failed: ${error.message}`)
  process.exitCode = 1
})
