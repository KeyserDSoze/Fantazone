import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  azureSourceFingerprint,
  loadAzureScanCache,
  saveAzureScanCache,
} from '../../scripts/migration/scan-cache.mjs'

const scan = {
  inventory: [{ name: 'calendar', downloaded: true, blobs: [{ name: 'blob-1', size: 10, lastModified: null }] }],
  records: [{ container: 'calendar', blobName: 'blob-1', key: { g: 'group', l: 'league', y: 12 }, value: { y: 12, r: {} } }],
}

async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'fantazone-migration-cache-'))
  try { await fn(join(root, 'scan.json')) }
  finally { await rm(root, { recursive: true, force: true }) }
}

test('Azure source fingerprint ignores rotating SharedKey secrets', () => {
  const first = azureSourceFingerprint('BlobEndpoint=https://example.blob.core.windows.net;AccountName=example;AccountKey=Zmlyc3Q=')
  const second = azureSourceFingerprint('BlobEndpoint=https://example.blob.core.windows.net;AccountName=example;AccountKey=c2Vjb25k')
  assert.ok(first)
  assert.equal(first, second)
})

test('Azure source fingerprint ignores rotating SAS secrets', () => {
  const first = azureSourceFingerprint('BlobEndpoint=https://example.blob.core.windows.net;SharedAccessSignature=sv=1&sig=first')
  const second = azureSourceFingerprint('BlobEndpoint=https://example.blob.core.windows.net;SharedAccessSignature=sv=2&sig=second')
  assert.ok(first)
  assert.equal(first, second)
})

test('writes and reuses a scan cache for the same Azure source', async () => {
  await fixture(async cachePath => {
    const connection = 'BlobEndpoint=https://example.blob.core.windows.net;SharedAccessSignature=sv=1&sig=secret'
    const saved = await saveAzureScanCache(cachePath, connection, scan)
    assert.equal(saved.saved, true)

    const cached = await loadAzureScanCache(cachePath, connection)
    assert.equal(cached.status, 'hit')
    assert.deepEqual(cached.scan, scan)

    const raw = await readFile(cachePath, 'utf8')
    assert.equal(raw.includes('sig=secret'), false)
    assert.equal(raw.includes('SharedAccessSignature'), false)
  })
})

test('refresh replaces an existing cache file', async () => {
  await fixture(async cachePath => {
    const connection = 'BlobEndpoint=https://example.blob.core.windows.net;SharedAccessSignature=sig=secret'
    await saveAzureScanCache(cachePath, connection, scan)

    const refreshed = {
      inventory: [...scan.inventory, { name: 'rank', downloaded: true, blobs: [] }],
      records: [...scan.records, { container: 'rank', blobName: 'rank-1', key: { g: 'group', l: 'league', y: 12 }, value: { d: 38, r: {} } }],
    }
    await saveAzureScanCache(cachePath, connection, refreshed)

    const cached = await loadAzureScanCache(cachePath, connection)
    assert.equal(cached.status, 'hit')
    assert.deepEqual(cached.scan, refreshed)
  })
})

test('rejects a cache created for a different Azure source', async () => {
  await fixture(async cachePath => {
    await saveAzureScanCache(cachePath, 'BlobEndpoint=https://one.blob.core.windows.net;SharedAccessSignature=sig=one', scan)
    const cached = await loadAzureScanCache(cachePath, 'BlobEndpoint=https://two.blob.core.windows.net;SharedAccessSignature=sig=two')
    assert.equal(cached.status, 'source-mismatch')
  })
})

test('treats corrupt cache content as invalid and allows a fresh scan', async () => {
  await fixture(async cachePath => {
    await writeFile(cachePath, '{broken', 'utf8')
    const cached = await loadAzureScanCache(cachePath, 'BlobEndpoint=https://example.blob.core.windows.net;SharedAccessSignature=sig=test')
    assert.equal(cached.status, 'invalid')
  })
})
