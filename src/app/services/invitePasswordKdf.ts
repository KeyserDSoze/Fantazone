export const INVITE_PASSWORD_KDF_ITERATIONS = 120_000
export const INVITE_PASSWORD_MIN_LENGTH = 16
export const INVITE_PASSWORD_MAX_LENGTH = 128

const SHA256_BLOCK_SIZE = 64
const SHA256_OUTPUT_SIZE = 32
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

/**
 * Derives the AES-256 key bytes from an out-of-band invitation secret.
 * Native WebCrypto is used when available; React Native falls back to the same
 * PBKDF2-HMAC-SHA-256 algorithm implemented in portable JavaScript.
 */
export async function deriveInviteSecretKey(
  secret: string,
  salt: Uint8Array,
  iterations = INVITE_PASSWORD_KDF_ITERATIONS,
): Promise<Uint8Array> {
  validateInputs(secret, salt, iterations)
  const subtle = typeof globalThis !== 'undefined' ? globalThis.crypto?.subtle : undefined
  if (subtle) {
    const baseKey = await subtle.importKey(
      'raw',
      toArrayBuffer(utf8(secret)),
      { name: 'PBKDF2' },
      false,
      ['deriveBits'],
    )
    const bits = await subtle.deriveBits(
      {
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt: toArrayBuffer(salt),
        iterations,
      },
      baseKey,
      256,
    )
    return new Uint8Array(bits)
  }
  return pbkdf2Sha256Portable(secret, salt, iterations)
}

/** Standard PBKDF2-HMAC-SHA-256 fallback kept exportable for deterministic tests. */
export async function pbkdf2Sha256Portable(
  secret: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  validateInputs(secret, salt, iterations)
  const key = utf8(secret)
  const block = concatBytes(salt, Uint8Array.of(0, 0, 0, 1))
  let u = hmacSha256(key, block)
  const result = new Uint8Array(u)

  for (let round = 1; round < iterations; round += 1) {
    u = hmacSha256(key, u)
    for (let index = 0; index < SHA256_OUTPUT_SIZE; index += 1) result[index] ^= u[index]
    if ((round & 2047) === 0) await yieldToRuntime()
  }
  return result
}

function validateInputs(secret: string, salt: Uint8Array, iterations: number): void {
  if (!secret) throw new Error('Il segreto dell’invito non può essere vuoto.')
  if (salt.length < 16) throw new Error('Il salt dell’invito non è valido.')
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 1_000_000) {
    throw new Error('Il numero di iterazioni PBKDF2 dell’invito non è valido.')
  }
}

function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  const normalizedKey = key.length > SHA256_BLOCK_SIZE ? sha256(key) : key
  const innerPad = new Uint8Array(SHA256_BLOCK_SIZE)
  const outerPad = new Uint8Array(SHA256_BLOCK_SIZE)
  for (let index = 0; index < SHA256_BLOCK_SIZE; index += 1) {
    const value = index < normalizedKey.length ? normalizedKey[index] : 0
    innerPad[index] = value ^ 0x36
    outerPad[index] = value ^ 0x5c
  }
  return sha256(concatBytes(outerPad, sha256(concatBytes(innerPad, message))))
}

function sha256(input: Uint8Array): Uint8Array {
  const bitLength = input.length * 8
  const paddedLength = Math.ceil((input.length + 9) / SHA256_BLOCK_SIZE) * SHA256_BLOCK_SIZE
  const padded = new Uint8Array(paddedLength)
  padded.set(input)
  padded[input.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false)
  view.setUint32(paddedLength - 4, bitLength >>> 0, false)

  let h0 = 0x6a09e667
  let h1 = 0xbb67ae85
  let h2 = 0x3c6ef372
  let h3 = 0xa54ff53a
  let h4 = 0x510e527f
  let h5 = 0x9b05688c
  let h6 = 0x1f83d9ab
  let h7 = 0x5be0cd19
  const words = new Uint32Array(64)

  for (let offset = 0; offset < paddedLength; offset += SHA256_BLOCK_SIZE) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4, false)
    for (let index = 16; index < 64; index += 1) {
      const x = words[index - 15]
      const y = words[index - 2]
      const sigma0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)
      const sigma1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0
    }

    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    let f = h5
    let g = h6
    let h = h7

    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const choose = (e & f) ^ (~e & g)
      const temp1 = (h + sum1 + choose + SHA256_K[index] + words[index]) >>> 0
      const sum0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const majority = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (sum0 + majority) >>> 0
      h = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }

    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
    h5 = (h5 + f) >>> 0
    h6 = (h6 + g) >>> 0
    h7 = (h7 + h) >>> 0
  }

  const output = new Uint8Array(SHA256_OUTPUT_SIZE)
  const outputView = new DataView(output.buffer)
  ;[h0, h1, h2, h3, h4, h5, h6, h7].forEach((value, index) => outputView.setUint32(index * 4, value, false))
  return output
}

function rotr(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount))
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length)
  copy.set(bytes)
  return copy.buffer
}

function yieldToRuntime(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}
