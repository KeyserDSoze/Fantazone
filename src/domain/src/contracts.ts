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
 * Secret-free invitation contract shared through URLs.
 *
 * `repository` is always the exact GitHub full_name (`owner/repo`). Credentials
 * are deliberately excluded: every invited user provides their PAT locally on
 * the device that joins the group.
 */
export type GroupInvitePayload = {
  v: 2
  group: string
  repository: string
  /** Email that the invited person is expected to prove with Microsoft. */
  email: string
}

export type RepositoryWrite<T> = {
  path: string
  value: T
  message: string
  expectedSha?: string
}
