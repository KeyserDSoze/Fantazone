# Team migration

Team season/day state is stored under:

```text
data/groups/seasons/<season>/teams/<basket>/<email>.json
data/groups/seasons/<season>/days/<day>/teams/<basket>/<email>.json
```

The selected repository supplies group scope. Email casing in the path is preserved from the selected member/team key.

## Schema v2

The JSON file is `Team` directly:

```json
{
  "name": "Alpha",
  "owner": "ale@example.com",
  "additionalOwners": [],
  "players": [],
  "moneyFromRank": 0,
  "lastUpdate": "2026-09-05T07:00:00.000Z"
}
```

Players use full fields such as `name`, `team.name`, `team.abbreviation`, `role`, `isActive`, `visible`, `price`, `revenue`, `status` and `position`.

`lastUpdate` remains an ISO-8601 string in the persisted/domain object; `TeamHelper.getLastUpdateDate()` converts it only when Date operations are needed.

## Preserved helpers

- player status and fantasy-position semantics;
- active/role filters;
- total cost and sale revenue;
- half/no-return calculations;
- net cost;
- ranking-derived money formula.

`GitHubTeamRepository` and `GitHubRankRepository` share the same store in `GroupSessionRuntime`. Reads/writes use the readable Team document with GitHub SHA optimistic concurrency.
