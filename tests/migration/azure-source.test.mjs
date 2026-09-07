import test from 'node:test'
import assert from 'node:assert/strict'
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
