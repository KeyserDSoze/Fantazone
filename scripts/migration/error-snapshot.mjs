import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const SNAPSHOT_VERSION = 1
const SNAPSHOT_FILE = 'last-error.json'

function recordId(record) {
  return `${String(record?.container ?? '').toLowerCase()}/${String(record?.blobName ?? '')}`
}

function pathSegment(value) {
  return encodeURIComponent(String(value ?? '').trim())
}

function positiveInteger(value) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

function structuredKey(record) {
  const key = record?.key
  return key && typeof key === 'object' && !Array.isArray(key) ? key : null
}

/** Best-effort destination derived only from the Rystem key. It never parses the legacy value. */
export function diagnosticDestination(record) {
  if (!record) return null
  const container = String(record.container ?? '').toLowerCase()
  const key = structuredKey(record)

  if (container === 'group') return { target: 'group', path: 'config/group.json' }

  if (container === 'calendar' && key) {
    return { target: 'group', path: `data/groups/seasons/${key.y}/leagues/${pathSegment(key.l)}/calendar.json` }
  }
  if (container === 'rank' && key) {
    return { target: 'group', path: `data/groups/seasons/${key.y}/leagues/${pathSegment(key.l)}/ranking.json` }
  }
  if (container === 'dailyrank' && key) {
    return { target: 'group', path: `data/groups/seasons/${key.y}/leagues/${pathSegment(key.l)}/days/${key.d}/ranking.json` }
  }
  if (container === 'team' && key) {
    return { target: 'group', path: `data/groups/seasons/${key.y}/teams/${pathSegment(key.b)}/${String(key.e ?? '').trim()}.json` }
  }
  if (container === 'dailyteams' && key) {
    return { target: 'group', path: `data/groups/seasons/${key.y}/days/${key.d}/teams/${pathSegment(key.b)}/${String(key.e ?? '').trim()}.json` }
  }
  if (container === 'halloffame' && key) {
    return { target: 'group', path: `data/groups/leagues/${pathSegment(key.l)}/hall-of-fame.json` }
  }

  const year = positiveInteger(record.key)
  if (container === 'realcalendar' && year) return { target: 'platform', path: `data/serie-a/calendars/${year}.json` }
  if (container === 'realteamwrapper' && year) return { target: 'platform', path: `data/serie-a/teams/${year}.json` }
  if (container === 'realplayerswrapper' && year) return { target: 'platform', path: `data/serie-a/players/${year}.json` }
  if (container === 'statplayerswrapper' && year) return { target: 'platform', path: `data/serie-a/stats/${year}.json` }

  if ((container === 'official' || container === 'live') && key) {
    return { target: 'platform', path: `data/serie-a/votes/${container}/${key.y}/${key.d}.json` }
  }
  if (container === 'chancedrealplayerwrapper' && key) {
    return { target: 'platform', path: `data/serie-a/chances/${key.y}/${key.d}.json` }
  }
  return null
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')) }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error }
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await rm(path, { force: true }).catch(() => {})
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true }).catch(() => {})
  }
}

export function migrationErrorSnapshotPath(workDir) {
  return resolve(workDir, SNAPSHOT_FILE)
}

export async function writeMigrationErrorSnapshot({ workDir, records, args, error }) {
  const statePath = resolve(workDir, 'state.json')
  const state = await readJson(statePath)
  const currentRecordId = state?.currentRecord ?? null
  const record = currentRecordId
    ? records.find(candidate => recordId(candidate) === currentRecordId) ?? null
    : null
  const destination = diagnosticDestination(record)
  const generatedAt = new Date().toISOString()
  const target = migrationErrorSnapshotPath(workDir)

  const snapshot = {
    version: SNAPSHOT_VERSION,
    generatedAt,
    error: {
      name: error?.name ?? 'Error',
      message: error?.message ?? String(error),
    },
    progress: state ? {
      status: state.status ?? null,
      totalRecords: state.totalRecords ?? null,
      processedRecords: state.processedRecords ?? null,
      convertedRecords: state.convertedRecords ?? null,
      skippedRecords: state.skippedRecords ?? null,
      resumedRecords: state.resumedRecords ?? null,
      groupFiles: state.groupFiles ?? null,
      platformFiles: state.platformFiles ?? null,
    } : null,
    migration: {
      groupRepository: args.groupRepository,
      platformRepository: args.platformRepository,
      branch: args.branch ?? 'main',
      selectedGroupId: state?.identity?.selectedGroupId ?? args.groupId ?? null,
    },
    source: record ? {
      recordId: currentRecordId,
      container: record.container,
      blobName: record.blobName,
      sourcePath: `${record.container}/${record.blobName}`,
      key: record.key ?? null,
      value: record.value ?? null,
    } : {
      recordId: currentRecordId,
      container: null,
      blobName: null,
      sourcePath: null,
      key: null,
      value: null,
    },
    destination,
    privacy: 'This file contains one legacy record and may contain personal data. It does not include GitHub PATs or the Azure connection string.',
  }

  await writeJsonAtomic(target, snapshot)
  return target
}

export async function clearMigrationErrorSnapshot(workDir) {
  await rm(migrationErrorSnapshotPath(workDir), { force: true })
}
