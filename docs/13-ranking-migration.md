# Ranking migration

Ranking is the second Fantasoccer repository service moved to the shared domain + GitHub persistence pattern.

## Legacy repositories

Fantasoccer used two Repository Framework stores:

```text
Rank       keyed by group + league + year
DailyRank  keyed by group + league + year + day
```

The service also mixed read helpers, write/update/delete operations and an authentication-dependent `getAvailableYearsForUser` convenience method.

## Fantazone canonical paths

A `Fantazone.<group>` repository already scopes the group, so canonical ranking documents only need league/season/day:

```text
data/groups/seasons/<season>/leagues/<league>/ranking.json
data/groups/seasons/<season>/leagues/<league>/days/<day>/ranking.json
```

`GitHubRankRepository` consumes these through `GitHubJsonStore`.

## Shared domain behavior

`@fantazone/domain` now owns the compact Rank/RankedTeam representation and Fantasoccer-compatible helpers:

- money + plusMoney = valueAssets;
- ranking by points;
- ranking by value assets;
- team position (1-based, `-1` when absent);
- goal difference;
- games played;
- points per game;
- rank/team enhancement;
- aggregate RankedTeam addition;
- compact raw serialization for canonical GitHub files.

## Read side and Action write side

The app normally reads canonical ranking files. Ranking calculation itself will eventually execute in per-group GitHub Actions. For that reason the repository adapter also exposes explicit season/daily write methods that serialize to the compact canonical representation and inherit SHA conflict handling from `GitHubJsonStore`.

This keeps calculation code independent of the GitHub Contents API and avoids building a second persistence implementation just for Actions.

## Intentional differences from the legacy service

- `group` is no longer part of every key because the repository is the group boundary.
- authentication/token lookup is not a responsibility of ranking domain code.
- `getAvailableYearsForUser` is not ported: available seasons should come from the repository manifest/config, not from the current wall-clock year or a backend user endpoint.
- delete is not exposed in the first adapter. Destructive canonical-data operations should be explicit administrative commands/repair workflows rather than a casual UI repository call.

## Next use

Calendar + Ranking are enough to build the first useful group Home surface: current fantasy day, compact standings, pending matches and links to detailed calendar/ranking views. The UI migration remains a separate slice so product components never need to know about GitHub SHA/base64 transport.
