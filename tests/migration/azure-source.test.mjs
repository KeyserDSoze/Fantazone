import test from 'node:test'
import assert from 'node:assert/strict'
import { createBlobServiceClient } from '../../scripts/migration/azure-source.mjs'

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
  assert.equal(client.url, 'https://example.blob.core.windows.net')
})
