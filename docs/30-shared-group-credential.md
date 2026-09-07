# Shared group GitHub credential

Fantazone deliberately has no trusted application backend. Participants authenticate with Microsoft, while each user-selected GitHub repository is the group's canonical storage and automation host.

The GitHub repository may have any valid name. `Fantazone.<group>` is only a legacy/convenience convention: the repository full name is a storage locator, while the human-facing group and league names live in the repository root `settings.json` and can change independently.

Because participants are not required to own a GitHub account, repository access uses one GitHub PAT shared by the group. This is an explicit zero-backend tradeoff: every client that can use the group can also access that PAT.

## Recommended first setup

Create the repository **before** creating the PAT. This allows the fine-grained token to be restricted to exactly that one repository.

1. Create a GitHub repository. Private is recommended; choose any GitHub repository name.
2. Create a **Fine-grained personal access token**.
3. Under Repository access, select only the group repository.
4. Grant repository `Contents: Read and write`.
5. Grant repository `Workflows: Read and write`.
6. Grant repository `Actions: Read and write`.
7. In Fantazone enter the exact `owner/repository`, the PAT, the display name of the group and the Microsoft email of the first administrator.

`Contents` covers canonical JSON and normal repository writes. `Workflows` is required to install/upgrade Fantazone-managed files under `.github/workflows/`. `Actions` is required for manual workflow dispatch and Actions run/log operations. Metadata read access is supplied by GitHub automatically.

The group-creation screen links directly to GitHub's repository-creation and fine-grained-PAT screens and shows these permissions before initialization.

## Persistence

For each Microsoft user, `settings.json` in the OneDrive app root stores the repositories known to that user:

```json
{
  "version": 2,
  "groups": [
    {
      "id": "...",
      "name": "Amici del Bar",
      "repository": "owner/lega-2026",
      "pat": "github_pat_..."
    }
  ]
}
```

The OneDrive `name` is a synchronized convenience/last-known display label for the group picker. When the repository is opened, the authoritative display override is the group repository's own root `settings.json`; stable storage is always addressed by `repository` and stable IDs, not by the display name.

The same PAT is cached locally as a convenience/fallback:

- web: localStorage, namespaced by Microsoft identity;
- native: Expo SecureStore, namespaced by Microsoft identity.

OneDrive is the synchronized source for the group credential. A legacy v1 settings catalog without PAT is upgraded lazily: a still-valid local PAT is promoted to OneDrive after the first successful group open, otherwise the user is asked for the current shared group PAT.

## Invitations

New invite payloads are v3 and contain:

- current group display name;
- exact `owner/repository`;
- invited Microsoft email;
- shared group PAT.

The invite URL is therefore a credential and must be shared privately. On web, fanta.plus removes the URL fragment immediately after parsing it, keeps the pending invite only in sessionStorage across the Microsoft OAuth redirect, and clears it after join/cancel.

Older secret-free v2 invitations remain readable. They ask the participant for the shared group PAT once, then store it in OneDrive and locally.

## Repository preflight

Before an existing group credential is accepted, the app checks:

1. GitHub token authentication;
2. exact `owner/repository` lookup, with no naming-convention fallback;
3. repository `pull` permission;
4. repository `push` permission;
5. readable and valid `manifest.json`;
6. readable and valid `config/group.json`.

`ensureGroupInitialized()` then runs before persistence. It create-only initializes canonical files including root `settings.json`, and installs/upgrades only Fantazone-managed workflow/runtime files. If the runtime must be installed/upgraded, that operation is the real check that the PAT can modify managed workflows. The credential is not saved as usable until runtime opening and Microsoft membership authorization succeed.

The real integration suite validates these capabilities against `Fantazone.Test`; a token with Contents write but without Workflows write can mutate league data but deliberately fails runtime bootstrap.

## Security boundary

This design preserves functional authorization in the app and canonical/concurrency checks in GitHub Actions, but it is not a per-user server-side security boundary. A participant who extracts the shared PAT can call GitHub directly with the permissions granted to that PAT.

For that reason:

- use a dedicated fine-grained PAT for each Fantazone group repository;
- scope it only to that repository;
- grant only the repository permissions Fantazone needs;
- rotate the PAT if an invite link is exposed or a participant should lose repository-level access;
- treat invite links as secrets.

This is the accepted tradeoff for keeping Fantazone fully zero-backend.
