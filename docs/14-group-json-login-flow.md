# Group JSON and group-first login flow

## 1. Readable Group is persisted directly

Schema v2 stores `Group` at:

```text
config/group.json
```

```json
{
  "id": "amici",
  "name": "Amici",
  "leagues": [],
  "users": [],
  "baskets": []
}
```

There is no second compact Group representation and no `members.json`. `users` is the source of truth for membership and role flags.

## 2. PAT is repository discovery, not human identity

```text
PAT
 ↓
GitHub validation
 ↓
Fantazone.* repository discovery
 ↓
SELECT GROUP
 ↓
load config/group.json
 ↓
Google / Microsoft login
 ↓
authenticated email
 ↓
Group.users lookup
 ├─ missing / role None → access denied
 └─ member              → authenticated GroupSession
```

Email comparison is normalized for case/whitespace; the stored email value is not rewritten merely by logging in.

## 3. Session boundary

A future authenticated session contains the selected repository connection, loaded Group, external identity, resolved `UserOfAGroup`, role flags and local league/year selection.

Feature repositories receive the repository target and shared store; screens never handle PAT headers, GitHub base64 responses or SHA details.

## 4. Admin updates

Adding/removing users, editing roles/leagues/baskets writes the same readable Group document using optimistic SHA concurrency.
