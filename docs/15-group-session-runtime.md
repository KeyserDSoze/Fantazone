# Group session runtime

`GroupSessionRuntime` is the composition boundary between repository selection and human login.

```text
GitHubClient(PAT)
      │
GitHubJsonStore
      │
      ├── GitHubGroupRepository
      ├── GitHubCalendarRepository
      ├── GitHubRankRepository
      └── GitHubTeamRepository
```

All repositories share one target and cache.

## Login gate

```text
no connection
 → PAT / repository discovery
 → GroupSessionRuntime + readable Group loaded
 → login gate for selected group
 → Google/Microsoft identity
 → refresh Group.users
 → membership decision
 → authenticated application session
```

The canonical public origin is `https://fanta.plus`. OAuth provider wiring is layered onto this sequence; it does not move login ahead of group selection.

## Membership freshness

`resolveIdentity()` refreshes `config/group.json` before authorization by default, so a removed/disabled member is not accepted from stale cache.

## Persistence

Group, Calendar, Rank and Team use readable schema-v2 documents directly. The runtime contains no raw naming translation layer.
