import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { createBlobServiceClient, scanAzureStorage } from '../../scripts/migration/azure-source.mjs'

test('BlobEndpoint + SAS works without AccountName', () => {
  const client = createBlobServiceClient('BlobEndpoint=https://example.blob.core.windows.net;SharedAccessSignature=sv=2026-01-01&sp=rl&sig=test')
  assert.ok(client)
  assert.match(client.url, /^https:\/\/example\.blob\.core\.windows\.net/)
})

test('SharedKey explicitly requires AccountName', () => {
  assert.throws(
    () => createBlobServiceClient('BlobEndpoint=https://example.blob.core.windows.net;AccountKey=ZmFrZS1rZXk='),
    /AccountName is required/,
  )
})

test('BlobEndpoint + AccountName + AccountKey builds a SharedKey client without network access', () => {
  const client = createBlobServiceClient('BlobEndpoint=https://example.blob.core.windows.net;AccountName=example;AccountKey=ZmFrZS1rZXk=')
  assert.ok(client)
  assert.equal(new URL(client.url).origin, 'https://example.blob.core.windows.net')
})

test('Azure scan emits progress while inventory-only containers are enumerated', async () => {
  const events = []
  const client = {
    async *listContainers() {
      yield { name: 'auction' }
    },
    getContainerClient() {
      return {
        async *listBlobsFlat() {
          yield { name: 'one.json', properties: { contentLength: 10 } }
          yield { name: 'two.json', properties: { contentLength: 20 } }
        },
        getBlobClient() {
          throw new Error('Auction content must not be downloaded')
        },
      }
    },
  }

  const result = await scanAzureStorage('unused-for-injected-client', {
    client,
    onProgress: event => events.push(event),
  })

  assert.equal(result.inventory[0].blobs.length, 2)
  assert.equal(result.records.length, 0)
  assert.ok(events.some(event => event.type === 'container-start' && event.container === 'auction'))
  assert.ok(events.some(event => event.type === 'container-progress' && event.blobCount === 1))
  assert.ok(events.some(event => event.type === 'container-complete' && event.blobCount === 2))
  assert.ok(events.some(event => event.type === 'scan-complete' && event.blobCount === 2))
})

test('incremental Azure scan reuses unchanged cached records and downloads only new blobs', async () => {
  const downloaded = []
  const lastModified = new Date('2026-09-01T12:00:00Z')
  const previousScan = {
    inventory: [{
      name: 'calendar', downloaded: true,
      blobs: [{ name: 'old.json', size: 20, lastModified: lastModified.toISOString(), etag: 'etag-old' }],
    }],
    records: [{
      container: 'calendar', blobName: 'old.json',
      key: { g: 'group', l: 'league', y: 15 }, value: { y: 15, r: {} },
    }],
  }
  const newPayload = JSON.stringify({ k: { g: 'group', l: 'league', y: 15 }, v: { y: 15, r: {} } })
  const client = {
    async *listContainers() { yield { name: 'calendar' } },
    getContainerClient() {
      return {
        async *listBlobsFlat() {
          yield { name: 'old.json', properties: { contentLength: 20, lastModified, etag: 'etag-old' } }
          yield { name: 'new.json', properties: { contentLength: newPayload.length, lastModified, etag: 'etag-new' } }
        },
        getBlobClient(name) {
          return {
            async download() {
              downloaded.push(name)
              return { readableStreamBody: Readable.from([newPayload]) }
            },
          }
        },
      }
    },
  }

  const result = await scanAzureStorage('unused-for-injected-client', { client, previousScan })
  assert.deepEqual(downloaded, ['new.json'])
  assert.equal(result.records.length, 2)
  assert.equal(result.stats.reusedCount, 1)
  assert.equal(result.stats.downloadedCount, 1)
})

test('invalid current RealCalendar is recovered from the newest valid Azure blob version', async () => {
  const currentPayload = JSON.stringify({
    y: 0,
    d: [{ y: 12, a: 1, g: [{ h: { n: 'Bologna', a: 'bol' }, a: { n: 'Udinese', a: 'udi' }, d: '2024-08-18T18:30:00Z', g: null, y: null, e: false }] }],
  })
  const historicalPayload = JSON.stringify({
    y: 12,
    d: [{ y: 12, a: 1, g: [{ h: { n: 'Empoli', a: 'emp' }, a: { n: 'Verona', a: 'ver' }, d: '2023-08-19T18:30:00Z', g: 0, y: 1, e: false }] }],
  })
  const lastModified = new Date('2024-08-01T10:00:00Z')
  const blobClient = {
    async download() { return { readableStreamBody: Readable.from([currentPayload]) } },
    withVersion(versionId) {
      assert.equal(versionId, 'valid-history')
      return {
        async download() { return { readableStreamBody: Readable.from([historicalPayload]) } },
      }
    },
  }
  const client = {
    async *listContainers() { yield { name: 'realcalendar' } },
    getContainerClient() {
      return {
        async *listBlobsFlat(options = {}) {
          if (options.includeVersions) {
            yield { name: '12', versionId: 'valid-history', properties: { lastModified } }
            return
          }
          if (options.includeSnapshots) return
          yield { name: '12', properties: { contentLength: currentPayload.length, lastModified, etag: 'current' } }
        },
        getBlobClient() { return blobClient },
      }
    },
  }

  const result = await scanAzureStorage('unused-for-injected-client', { client })
  assert.equal(result.issues.length, 0)
  assert.equal(result.recoveries.length, 1)
  assert.equal(result.records.length, 1)
  assert.equal(result.records[0].key, 12)
  assert.equal(result.records[0].value.y, 12)
  assert.equal(result.records[0].value.d[0].g[0].d, '2023-08-19T18:30:00Z')
  assert.equal(result.records[0].sourceVersionId, 'valid-history')
  assert.equal(result.stats.recoveredVersionCount, 1)
  assert.equal(result.stats.recoveredSnapshotCount, 0)
})

test('invalid current RealCalendar falls back to an Azure snapshot when version history is unavailable', async () => {
  const currentPayload = JSON.stringify({
    y: 0,
    d: [{ y: 14, a: 1, g: [{ h: { n: 'Inter', a: 'int' }, a: { n: 'Milan', a: 'mil' }, d: '2026-08-22T18:30:00Z', g: null, y: null, e: false }] }],
  })
  const historicalPayload = JSON.stringify({
    y: 14,
    d: [{ y: 14, a: 1, g: [{ h: { n: 'Genoa', a: 'gen' }, a: { n: 'Lecce', a: 'lec' }, d: '2025-08-23T18:30:00Z', g: 0, y: 0, e: false }] }],
  })
  const currentModified = new Date('2026-08-01T10:00:00Z')
  const snapshotModified = new Date('2026-07-31T22:00:00Z')
  const snapshotId = '2026-07-31T22:00:00.0000000Z'
  const blobClient = {
    async download() { return { readableStreamBody: Readable.from([currentPayload]) } },
    withSnapshot(snapshot) {
      assert.equal(snapshot, snapshotId)
      return {
        async download() { return { readableStreamBody: Readable.from([historicalPayload]) } },
      }
    },
  }
  const client = {
    async *listContainers() { yield { name: 'realcalendar' } },
    getContainerClient() {
      return {
        async *listBlobsFlat(options = {}) {
          if (options.includeVersions) return
          if (options.includeSnapshots) {
            yield { name: '14', snapshot: snapshotId, properties: { lastModified: snapshotModified } }
            return
          }
          yield { name: '14', properties: { contentLength: currentPayload.length, lastModified: currentModified, etag: 'current' } }
        },
        getBlobClient() { return blobClient },
      }
    },
  }

  const result = await scanAzureStorage('unused-for-injected-client', { client })
  assert.equal(result.issues.length, 0)
  assert.equal(result.recoveries.length, 1)
  assert.equal(result.recoveries[0].sourceKind, 'snapshot')
  assert.equal(result.records[0].sourceSnapshot, snapshotId)
  assert.equal(result.records[0].value.y, 14)
  assert.equal(result.records[0].value.d[0].g[0].d, '2025-08-23T18:30:00Z')
  assert.equal(result.stats.recoveredVersionCount, 0)
  assert.equal(result.stats.recoveredSnapshotCount, 1)
  assert.equal(result.stats.recoveredHistoryCount, 1)
})
