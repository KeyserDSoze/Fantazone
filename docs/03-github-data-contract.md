# GitHub data contract

## Repository naming

A fantasy group maps to one repository whose logical name begins with `Fantazone.`.

```text
Fantazone.AmiciDelBar
Fantazone.Ufficio2026
```

The PAT is resolved **before application login**. The client validates the PAT, discovers the visible `Fantazone.*` repositories and lets the user choose the group repository. Only after a group has been selected does Fantazone start Google/Microsoft login.

## Onboarding and login order

The order is intentionally different from legacy Fantasoccer:

1. enter/import the GitHub PAT;
2. validate the PAT against GitHub;
3. discover accessible `Fantazone.*` repositories;
4. choose exactly which group repository to enter;
5. persist the selected group connection locally;
6. start Google or Microsoft login;
7. take the authenticated email and look it up in **that selected group's JSON**;
8. continue only if the user exists in the selected group and its role allows access.

The login provider proves the external identity. Membership and Fantazone roles come from the selected group's repository, not from a central backend and not from the PAT owner.

## Preserve the legacy JSON contracts

Moving from Azure/blob storage to GitHub is a storage migration, not a domain-schema redesign.

Canonical files must continue to store the same compact raw JSON contracts used by Fantasoccer. Examples:

- Group: `GroupRaw` (`i`, `n`, `l`, `u`, `b`)
- Calendar: `CalendarRaw`
- Ranking: `RankRaw`
- future Team/Live/Formation/etc. files: preserve their legacy raw contracts too

Application code maps raw compact JSON to readable TypeScript domain objects exactly as before. GitHub paths, SHA handling and caching belong outside the domain model.

### Group JSON

`config/group.json` is the old `GroupRaw` payload itself:

```json
{
  "i": "amici",
  "n": "Amici",
  "l": [],
  "u": [],
  "b": []
}
```

`u` is the canonical group membership list. Do not maintain a second `members.json` copy. Repositories created by an early Fantazone prototype that already contain `members/members.json` may keep that historical file, but runtime code must not use it as another source of truth.

## Invite links and QR codes

Do **not** place a raw PAT in a normal query string: URLs can leak through browser history, analytics, proxy logs and referrers.

V1 sharing uses a URL fragment, which is not sent to the static web host:

```text
https://fantazone.example/#join=<base64url-payload>
```

The imported connection selects the repository first. It does **not** authenticate a Fantazone user. Google/Microsoft login still follows and membership is checked against `config/group.json`.

The fragment is transport obfuscation, not encryption. V1 shared PATs remain bearer credentials and should be fine-grained, repository-scoped and rotatable.

## Group repository layout

```text
fantazone.json
manifest.json
config/
  group.json                 # exact legacy GroupRaw JSON
data/
  serie-a/
    seasons/<season>/calendar.json
    seasons/<season>/players.json
    seasons/<season>/teams.json
    seasons/<season>/days/<day>/live.json
    seasons/<season>/days/<day>/votes.json
    player-images/
    odds/
  groups/
    seasons/<season>/leagues/<league>/calendar.json
    seasons/<season>/leagues/<league>/ranking.json
    seasons/<season>/leagues/<league>/days/<day>/ranking.json
    seasons/<season>/teams/
    seasons/<season>/formations/
    seasons/<season>/results/
    market/
    hall-of-fame.json
commands/
  <yyyy-mm-dd>/<uuid>.json
events/
  <yyyy-mm-dd>/<uuid>.json
realtime/
  auctions/<auctionId>/signaling/
assets/
```

Paths may evolve as old repositories are migrated, but the JSON payload for a migrated legacy repository type must not be silently replaced by a new normalized schema.

## Manifest

Clients poll one small file instead of every resource:

```json
{
  "schemaVersion": 1,
  "revision": 42,
  "updatedAt": "2026-09-05T06:00:00Z",
  "season": 2026,
  "liveDay": 3
}
```

Use `ETag`/conditional GET and the Git blob SHA. When `revision` changes, reload only affected resources.

## Concurrency

For legacy aggregate JSON files, preserve their payload while using GitHub SHA as the optimistic concurrency version. Where a new high-contention feature needs commands/events, append-only files may be added around the canonical legacy projection instead of changing the projection's JSON shape.

Never silently overwrite a stale SHA. Reducer/Action outputs should be deterministic and write the same compact raw contracts consumed by the app.

## Static content

Images and other immutable content formerly in Azure Blob Storage should live under `assets/` or a dedicated content repository and be loaded using GitHub/static URLs. Large/binary growth is monitored separately from JSON state.
