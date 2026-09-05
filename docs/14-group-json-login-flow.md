# Group JSON and group-first login flow

This migration locks two architectural decisions that are easy to blur together: where the data lives and when identity is established.

## 1. Storage changes; JSON does not

Legacy Fantasoccer stored `GroupRaw` through the repository framework. Fantazone stores that same raw object in GitHub at:

```text
config/group.json
```

The compact contract remains:

```text
GroupRaw
├── i  group id
├── n  group name
├── l  leagues + annual settings
├── u  users + role flags
└── b  baskets + yearly teams
```

`GitHubGroupRepository` maps this raw payload to the readable domain and maps it back on writes. Tests assert a raw → domain → raw round trip so a storage refactor cannot accidentally reshape persisted JSON.

Early Fantazone repositories may contain a temporary bootstrap object in `config/group.json`. The reader accepts it for compatibility. The next legitimate group update writes the canonical `GroupRaw` contract. New repositories start directly with `GroupRaw`.

The early `members/members.json` experiment is no longer created because it duplicates `GroupRaw.u` and could diverge.

## 2. PAT is group discovery, not application identity

The PAT answers: **which repositories/groups can this installation open?**

It does not answer: **which Fantazone user is using the app?**

The runtime sequence is therefore:

```text
PAT
 │
 ▼
GitHub validation
 │
 ▼
Fantazone.* repository discovery
 │
 ▼
SELECT GROUP
 │
 ▼
Google / Microsoft login
 │
 ▼
authenticated email
 │
 ▼
GitHubGroupRepository.findUserByEmail(email)
 │
 ├── missing / role None ──> access denied for this group
 │
 └── member ───────────────> authenticated GroupSession
```

An email can exist in group A and not in group B. Selecting another repository therefore changes the membership lookup and may require a new authorization decision even when the external Google/Microsoft identity is unchanged.

Email matching is normalized for casing/whitespace; the stored email itself is preserved unchanged in JSON.

## 3. Session boundary

Future UI providers should expose a selected-group session containing:

- PAT/repository connection;
- selected `Group` document;
- authenticated external identity;
- resolved `UserOfAGroup` and role flags;
- selected league/year UI state.

Calendar, Ranking, Team and other repositories receive only the repository target. Screens do not know about raw GitHub Contents API payloads, SHA or PAT headers.

## 4. Admin updates

Adding/removing a user, changing roles, editing leagues or editing baskets is one optimistic update of the same legacy Group JSON. The current GitHub content SHA protects against stale writes. We do not split the object into a different schema merely to make GitHub storage look more database-like.
