import type { EvolutionCardCommitment, EvolutionCardReveal } from './evolutionModel'

export interface EvolutionCardCommitmentInput {
  leagueId: string
  year: number
  serieADay: number
  owner: string
  cardIds: readonly string[]
  nonce: string
  committedAt: string
  lockedAt?: string | null
  revealAt?: string | null
}

/**
 * Seals a card choice without persisting the actual cards. The public group repository
 * receives only this SHA-256 commitment before kickoff; card ids + nonce are published
 * at reveal time and must verify against exactly the same league/day/owner identity.
 */
export function createEvolutionCardCommitment(input: EvolutionCardCommitmentInput): EvolutionCardCommitment {
  validateCommitmentInput(input)
  return {
    commitment: evolutionCardCommitmentHash(input),
    committedAt: input.committedAt,
    lockedAt: input.lockedAt ?? null,
    revealAt: input.revealAt ?? null,
    reveal: null,
  }
}

export function revealEvolutionCardCommitment(
  sealed: EvolutionCardCommitment,
  input: Omit<EvolutionCardCommitmentInput, 'committedAt' | 'lockedAt' | 'revealAt'> & { revealedAt: string },
): EvolutionCardCommitment {
  if (!verifyEvolutionCardReveal(sealed, input)) {
    throw new Error('Il reveal delle carte Evolution non corrisponde al commitment pubblicato.')
  }
  return {
    ...sealed,
    reveal: {
      cardIds: canonicalCardIds(input.cardIds),
      nonce: input.nonce,
      revealedAt: input.revealedAt,
    },
  }
}

export function verifyEvolutionCardReveal(
  sealed: Pick<EvolutionCardCommitment, 'commitment'>,
  input: Omit<EvolutionCardCommitmentInput, 'committedAt' | 'lockedAt' | 'revealAt'>,
): boolean {
  try {
    return constantTimeEqual(sealed.commitment, evolutionCardCommitmentHash(input))
  } catch {
    return false
  }
}

export function getVerifiedEvolutionCardIds(
  sealed: EvolutionCardCommitment | null | undefined,
  identity: { leagueId: string; year: number; serieADay: number; owner: string },
): string[] | null {
  const reveal = sealed?.reveal
  if (!sealed || !reveal) return null
  return verifyEvolutionCardReveal(sealed, {
    ...identity,
    cardIds: reveal.cardIds,
    nonce: reveal.nonce,
  }) ? canonicalCardIds(reveal.cardIds) : null
}

export function evolutionCardCommitmentHash(
  input: Omit<EvolutionCardCommitmentInput, 'committedAt' | 'lockedAt' | 'revealAt'>,
): string {
  validateIdentity(input)
  const nonce = input.nonce.trim()
  if (nonce.length < 16) throw new Error('Evolution card nonce must contain at least 16 characters')
  const payload = JSON.stringify({
    version: 1,
    leagueId: input.leagueId.trim(),
    year: input.year,
    serieADay: input.serieADay,
    owner: normalizeOwner(input.owner),
    cardIds: canonicalCardIds(input.cardIds),
    nonce,
  })
  return sha256Hex(payload)
}

export function canonicalCardIds(cardIds: readonly string[]): string[] {
  const values = cardIds.map(value => value.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b))
  if (new Set(values).size !== values.length) throw new Error('Evolution card ids must be unique')
  return values
}

export function isEvolutionCardReveal(value: unknown): value is EvolutionCardReveal {
  if (!value || typeof value !== 'object') return false
  const reveal = value as Partial<EvolutionCardReveal>
  return Array.isArray(reveal.cardIds) && reveal.cardIds.every(card => typeof card === 'string' && Boolean(card.trim())) &&
    typeof reveal.nonce === 'string' && reveal.nonce.trim().length >= 16 &&
    typeof reveal.revealedAt === 'string' && Number.isFinite(Date.parse(reveal.revealedAt))
}

function validateCommitmentInput(input: EvolutionCardCommitmentInput): void {
  validateIdentity(input)
  if (!Number.isFinite(Date.parse(input.committedAt))) throw new Error('Evolution card committedAt must be an ISO date')
  if (input.lockedAt != null && !Number.isFinite(Date.parse(input.lockedAt))) throw new Error('Evolution card lockedAt must be an ISO date')
  if (input.revealAt != null && !Number.isFinite(Date.parse(input.revealAt))) throw new Error('Evolution card revealAt must be an ISO date')
}

function validateIdentity(input: { leagueId: string; year: number; serieADay: number; owner: string; cardIds: readonly string[] }): void {
  if (!input.leagueId.trim()) throw new Error('Evolution league id is required')
  if (!Number.isInteger(input.year) || input.year < 1) throw new Error('Evolution season must be a positive integer')
  if (!Number.isInteger(input.serieADay) || input.serieADay < 1 || input.serieADay > 38) throw new Error('Evolution Serie A day must be between 1 and 38')
  if (!normalizeOwner(input.owner)) throw new Error('Evolution card owner is required')
  canonicalCardIds(input.cardIds)
}

function normalizeOwner(value: string): string {
  return value.trim().toLowerCase()
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  return difference === 0
}

// Small dependency-free SHA-256 implementation so commitments are identical in web,
// native and Node jobs without relying on a platform-specific crypto API.
function sha256Hex(message: string): string {
  const bytes = utf8(message)
  const bitLength = bytes.length * 8
  const paddedLength = (((bytes.length + 9 + 63) >> 6) << 6)
  const padded = new Uint8Array(paddedLength)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  const high = Math.floor(bitLength / 0x100000000)
  const low = bitLength >>> 0
  view.setUint32(paddedLength - 8, high, false)
  view.setUint32(paddedLength - 4, low, false)

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const k = SHA256_K
  const w = new Uint32Array(64)

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) w[index] = view.getUint32(offset + index * 4, false)
    for (let index = 16; index < 64; index += 1) {
      const a = w[index - 15]
      const b = w[index - 2]
      const s0 = rotateRight(a, 7) ^ rotateRight(a, 18) ^ (a >>> 3)
      const s1 = rotateRight(b, 17) ^ rotateRight(b, 19) ^ (b >>> 10)
      w[index] = (w[index - 16] + s0 + w[index - 7] + s1) >>> 0
    }

    let a = h[0]
    let b = h[1]
    let c = h[2]
    let d = h[3]
    let e = h[4]
    let f = h[5]
    let g = h[6]
    let hh = h[7]
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (hh + s1 + ch + k[index] + w[index]) >>> 0
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (s0 + maj) >>> 0
      hh = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    h[0] = (h[0] + a) >>> 0
    h[1] = (h[1] + b) >>> 0
    h[2] = (h[2] + c) >>> 0
    h[3] = (h[3] + d) >>> 0
    h[4] = (h[4] + e) >>> 0
    h[5] = (h[5] + f) >>> 0
    h[6] = (h[6] + g) >>> 0
    h[7] = (h[7] + hh) >>> 0
  }
  return [...h].map(value => value.toString(16).padStart(8, '0')).join('')
}

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits))
}

function utf8(value: string): Uint8Array {
  const encoded = unescape(encodeURIComponent(value))
  const bytes = new Uint8Array(encoded.length)
  for (let index = 0; index < encoded.length; index += 1) bytes[index] = encoded.charCodeAt(index)
  return bytes
}

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
