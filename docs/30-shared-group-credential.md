# Shared group GitHub credential

Fantazone deliberately has no trusted application backend. Participants authenticate with Microsoft, while each `Fantazone.<group>` repository remains the group's canonical storage and automation host.

Because participants are not required to own a GitHub account, repository access uses one GitHub PAT shared by the group. This is an explicit zero-backend tradeoff: every client that can use the group can also access that PAT.

## Persistence

For each Microsoft user, `settings.json` in the OneDrive app root stores:

```json
{
  "version": 2,
  "groups": [
    {
      "id": "...",
      "name": "Amici",
      "repository": "owner/Fantazone.Amici",
      "pat": "github_pat_..."
    }
  ]
}
```

The same PAT is cached locally as a convenience/fallback:

- web: localStorage, namespaced by Microsoft identity;
- native: Expo SecureStore, namespaced by Microsoft identity.

OneDrive is the synchronized source for the group credential. A legacy v1 settings catalog without PAT is upgraded lazily: a still-valid local PAT is promoted to OneDrive after the first successful group open, otherwise the user is asked for the current shared group PAT.

## Invitations

New invite payloads are v3 and contain:

- group name;
- exact `owner/repo`;
- invited Microsoft email;
- shared group PAT.

The invite URL is therefore a credential and must be shared privately. On web, fanta.plus removes the URL fragment immediately after parsing it, keeps the pending invite only in sessionStorage across the Microsoft OAuth redirect, and clears it after join/cancel.

Older secret-free v2 invitations remain readable. They ask the participant for the shared group PAT once, then store it in OneDrive and locally.

## Repository preflight

Before an existing group credential is accepted, the app checks:

1. GitHub token authentication;
2. exact `owner/repo` lookup, with no fallback to another `Fantazone.*` repository;
3. repository `pull` permission;
4. repository `push` permission;
5. readable and valid `manifest.json`;
6. readable and valid `config/group.json`.

`ensureGroupInitialized()` then runs before persistence. If the group runtime must be installed/upgraded, that operation is the real check that the PAT can modify the managed workflow. The credential is not saved as usable until runtime opening and Microsoft membership authorization succeed.

## Security boundary

This design preserves functional authorization in the app and canonical/concurrency checks in GitHub Actions, but it is not a per-user server-side security boundary. A participant who extracts the shared PAT can call GitHub directly with the permissions granted to that PAT.

For that reason:

- use a dedicated PAT for Fantazone group repositories;
- grant only the repository permissions Fantazone needs;
- rotate the PAT if an invite link is exposed or a participant should lose repository-level access;
- treat invite links as secrets.

This is the accepted tradeoff for keeping Fantazone fully zero-backend.
