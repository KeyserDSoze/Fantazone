# Runtime topology: zero application servers

Fantazone has three persistent/runtime scopes. Keeping them separate avoids duplicate scraping and avoids storing group credentials on a central server.

## 1. Platform repository

`KeyserDSoze/Fantazone` contains application source, documentation, the shared TypeScript engine and global football data/producers.

```text
external public sources
        |
        v
Fantazone global Actions
        |
        +--> Serie A calendar
        +--> players/teams
        +--> live/final votes
        +--> odds/images later
        v
data/serie-a/...
```

Global football data is fetched once and consumed by every group/client.

## 2. Group repository

Each fantasy group owns one repository:

```text
Fantazone.<group-name>
```

It stores only group-specific state: settings/members, baskets/leagues, rosters, formations, fantasy calendars/results/rankings, market data, Hall of Fame/history and finalized auction outcomes.

### Group-owned workflow

The bootstrap now installs this entrypoint automatically:

```text
.github/workflows/fantazone-group.yml
```

Current manual jobs:

- `recalculate-day`;
- `recalculate-all`.

Execution topology:

```text
Fantazone.<group> workflow
        |
        +--> checkout group/      (own writable repository)
        |
        +--> checkout platform/   (public KeyserDSoze/Fantazone)
                 |
                 +--> TypeScript engine
                 +--> data/serie-a/official votes
        |
        v
shared reducers
        |
        v
group/data/... updates
        |
        v
commit with the group's short-lived GITHUB_TOKEN
```

The central Fantazone workflow therefore never needs a PAT for any group.

Concurrent maintenance runs in one group are serialized by workflow concurrency, avoiding two recalculation commits racing each other.

### Bootstrap and upgrades

`ensureGroupInitialized()` is idempotent. New groups receive:

- `fantazone.json`;
- `manifest.json`;
- `config/group.json`;
- `.github/workflows/fantazone-group.yml`.

Existing groups missing the workflow receive it the next time initialization/upgrade runs; existing files are not rewritten.

Because GitHub protects workflow-file writes separately, the credential used for bootstrap must be authorized to modify `.github/workflows/*`. A classic PAT needs the `workflow` scope in addition to repository access; granular credentials need the corresponding workflow write permission. Bootstrap returns a specific error when this permission is missing.

## 3. User device

The Expo React Native/web client is the application runtime. It owns:

- Google/Microsoft human identity;
- V1 group credential;
- selected group/year/league state;
- GitHub REST reads/writes;
- local deterministic calculations/read models;
- SHA/cache and optimistic concurrency;
- WebRTC during auctions.

There is no Fantazone application API between the client and GitHub.

## Normal flow

```text
                    +---------------------------+
                    | Public global GitHub data |
                    +-------------^-------------+
                                  |
                       global ingestion Actions
                                  |
+-------------+      REST         |        +----------------------+
| Expo client |<------------------+------->| Fantazone.<group>    |
| native/web  |                           | canonical group state |
+------+------+                           +----------^-----------+
       |                                             |
       | WebRTC auction                              | own Actions
       |                                             | own GITHUB_TOKEN
       v                                             |
+-------------------+                                |
| Auctioneer browser|--------------------------------+
| authoritative host|       finalized checkpoints
+-------------------+
```

## Responsibility examples

- Live match/rank view: **client/local composition**, because it is derived state.
- External votes/calendar: **platform Action**, because it is global ingestion.
- Definitive fantasy results/rankings: **group Action**, because it mutates group-owned canonical state.
- Auction bids: **WebRTC**, with GitHub only for durable/signaling state.

## External infrastructure that may remain

Zero backend means zero custom Fantazone application server, not zero Internet infrastructure:

- GitHub-hosted runners execute Actions;
- WebRTC may need STUN/TURN;
- push delivery may require Apple/Google/browser push infrastructure.

None of these hosts Fantazone's always-on application API or central group state.
