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

export type GroupInvitePayload = {
  v: 1
  group: string
  repository: string
  pat: string
  owner?: string
}

export type RepositoryWrite<T> = {
  path: string
  value: T
  message: string
  expectedSha?: string
}
