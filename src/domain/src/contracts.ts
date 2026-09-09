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

/**
 * Current Fantazone group invitation envelope.
 *
 * The shared GitHub PAT is never present in plaintext in this payload. `sealed`
 * contains the AES-256-GCM ciphertext and can be unlocked only with the random
 * out-of-band code generated together with the invitation.
 *
 * There is deliberately no invite-version field: Fantazone supports one current
 * invitation format instead of carrying compatibility branches for obsolete links.
 */
export type GroupInvitePayload = {
  group: string
  repository: string
  /** Email that the invited person is expected to prove with Microsoft. */
  email: string
  /** Base64 AES-GCM sealed data containing the shared group PAT. */
  sealed: string
}

export type RepositoryWrite<T> = {
  path: string
  value: T
  message: string
  expectedSha?: string
}
