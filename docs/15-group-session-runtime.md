# Group session runtime

The app now has a composition boundary between repository selection and external login.

## Runtime creation

After PAT validation and repository selection, `GroupSessionRuntime.open(connection)` creates exactly one:

```text
GitHubClient(PAT)
      │
GitHubJsonStore
      │
      ├── GitHubGroupRepository
      ├── GitHubCalendarRepository
      └── GitHubRankRepository
```

All feature repositories therefore share the same target and JSON cache. Screens do not construct GitHub clients and do not carry SHA/PAT transport concerns.

Opening the runtime immediately reads `config/group.json`. A stored connection that can no longer read the group is not considered a valid application session.

## Login gate

The app flow is now structurally:

```text
no connection
  → PAT / repository discovery
  → GroupSessionRuntime + GroupRaw loaded
  → login gate for the selected group
  → external Google/Microsoft identity
  → refresh GroupRaw.u and resolve membership
  → authenticated application session
```

The Google/Microsoft adapter is intentionally not wired in this slice because the final public domain/redirect URI is being configured separately. The login screen already accepts an optional provider callback, so adding OAuth does not require restructuring the group/session flow.

## Membership freshness

`GroupSessionRuntime.resolveIdentity()` refreshes `config/group.json` by default before authorizing the external identity. If an administrator removed/disabled a member after app startup, the login boundary sees the new `GroupRaw.u` state instead of trusting stale local cache.

## Existing JSON

This runtime introduces no new persisted application schema. Group, Calendar and Ranking adapters continue reading the exact compact legacy raw JSON contracts.
