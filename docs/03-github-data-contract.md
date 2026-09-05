# GitHub data contract

## Repository naming

One fantasy group maps to one `Fantazone.<group>` repository. The PAT is resolved before application login: validate PAT → discover repositories → select group → Google/Microsoft login → resolve the authenticated email inside that selected group's `group.users`.

The PAT grants repository access; it never establishes Fantazone user identity.

## Schema v2: readable JSON is canonical

Fantazone schema v2 removes the historical single-letter serialization layer. Canonical files persist the readable domain objects directly:

- `config/group.json` → `Group`
- league calendar → `Calendar`
- season/day ranking → `Rank`
- season/day team → `Team`
- future Live/Formation/Market/etc. documents follow the same rule.

There is no `GroupRaw`, `CalendarRaw`, `RankRaw`, `TeamRaw` or raw↔clean naming mapper in the canonical architecture.

Example `config/group.json`:

```json
{
  "id": "amici",
  "name": "Amici",
  "leagues": [],
  "users": [
    {
      "username": "Ale",
      "email": "ale@example.com",
      "role": 6
    }
  ],
  "baskets": []
}
```

`users` is the only canonical membership list. Do not create a parallel members table/file.

League settings also use full domain names (`startingMoney`, `pointForVictory`, `maxGoalKeepersInBench`, etc.). Names come from the original Fantasoccer domain properties, not guessed abbreviations.

## Schema version

New group repositories declare:

```json
{
  "schemaVersion": 2
}
```

Compact schema-v1 aggregate documents are intentionally not accepted through a permanent compatibility mapper. Existing compact repositories require a one-time migration to v2. This keeps one canonical format after migration.

## Invite links and public origin

The canonical web origin is:

```text
https://fanta.plus
```

V1 group invites carry their encoded connection payload in the URL fragment so it is not sent as part of the HTTP request. The fragment is not encryption: the PAT remains a bearer credential.

Importing an invite chooses a repository; Google/Microsoft login still follows.

## Group repository layout

```text
fantazone.json
manifest.json
config/
  group.json
data/
  serie-a/
  groups/
    seasons/<season>/leagues/<league>/calendar.json
    seasons/<season>/leagues/<league>/ranking.json
    seasons/<season>/leagues/<league>/days/<day>/ranking.json
    seasons/<season>/teams/<basket>/<email>.json
    seasons/<season>/days/<day>/teams/<basket>/<email>.json
    formations/
    results/
    market/
    hall-of-fame.json
commands/
events/
realtime/
assets/
```

## Manifest, caching and concurrency

Clients use the manifest, ETag/blob SHA and local cache to avoid re-reading every document. GitHub content SHA is the optimistic-concurrency version for mutable aggregate JSON.

Never silently overwrite a stale SHA. Actions and the app consume/write the same readable domain documents; there is no Action-specific compact serialization.

High-contention features may use append-only command/event files, but their projections should still use readable schema-v2 property names.
