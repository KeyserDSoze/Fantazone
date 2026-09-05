# Runtime topology: zero application servers

Fantazone has three persistent/runtime scopes. Keeping them separate avoids duplicate scraping, prevents the platform from storing group credentials and lets every fantasy group own its lifecycle independently.

## 1. Platform repository

`KeyserDSoze/Fantazone` contains:

- application source and GitHub Pages deployment;
- shared TypeScript domain/job engine;
- Fantazone-maintained templates used to bootstrap/upgrade group repositories;
- global football producers and normalized data.

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

The platform `Background jobs` workflow exposes only global work. It must never expose group maintenance such as recalculation, formation propagation, market processing or Hall-of-Fame rebuilds.

## 2. Group repository

Each fantasy group owns one repository:

```text
Fantazone.<group-name>
```

It stores all group-specific canonical state: settings/members, baskets/leagues, rosters, formations, fantasy calendars/results/rankings, market data, Hall of Fame/history and finalized auction outcomes.

It also owns its executable maintenance entrypoints under `.github/workflows/`.

### Group-owned workflow

Fantazone currently manages:

```text
.github/workflows/fantazone-group.yml
```

Runtime v2 exposes:

- `recalculate-day`;
- `recalculate-all`;
- `set-next-formations`.

Execution topology:

```text
Fantazone.<group> workflow
        |
        +--> group/          own writable repository
        |
        +--> engine/         Fantazone @ group-runtime-vN
        |                    stable compatible code
        |
        +--> platform-data/  Fantazone @ current global-data ref
                             latest data/serie-a files
        |
        v
shared reducers/jobs
        |
        v
group/data/... updates
        |
        v
commit with the group's short-lived GITHUB_TOKEN
```

The central Fantazone repository therefore never needs a PAT for any group. Concurrent maintenance runs inside one group are serialized by workflow concurrency.

## Group creation from zero

The client can create a new group repository directly:

```text
create group
   -> GitHub createRepository(Fantazone.<normalized-name>)
   -> ensureGroupInitialized()
      -> create canonical bootstrap files
      -> install current group workflow
      -> record groupRuntimeVersion
   -> open group
```

New repositories are private by default and receive the first administrator directly in readable `config/group.json`.

## Bootstrap and managed upgrades

Application version and group runtime version are intentionally different concepts. UI-only releases do not need to rewrite every group repository.

`GROUP_REPOSITORY_RUNTIME_VERSION` advances only when a mandatory Fantazone-managed artifact changes. The installed version is recorded in `fantazone.json`.

Opening a selected/saved group runs the lightweight upgrade check before the normal session starts:

```text
open Fantazone.<group>
        |
        v
ensureGroupInitialized()
        |
        +--> current runtime/template -> zero writes
        |
        +--> outdated runtime/template
                -> SHA-update Fantazone-managed files only
                -> update runtime metadata last
        |
        v
normal GroupSessionRuntime
```

The updater may replace the known Fantazone-managed workflow path. It never overwrites existing canonical group data (`config/group.json`, `data/**`, existing `manifest.json`) and never touches custom workflows/files with other paths.

A workflow-write permission failure stops the upgrade and the runtime version is not advanced.

Full lifecycle/versioning rules: `docs/28-group-repository-lifecycle.md`.

## Stable engine, fresh shared data

Group business logic and global football data have different versioning requirements:

- engine code is pinned to `group-runtime-vN` so an existing group does not silently change behavior;
- shared football data remains current, currently from `main/data/**`.

Runtime v2 uses `group-runtime-v2` for code but a separate `platform-data` checkout for the latest votes/calendar. A future public `Fantazone.Data` repository can take over the live-data checkout.

## 3. User device

The Expo React Native/web client is the application runtime. It owns:

- Google/Microsoft human identity;
- V1 group credential;
- selected group/year/league state;
- GitHub REST reads/writes;
- group repository creation/bootstrap/managed-upgrade checks;
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
| native/web  |                           | state + own Actions  |
+------+------+                           +----------^-----------+
       |                                             |
       | WebRTC auction                              | own GITHUB_TOKEN
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
- Next-day formation propagation: **group Action**, never a platform job.
- Market/Hall-of-Fame persistence: **future group Actions/reducers**, not platform jobs.
- Auction bids: **WebRTC**, with GitHub only for durable/signaling state.

## External infrastructure that may remain

Zero backend means zero custom Fantazone application server, not zero Internet infrastructure:

- GitHub-hosted runners execute Actions;
- WebRTC may need STUN/TURN;
- push delivery may require Apple/Google/browser push infrastructure.

None of these hosts Fantazone's always-on application API or central group state.
