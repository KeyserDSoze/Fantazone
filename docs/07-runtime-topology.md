# Runtime topology: zero application servers

Fantazone has three persistent/runtime scopes. Keeping them separate avoids duplicating global scraping and avoids keeping group PATs on a central server.

## 1. Platform repository

`KeyserDSoze/Fantazone` contains the application source, documentation, shared domain/job code and global ingestion workflows.

Global football data should be fetched **once**, not once per fantasy group:

```text
external public sources
        |
        v
Fantazone global Actions
        |
        +--> Serie A calendar/live
        +--> players and teams
        +--> live/final votes
        +--> player odds/probabilities
        +--> player images/static source assets
        v
global normalized GitHub data
```

The normalized global data must be readable by every client/group without a central application token. The final location is an explicit architecture decision:

- make the relevant platform data public; or
- use a dedicated public repository such as `Fantazone.Data`.

This decision is tracked by issue #9.

## 2. Group repository

Each fantasy-football group owns one repository:

```text
Fantazone.<group-name>
```

It stores only group-specific state:

- group settings and members;
- baskets/leagues/competitions and yearly rules;
- teams, budgets and ownership;
- formations;
- calendars generated for fantasy competitions;
- match results and standings;
- market/trades;
- cards and group configuration;
- Hall of Fame/group history;
- finalized auction outcomes;
- command/event logs and manifest revisions.

### Why group Actions must run inside the group repo

A central Fantazone workflow must never need to keep the PAT for every group. A group-specific workflow runs in `Fantazone.<group>` and gets that repository's short-lived `GITHUB_TOKEN`, so it can update its own files without a Fantazone backend or central secret database.

```text
Fantazone.<group>
  .github/workflows/...
         |
         | GITHUB_TOKEN scoped to this repo
         v
  calculate / rebuild / commit group data
```

Group workflows include:

- copy missing formation to the next day;
- calculate/recalculate a fantasy day;
- rebuild all days/standings;
- group manager/derived state;
- market processing;
- Hall of Fame aggregation;
- repository validation/repair;
- manual administrative dispatches.

They consume global normalized football data from the public global-data source.

## 3. User device

The Expo React Native/web client is the application runtime.

It owns:

- Google/Microsoft human identity;
- the V1 group PAT credential;
- selected group/year/league/application state;
- GitHub REST reads/writes;
- local deterministic calculations where appropriate;
- ETag/SHA cache and optimistic-concurrency retry;
- WebRTC connections during auctions.

No application API sits between the client and GitHub.

## End-to-end normal flow

```text
                    +--------------------------+
                    | Public global GitHub data|
                    +-------------^------------+
                                  |
                    Global Actions / ingestion
                                  |
                                  |
+-------------+      REST         |        +----------------------+
| Expo client |<------------------+------->| Fantazone.<group>    |
| native/web  |                           | group state + history |
+------+------+                           +----------^-----------+
       |                                             |
       | WebRTC during auction                      | group Actions
       |                                             | own GITHUB_TOKEN
       v                                             |
+------------------+                                 |
| Auctioneer device|---------------------------------+
| authoritative host  finalized checkpoints only
+------------------+
```

## Group-repository bootstrap

When a group is created, the bootstrap process eventually must install not only `fantazone.json`, manifest/config/member files, but also the supported group workflow entrypoints. Two viable designs are tracked:

1. generate the repository from a maintained GitHub template; or
2. let the bootstrap client copy versioned workflow templates into `.github/workflows`.

The template design is preferable if it reduces PAT permissions and makes the initial repository atomic. Existing groups also need a workflow-schema/version migration strategy.

## What remains external infrastructure

The goal is zero **Fantazone application backend**, not pretending Internet primitives do not exist.

- WebRTC normally uses STUN and may need TURN relay on restrictive networks.
- Real push-notification delivery may require Apple/Google/browser push infrastructure.
- GitHub-hosted runners are the execution environment for Actions.

These do not hold Fantazone application state or expose a custom always-on API.
