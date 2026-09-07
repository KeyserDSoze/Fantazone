import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const CACHE_VERSION = 1

function parseConnectionString(connectionString) {
  const parts = new Map()
  for (const token of String(connectionString ?? '').split(';')) {
    if (!token.trim()) continue
    const index = token.indexOf('=')
    if (index < 1) continue
    parts.set(token.slice(0, index).trim().toLowerCase(), token.slice(index + 1).trim())
  }
  return parts
}

function sourceIdentity(connectionString) {
  const parts = parseConnectionString(connectionString)
  if (String(parts.get('usedevelopmentstorage') ?? '').trim().toLowerCase() === 'true') return 'azurite:developmentstorage'

  const endpoint = parts.get('blobendpoint')
  if (endpoint) {
    try { return `blob:${new URL(endpoint).origin.toLowerCase()}` }
    catch { return `blob:${endpoint.replace(/\/$/, '').toLowerCase()}` }
  }

  const accountName = parts.get('accountname')
  if (accountName) {
    const protocol = (parts.get('defaultendpointsprotocol') || 'https').toLowerCase()
    const suffix = (parts.get('endpointsuffix') || 'core.windows.net').toLowerCase()
    return `blob:${protocol}://${accountName.toLowerCase()}.blob.${suffix}`
  }

  // Never hash the complete connection string: it may contain a SAS or AccountKey.
  return null
}

export function azureSourceFingerprint(connectionString) {
  const identity = sourceIdentity(connectionString)
  if (!identity) return null
  return createHash('sha256').update(identity).digest('hex')
}

function validScan(value) {
  return Boolean(value && typeof value === 'object' && Array.isArray(value.inventory) && Array.isArray(value.records))
}

export async function loadAzureScanCache(cachePath, connectionString) {
  const expectedFingerprint = azureSourceFingerprint(connectionString)
  if (!expectedFingerprint) return { status: 'unidentifiable-source' }

  let parsed
  try {
    parsed = JSON.parse(await readFile(cachePath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return { status: 'missing' }
    return { status: 'invalid', reason: error.message }
  }

  if (parsed?.version !== CACHE_VERSION) return { status: 'version-mismatch' }
  if (parsed?.sourceFingerprint !== expectedFingerprint) return { status: 'source-mismatch' }
  if (!validScan(parsed?.scan)) return { status: 'invalid', reason: 'cached scan has an invalid shape' }

  return {
    status: 'hit',
    createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : null,
    scan: parsed.scan,
  }
}

export async function saveAzureScanCache(cachePath, connectionString, scan) {
  const sourceFingerprint = azureSourceFingerprint(connectionString)
  if (!sourceFingerprint) return { saved: false, reason: 'Azure source cannot be identified without storing credentials' }
  if (!validScan(scan)) throw new Error('Cannot cache an invalid Azure scan')

  await mkdir(dirname(cachePath), { recursive: true })
  const temporaryPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`
  const payload = {
    version: CACHE_VERSION,
    createdAt: new Date().toISOString(),
    sourceFingerprint,
    scan,
  }

  try {
    await writeFile(temporaryPath, `${JSON.stringify(payload)}\n`, 'utf8')
    await rename(temporaryPath, cachePath)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {})
  }

  return { saved: true, createdAt: payload.createdAt }
}
