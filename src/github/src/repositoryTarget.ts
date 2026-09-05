export type RepositoryTarget = {
  owner: string
  repo: string
  ref?: string
}

/** Repository containing one fantasy group. Kept as an alias for existing callers. */
export type GroupRepositoryTarget = RepositoryTarget

/** Repository containing shared platform data such as Serie A calendars and votes. */
export type PlatformRepositoryTarget = RepositoryTarget
