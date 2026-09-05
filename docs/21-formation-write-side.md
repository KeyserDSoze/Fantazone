# Formation write-side

Fantazone replaces `Game/SaveTeam` with a local application service plus a GitHub JSON write. There is no formation API and no separate `formation.json`.

## Canonical document

A submitted formation is persisted as the existing readable `Team` document for the selected Serie A day:

```text
data/groups/seasons/<year>/days/<serieADay>/teams/<basket>/<owner>.json
```

If that day document does not exist yet, the season Team is read as a template and the day file is created. The season Team is never mutated just because a formation was submitted.

## Narrow write contract

The client does not submit a mutable Team object and no longer submits timing context. It sends only deterministic player keys, requested `position` values and the explicit `asAdmin` intent. The writer then:

1. refreshes `config/group.json` and rechecks the authenticated member;
2. composes the selected game and derives editability from the shared global RealCalendar;
3. checks the requested owner belongs to the selected game;
4. verifies owner/additional-owner permission, or an explicit SuperAdmin override;
5. rejects a locked day unless RealCalendar itself says that selected day is currently live and the actor is SuperAdmin;
6. reloads TeamDay, falling back to the season Team only when TeamDay does not exist;
7. copies only formation positions onto active players already present in that fresh document;
8. runs the shared port of `TeamChecker.Validate`;
9. writes TeamDay with the exact Git blob SHA, or `createOnly` when creating the day document.

This preserves the important legacy protection in `GameController.SaveTeamAsync`: prices, roster membership, owner, player status, revenue and other fields cannot be replaced by a client formation payload.

`nextSerieADay` and `liveSerieADay` are no longer accepted from the UI. They are projections of platform-owned Serie A data.

## Concurrency

Existing TeamDay writes pass its freshly-read SHA. Creating a TeamDay uses `createOnly`. A competing write becomes `RepositoryWriteConflictError`, including the GitHub `422` race where two clients try to create the same day file at once.

## Google login

The Google adapter remains in source code, but product login is disabled by default through `EXPO_PUBLIC_GOOGLE_LOGIN_ENABLED=false`. Re-enabling it later requires both that flag and `EXPO_PUBLIC_GOOGLE_CLIENT_ID`; Microsoft remains the active provider meanwhile.
