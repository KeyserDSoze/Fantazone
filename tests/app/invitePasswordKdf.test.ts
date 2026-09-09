import assert from 'node:assert/strict'
import test from 'node:test'
import { pbkdf2Sha256Portable } from '../../src/app/services/invitePasswordKdf'

const salt = new TextEncoder().encode('0123456789abcdef')

test('portable PBKDF2-HMAC-SHA-256 matches a one-iteration reference vector', async () => {
  assert.equal(
    hex(await pbkdf2Sha256Portable('password', salt, 1)),
    'ef9d5f6add4a5d19f4a7fc92b48f2351ea95bb977642c0071ed4e4010a42cb6c',
  )
})

test('portable PBKDF2-HMAC-SHA-256 matches multi-iteration reference vectors', async () => {
  assert.equal(
    hex(await pbkdf2Sha256Portable('password', salt, 2)),
    '4536427916ecc4db17ff9702daac1a9a755fb17f9a544ebc4e9dc4ce1689112e',
  )
  assert.equal(
    hex(await pbkdf2Sha256Portable('password', salt, 4096)),
    '615eeee652a9fe1cf9f427d6218526a937add018079854b2aa11875d759837ac',
  )
})

function hex(bytes: Uint8Array): string {
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
}
