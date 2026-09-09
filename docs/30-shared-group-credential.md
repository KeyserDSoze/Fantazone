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
  "version": 3,
  "groups": [
    {
      "id": "...",
      "name": "Amici del Bar",
      "repository": "owner/lega-2026",
      "pat": "github_pat_...",
      "isDefault": true
    }
  ]
}
```

The OneDrive `name` is a synchronized convenience/last-known display label for the group picker. When the repository is opened, the authoritative display override is the group repository's own root `settings.json`; stable storage is always addressed by `repository` and stable IDs, not by the display name.

The same PAT is cached locally as a convenience/fallback:

- web: localStorage, namespaced by Microsoft identity;
- native: Expo SecureStore, namespaced by Microsoft identity.

OneDrive is the synchronized source for the group credential. Legacy settings catalogs without PAT are upgraded lazily: a still-valid local PAT is promoted to OneDrive after the first successful group open, otherwise the user is asked for the current shared group PAT.

## Invitations

Current share links use an external **v4 encrypted envelope**. Admin and SuperAdmin users can create them from the dedicated **Condividi gruppo** page or from group settings.

The envelope contains, in the URL fragment:

- current group display name;
- exact `owner/repository`;
- invited Microsoft email;
- the group PAT encrypted with **AES-256-GCM**;
- the AES key required to decrypt that PAT.

Group, repository and invited email are passed as AES-GCM additional authenticated data (AAD), so changing those fields makes decryption fail. The PAT itself is not present as plaintext in the URL representation.

Fantazone is intentionally zero-backend and has no recipient public-key infrastructure. The link therefore has to be self-contained: the decryption key travels in the same URL fragment. **This means the full link is still a bearer credential.** Anyone who obtains the complete link has enough information to decrypt and use the group PAT. Encryption prevents the PAT from appearing directly as plaintext and gives authenticated/tamper-evident packaging; it does not make a leaked full link harmless.

On web, fanta.plus removes the URL fragment immediately after parsing/decrypting it, keeps the pending invite only in `sessionStorage` across the Microsoft OAuth redirect, and clears it after join/cancel. The invited Microsoft email must match the authenticated identity before the repository credential is accepted.

Older invitations remain readable:

- v3 links carried the shared PAT directly inside a base64url-encoded fragment;
- v2 links were secret-free and ask the participant for the shared group PAT once;
- legacy v1 links are normalized into one of those flows when possible.

After a successful join the PAT is verified against the exact repository, membership is verified against the Microsoft identity, and the credential is stored in the participant's private OneDrive app settings and local credential cache.

## Browser routing and refresh

The web application uses History API routes instead of keeping every screen at `/`. Group pages are represented as:

- `/groups/<stored-group-id>/<page>`;
- `/groups/<stored-group-id>/<page>/game/<game-id>` for an opened match;
- `/join` for invite entry;
- `/architecture` for the architecture overview.

GitHub Pages publishes `index.html` also as `404.html`, so a direct request or F5 on one of these paths boots the SPA and restores the requested route. The group id in the URL is the per-user stable id stored in that Microsoft user's OneDrive catalog; it does not expose the PAT or GitHub repository name.

League and season context remain a separate local preference, namespaced by Microsoft identity and group, and are restored together with the routed page.

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
- share invite links only through a private channel and only with the intended participant;
- rotate the PAT if an invite link is exposed or a participant should lose repository-level access;
- treat invite links as secrets even though the PAT inside current v4 links is encrypted.

This is the accepted tradeoff for keeping Fantazone fully zero-backend.
