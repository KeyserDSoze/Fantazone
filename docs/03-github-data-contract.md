# GitHub data contract

## Repository naming

A fantasy group maps to one repository whose logical name begins with `Fantazone.`.

Example:

```text
Fantazone.AmiciDelBar
Fantazone.Ufficio2026
```

The client discovers all repositories visible to the supplied token, filters names beginning with `Fantazone.`, and lets the user choose if more than one is available.

When creating/opening a named group the client first tries the exact normalized repository name `Fantazone.<groupName>`.

## V1 onboarding

Create/join flow:

1. user signs in to Fantazone with Google or Microsoft;
2. user enters a GitHub PAT;
3. client validates the token with GitHub;
4. client lists repositories accessible to that PAT;
5. client resolves one or more `Fantazone.*` repositories;
6. if the selected repository is uninitialized, the client writes the Fantazone manifest/layout;
7. the selected group and PAT are stored locally.

PAT permissions must be the minimum required for the group repository. The architecture must not assume the token can administer unrelated repositories.

## Invite links and QR codes

Do **not** place a raw PAT in a normal query string: URLs can leak through browser history, analytics, proxy logs and referrers.

V1 sharing should use a URL fragment, which is not sent to the static web host:

```text
https://fantazone.example/#join=<base64url-payload>
```

Payload:

```json
{
  "v": 1,
  "group": "AmiciDelBar",
  "repository": "Fantazone.AmiciDelBar",
  "pat": "github_pat_..."
}
```

On import the app must immediately persist the credential and remove the fragment from the visible URL with `history.replaceState`. QR codes contain the same invite URL. This is still a shared bearer credential; token rotation remains necessary when membership changes.

## Proposed group repository layout

```text
fantazone.json
config/
  group.json
  competitions.json
  rules.json
members/
  members.json
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
    seasons/<season>/teams/
    seasons/<season>/formations/
    seasons/<season>/results/
    seasons/<season>/rankings/
    market/
    hall-of-fame.json
commands/
  <yyyy-mm-dd>/<uuid>.json
events/
  <yyyy-mm-dd>/<uuid>.json
realtime/
  auctions/<auctionId>/signaling/
assets/
manifest.json
```

## Manifest

Clients poll one small file instead of every resource:

```json
{
  "schemaVersion": 1,
  "revision": 42,
  "updatedAt": "2026-09-04T21:00:00Z",
  "season": 2026,
  "liveDay": 3
}
```

Use `ETag`/conditional GET and the Git blob SHA. When `revision` changes, reload only affected resources.

## Concurrency

Never have many clients repeatedly overwrite one large JSON document.

Prefer:

- append-only command/event files with UUID paths;
- one file per team/day/entity;
- optimistic updates using the current GitHub content SHA;
- retry/rebase after `409 Conflict` only when the operation is safe/idempotent;
- Actions or deterministic reducers for derived aggregate files.

## Static content

Images and other immutable content formerly in Azure Blob Storage should live under `assets/` or a dedicated content repository and be loaded using raw GitHub URLs pinned to an appropriate branch/revision. Large/binary growth must be monitored separately from JSON state.
