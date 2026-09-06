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
 * Legacy secret-free invitation kept for links created before the shared-group
 * credential model. Joining one of these links still requires entering the group
 * PAT once so it can be persisted in the user's OneDrive settings.
 */
export type SecretFreeGroupInvitePayload = {
  v: 2
  group: string
  repository: string
  email: string
}

/**
 * Zero-backend invitation contract.
 *
 * With no trusted backend and no GitHub account required for participants, the
 * GitHub credential is necessarily a group credential available to the client.
 * New invitations therefore carry the same PAT that the inviter is already using.
 * The app strips the URL fragment immediately, verifies the invited Microsoft
 * identity, and persists the credential in that user's private OneDrive app data.
 */
export type SharedCredentialGroupInvitePayload = {
  v: 3
  group: string
  repository: string
  /** Email that the invited person is expected to prove with Microsoft. */
  email: string
  /** Shared GitHub credential for this Fantazone group repository. */
  pat: string
}

export type GroupInvitePayload = SecretFreeGroupInvitePayload | SharedCredentialGroupInvitePayload

export type RepositoryWrite<T> = {
  path: string
  value: T
  message: string
  expectedSha?: string
}
