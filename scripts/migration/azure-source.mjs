import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob'
import { shouldDownloadContainer } from './migration-plan.mjs'
import { unwrapRystemEntity } from './legacy-mappers.mjs'
import { normalizeLegacyRealCalendarRecord } from './real-calendar-source.mjs'

const PROGRESS_BLOB_INTERVAL = 100
const PROGRESS_TIME_INTERVAL_MS = 5_000
const PRIMITIVE_KEY_CONTAINERS = new Set(['realcalendar', 'realteamwrapper', 'realplayerswrapper', 'statplayerswrapper'])

function parseConnectionString(connectionString) {
  const parts = new Map()
  for (const token of String(connectionString).split(';')) {
    if (!token.trim()) continue
    const index = token.indexOf('=')
    if (index < 1) continue
    parts.set(token.slice(0, index).trim().toLowerCase(), token.slice(index + 1).trim())
  }
  return parts
}

export function createBlobServiceClient(connectionString) {
  if (!connectionString?.trim()) throw new Error('Azure Storage connection string is required')
  const parts = parseConnectionString(connectionString)
  if (norm(parts.get('usedevelopmentstorage')) === 'true') return BlobServiceClient.fromConnectionString(connectionString)

  const endpoint = parts.get('blobendpoint')
  const sas = parts.get('sharedaccesssignature')
  const accountName = parts.get('accountname')
  const accountKey = parts.get('accountkey')

  if (endpoint && sas) return new BlobServiceClient(`${endpoint.replace(/\/$/, '')}?${sas.replace(/^\?/, '')}`)
  if (accountKey && !accountName) throw new Error('AccountName is required when the Azure connection string uses SharedKey/AccountKey')
  if (endpoint && accountKey) return new BlobServiceClient(endpoint, new StorageSharedKeyCredential(accountName, accountKey))
  return BlobServiceClient.fromConnectionString(connectionString)
}
function norm(value) { return String(value ?? '').trim().toLowerCase() }

async function streamToString(readable) {
  const chunks = []
  for await (const chunk of readable) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

function blobMetadata(blob) {
  return {
    name: blob.name,
    size: blob.properties.contentLength ?? null,
    lastModified: blob.properties.lastModified?.toISOString?.() ?? null,
    etag: blob.properties.etag ?? null,
  }
}

function recordId(container, blobName) {
  return `${norm(container)}/${blobName}`
}

function previousScanIndexes(previousScan) {
  const blobs = new Map()
  const records = new Map()
  for (const container of previousScan?.inventory ?? []) {
    for (const blob of container?.blobs ?? []) blobs.set(recordId(container.name, blob.name), blob)
  }
  for (const record of previousScan?.records ?? []) records.set(recordId(record.container, record.blobName), record)
  return { blobs, records }
}

function sameBlob(previous, current) {
  if (!previous || !current) return false
  if (previous.etag && current.etag) return previous.etag === current.etag
  return previous.lastModified != null && current.lastModified != null &&
    previous.lastModified === current.lastModified && previous.size === current.size
}

function recordFromText(container, blobName, text) {
  const entity = unwrapRystemEntity(text, `${container}/${blobName}`)
  if (!entity.enveloped && entity.key == null && PRIMITIVE_KEY_CONTAINERS.has(container)) {
    entity.key = Number.parseInt(blobName, 10)
  }
  return { container, blobName, key: entity.key, value: entity.value }
}

function normalizeCanonicalRecord(record) {
  if (record.container !== 'realcalendar') return { ok: true, record }
  return normalizeLegacyRealCalendarRecord(record)
}

async function downloadText(blobClient) {
  const response = await blobClient.download()
  const text = await streamToString(response.readableStreamBody)
  return { text, bytes: Buffer.byteLength(text) }
}

function historyTimestamp(item) {
  return item.properties?.lastModified?.getTime?.() ?? 0
}

async function collectCalendarHistory(containerClient, blobName) {
  const candidates = []
  const seen = new Set()
  const add = (kind, id, item) => {
    if (!id) return
    const key = `${kind}:${id}`
    if (seen.has(key)) return
    seen.add(key)
    candidates.push({ kind, id, item })
  }

  try {
    for await (const item of containerClient.listBlobsFlat({ prefix: blobName, includeVersions: true })) {
      if (item.name === blobName && item.versionId) add('version', item.versionId, item)
    }
  } catch {
    // Version history is best-effort; snapshot recovery below may still be available.
  }

  const collectSnapshots = async includeDeleted => {
    for await (const item of containerClient.listBlobsFlat({ prefix: blobName, includeSnapshots: true, ...(includeDeleted ? { includeDeleted: true } : {}) })) {
      if (item.name === blobName && item.snapshot) add('snapshot', item.snapshot, item)
    }
  }
  try {
    await collectSnapshots(true)
  } catch {
    try { await collectSnapshots(false) } catch { /* Snapshot history is optional/best-effort. */ }
  }

  candidates.sort((left, right) => historyTimestamp(right.item) - historyTimestamp(left.item))
  return candidates
}

async function recoverRealCalendarHistory(containerClient, blobName, expectedSeason) {
  const candidates = await collectCalendarHistory(containerClient, blobName)
  let downloadedCount = 0
  let downloadedBytes = 0
  const baseClient = containerClient.getBlobClient(blobName)

  for (const candidate of candidates) {
    let historicalClient = null
    if (candidate.kind === 'version' && typeof baseClient.withVersion === 'function') historicalClient = baseClient.withVersion(candidate.id)
    if (candidate.kind === 'snapshot' && typeof baseClient.withSnapshot === 'function') historicalClient = baseClient.withSnapshot(candidate.id)
    if (!historicalClient) continue

    let downloaded
    try { downloaded = await downloadText(historicalClient) }
    catch { continue }
    downloadedCount += 1
    downloadedBytes += downloaded.bytes

    let parsed
    try { parsed = recordFromText('realcalendar', blobName, downloaded.text) }
    catch { continue }
    parsed.key = expectedSeason
    const normalized = normalizeLegacyRealCalendarRecord(parsed)
    if (!normalized.ok) continue

    const sourceMetadata = candidate.kind === 'version'
      ? { sourceVersionId: candidate.id }
      : { sourceSnapshot: candidate.id }
    return {
      record: { ...normalized.record, migrationRepair: true, ...sourceMetadata },
      sourceKind: candidate.kind,
      versionId: candidate.kind === 'version' ? candidate.id : null,
      snapshot: candidate.kind === 'snapshot' ? candidate.id : null,
      lastModified: candidate.item.properties?.lastModified?.toISOString?.() ?? null,
      downloadedCount,
      downloadedBytes,
    }
  }

  return { record: null, sourceKind: null, versionId: null, snapshot: null, downloadedCount, downloadedBytes }
}

export async function scanAzureStorage(connectionString, options = {}) {
  const client = options.client ?? createBlobServiceClient(connectionString)
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {}
  const previous = previousScanIndexes(options.previousScan)
  const inventory = []
  const records = []
  const issues = []
  const recoveries = []
  let containerNumber = 0
  let totalDownloadedCount = 0
  let totalDownloadedBytes = 0
  let totalReusedCount = 0
  let totalRecoveredCount = 0
  let totalRecoveredVersionCount = 0
  let totalRecoveredSnapshotCount = 0

  for await (const container of client.listContainers()) {
    containerNumber += 1
    const name = container.name.toLowerCase()
    const containerClient = client.getContainerClient(container.name)
    const download = shouldDownloadContainer(name)
    const item = { name, blobs: [], downloaded: download }
    inventory.push(item)

    let blobCount = 0
    let downloadedCount = 0
    let downloadedBytes = 0
    let reusedCount = 0
    let recoveredCount = 0
    let recoveredVersionCount = 0
    let recoveredSnapshotCount = 0
    let lastProgressAt = Date.now()
    const startedAt = lastProgressAt

    onProgress({
      type: 'container-start',
      container: name,
      containerNumber,
      download,
    })

    for await (const blob of containerClient.listBlobsFlat()) {
      blobCount += 1
      const metadata = blobMetadata(blob)
      item.blobs.push(metadata)

      if (download) {
        const id = recordId(name, blob.name)
        const cachedMetadata = previous.blobs.get(id)
        const cachedRecord = previous.records.get(id)
        let normalized = null
        let initialIssue = null

        if (cachedRecord && sameBlob(cachedMetadata, metadata)) {
          normalized = normalizeCanonicalRecord(cachedRecord)
          if (normalized.ok) reusedCount += 1
          else initialIssue = normalized.issue
        } else {
          const downloaded = await downloadText(containerClient.getBlobClient(blob.name))
          downloadedCount += 1
          downloadedBytes += downloaded.bytes
          normalized = normalizeCanonicalRecord(recordFromText(name, blob.name, downloaded.text))
          if (!normalized.ok) initialIssue = normalized.issue
        }

        if (normalized?.ok) {
          records.push(normalized.record)
        } else if (name === 'realcalendar') {
          const expectedSeason = Number(cachedRecord?.key ?? Number.parseInt(blob.name, 10))
          const recovered = await recoverRealCalendarHistory(containerClient, blob.name, expectedSeason)
          downloadedCount += recovered.downloadedCount
          downloadedBytes += recovered.downloadedBytes
          if (recovered.record) {
            recoveredCount += 1
            if (recovered.sourceKind === 'version') recoveredVersionCount += 1
            if (recovered.sourceKind === 'snapshot') recoveredSnapshotCount += 1
            records.push(recovered.record)
            recoveries.push({
              container: name,
              blobName: blob.name,
              key: expectedSeason,
              sourceKind: recovered.sourceKind,
              versionId: recovered.versionId,
              snapshot: recovered.snapshot,
              lastModified: recovered.lastModified,
              reason: initialIssue?.detail ?? 'Current RealCalendar payload is not valid for its Azure/Rystem season key.',
            })
          } else {
            issues.push(initialIssue ?? {
              container: name,
              blobName: blob.name,
              key: expectedSeason,
              reason: 'invalid-realcalendar-season',
              detail: 'Current RealCalendar payload is invalid and no valid Azure blob version or snapshot could be recovered.',
            })
          }
        } else if (initialIssue) {
          issues.push(initialIssue)
        }
      }

      const now = Date.now()
      if (blobCount === 1 || blobCount % PROGRESS_BLOB_INTERVAL === 0 || now - lastProgressAt >= PROGRESS_TIME_INTERVAL_MS) {
        onProgress({
          type: 'container-progress',
          container: name,
          containerNumber,
          download,
          blobCount,
          downloadedCount,
          downloadedBytes,
          reusedCount,
          recoveredCount,
          recoveredVersionCount,
          recoveredSnapshotCount,
          currentBlob: blob.name,
          elapsedMs: now - startedAt,
        })
        lastProgressAt = now
      }
    }

    totalDownloadedCount += downloadedCount
    totalDownloadedBytes += downloadedBytes
    totalReusedCount += reusedCount
    totalRecoveredCount += recoveredCount
    totalRecoveredVersionCount += recoveredVersionCount
    totalRecoveredSnapshotCount += recoveredSnapshotCount
    onProgress({
      type: 'container-complete',
      container: name,
      containerNumber,
      download,
      blobCount,
      downloadedCount,
      downloadedBytes,
      reusedCount,
      recoveredCount,
      recoveredVersionCount,
      recoveredSnapshotCount,
      elapsedMs: Date.now() - startedAt,
    })
  }

  const stats = {
    downloadedCount: totalDownloadedCount,
    downloadedBytes: totalDownloadedBytes,
    reusedCount: totalReusedCount,
    recoveredHistoryCount: totalRecoveredCount,
    recoveredVersionCount: totalRecoveredVersionCount,
    recoveredSnapshotCount: totalRecoveredSnapshotCount,
  }
  onProgress({
    type: 'scan-complete',
    containerCount: inventory.length,
    blobCount: inventory.reduce((sum, item) => sum + item.blobs.length, 0),
    canonicalRecordCount: records.length,
    issueCount: issues.length,
    ...stats,
  })
  return { inventory, records, issues, recoveries, stats }
}
