import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob'
import { shouldDownloadContainer } from './migration-plan.mjs'
import { unwrapRystemEntity } from './legacy-mappers.mjs'

const PROGRESS_BLOB_INTERVAL = 100
const PROGRESS_TIME_INTERVAL_MS = 5_000

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

export async function scanAzureStorage(connectionString, options = {}) {
  const client = options.client ?? createBlobServiceClient(connectionString)
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {}
  const inventory = []
  const records = []
  let containerNumber = 0

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
      item.blobs.push({ name: blob.name, size: blob.properties.contentLength ?? null, lastModified: blob.properties.lastModified?.toISOString?.() ?? null })
      if (download) {
        const response = await containerClient.getBlobClient(blob.name).download()
        const text = await streamToString(response.readableStreamBody)
        downloadedCount += 1
        downloadedBytes += Buffer.byteLength(text)
        const entity = unwrapRystemEntity(text, `${name}/${blob.name}`)
        if (!entity.enveloped && entity.key == null) {
          // Primitive keys can be recovered from the blob name only as a fallback. Composite-key canonical containers must remain enveloped.
          if (['realcalendar', 'realteamwrapper', 'realplayerswrapper', 'statplayerswrapper'].includes(name)) entity.key = Number.parseInt(blob.name, 10)
        }
        records.push({ container: name, blobName: blob.name, key: entity.key, value: entity.value })
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
          currentBlob: blob.name,
          elapsedMs: now - startedAt,
        })
        lastProgressAt = now
      }
    }

    onProgress({
      type: 'container-complete',
      container: name,
      containerNumber,
      download,
      blobCount,
      downloadedCount,
      downloadedBytes,
      elapsedMs: Date.now() - startedAt,
    })
  }

  onProgress({
    type: 'scan-complete',
    containerCount: inventory.length,
    blobCount: inventory.reduce((sum, item) => sum + item.blobs.length, 0),
    downloadedCount: records.length,
  })
  return { inventory, records }
}
