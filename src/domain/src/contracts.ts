export type GroupRepository = {
  owner: string
  repo: string
  groupName: string
  defaultBranch: string
}

export type FantazoneManifest = {
  schemaVersion: number
  revision: number
  updatedAt: string
  season?: number
  liveDay?: number
}

export type GroupInviteMode = 'email' | 'shared'

/**
 * Current Fantazone group invitation envelope.
 *
 * The shared GitHub PAT is never present in plaintext in this payload. `sealed`
 * contains AES-256-GCM ciphertext. The separate secret is either a random code
 * bound to one Microsoft email (`email`) or a group password reusable by any
 * Microsoft account (`shared`).
 *
 * There is deliberately no invite-version field: Fantazone supports one current
 * invitation format with two access modes instead of compatibility branches.
 */
export type GroupInvitePayload = {
  mode: GroupInviteMode
  group: string
  repository: string
  /** Required only for an email-bound invitation. */
  email?: string
  /** Base64 random salt used by PBKDF2-SHA-256. */
  salt: string
  /** PBKDF2 work factor authenticated together with the invitation. */
  iterations: number
  /** Base64 AES-GCM sealed data containing the shared group PAT. */
  sealed: string
}

export type RepositoryWrite<T> = {
  path: string
  value: T
  message: string
  expectedSha?: string
}
