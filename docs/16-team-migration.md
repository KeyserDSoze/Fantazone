# Team migration

Team is the third Fantasoccer feature repository migrated after Calendar and Ranking.

## Persisted contract

The storage backend changes, the JSON contract does not. Season teams and day/lineup teams still store the legacy compact `TeamRaw` payload:

```text
TeamRaw
├── n  team name
├── o  owner email
├── a  additional owners (optional/null)
├── p  PlayerRaw[]
├── m  moneyFromRank
└── d  last-update ISO date (optional/null)
```

Each `PlayerRaw` keeps the legacy player, real-team, role, status, position, price and revenue fields. `RealTeamRaw` remains `{ n, a }`.

The clean `Team` object retains a defensive copy of the original raw document. This lets reverse mapping preserve distinctions such as `a: null` versus `a: []`, and `d: null` versus an omitted `d`, instead of creating noisy Git diffs during a storage-only migration.

## Repository scope and paths

Legacy Team keys contained group + year + basket + email. The selected `Fantazone.<group>` repository already scopes the group, so the remaining key components become GitHub paths:

```text
data/groups/seasons/<season>/teams/<basket>/<email>.json
data/groups/seasons/<season>/days/<day>/teams/<basket>/<email>.json
```

Email casing is not normalized in the path. Normal authentication resolves a member first and then uses the email stored in `GroupRaw.u`, preserving the legacy key value.

## Legacy helpers

The domain migration preserves:

- active/sold/removed player status semantics;
- fantasy-position → main-role mapping;
- player filtering by role;
- total cost;
- sale revenue;
- half-return and no-return sale calculations;
- net/cost formula;
- season/day team key helpers;
- raw ↔ clean mappings.

## Ranking integration

Legacy `TeamService` could derive `moneyFromRank` when the stored value was zero:

```text
ranked goals * MoneyForGoal
+ ranked suffered goals * MoneyForSufferedGoal
```

`GitHubTeamRepository` preserves this behavior when it is composed with the selected group's `GitHubRankRepository`. `GroupSessionRuntime` creates them around the same `GitHubJsonStore`, so the relationship no longer depends on a global frontend service or backend API.

## Writes

Season and day writes serialize back to the same compact `TeamRaw` contract and inherit SHA optimistic concurrency from `GitHubJsonStore`. This makes the same adapter usable later by market/formation flows and GitHub Actions without introducing another persistence format.
