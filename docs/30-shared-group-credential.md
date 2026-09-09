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

OneDrive is the synchronized source for the group credential. Settings catalogs without PAT are upgraded lazily: a still-valid local PAT is promoted to OneDrive after the first successful group open, otherwise the user is asked for the current shared group PAT.

## Invitations

Fantazone supports **one current invitation envelope** with two access modes. There is no invite schema/version switch and obsolete invitation shapes are intentionally not decoded.

Admin and SuperAdmin users create both modes from the dedicated **Condividi gruppo** page.

### Personal invitation by email

This mode is appropriate when the administrator wants to address one precise Microsoft identity.

Fantazone:

1. censuses the target email as Participant if it is not already present;
2. generates a random 160-bit unlock code;
3. generates a random 128-bit salt;
4. derives the AES-256 key from that code with PBKDF2-HMAC-SHA-256;
5. encrypts the shared PAT with AES-256-GCM;
6. creates a link bound to that Microsoft email.

If the email is already an active member, issuing another personal invitation does not rewrite `group.json`. A deliberately disabled member may only be re-enabled by an administrator-managed personal census, never by the generic password flow below.

The administrator sends two values separately: the encrypted link and the random unlock code. Microsoft login must match the email embedded in the invitation.

### Generic invitation with a shared password

This mode is designed for groups where the administrator does not want to census every email in advance.

The administrator chooses a password of at least 16 characters or asks Fantazone to generate a high-entropy password. Fantazone then:

1. generates a random 128-bit salt;
2. derives the AES-256 key from the shared password with PBKDF2-HMAC-SHA-256;
3. encrypts the same group PAT with AES-256-GCM;
4. creates one reusable invitation link with **no Microsoft email inside it**.

The administrator can distribute the same link and password to multiple people. Every recipient still authenticates with Microsoft. After the password decrypts a valid PAT for the exact repository:

- an existing active member enters normally;
- an unknown Microsoft email is added automatically to `group.users` as `Participant`;
- an account already present with `IdentityRole.None` is rejected and is not automatically reactivated;
- the generic flow can never create Admin or SuperAdmin users.

Concurrent first joins and administrator census writes re-read the canonical group document and retry optimistic GitHub conflicts rather than blindly overwriting another change.

### Encrypted envelope

Both modes use the same current envelope. The URL fragment contains:

- invitation mode (`email` or `shared`);
- current group display name;
- exact `owner/repository`;
- invited Microsoft email only in personal mode;
- random salt and PBKDF2 work factor;
- the group PAT encrypted with AES-256-GCM.

It does **not** contain the PAT plaintext, the AES key, the personal unlock code, or the shared password.

Mode, group, repository, optional email, salt and work factor are AES-GCM additional authenticated data (AAD). Changing any of those fields makes decryption fail.

Fantazone currently uses PBKDF2-HMAC-SHA-256 with 120,000 iterations. WebCrypto is used where available; native runtimes use an equivalent portable implementation so the same invitation can be created or opened across web, iOS and Android.

On web, fanta.plus removes the URL fragment immediately after parsing it. `sessionStorage` keeps only the encrypted envelope across the Microsoft OAuth redirect. Neither the personal unlock code nor the shared password is persisted alongside the ciphertext.

After successful decryption, the PAT is verified against the exact repository before the credential is persisted in the participant's private OneDrive app settings and local credential cache.

## Reuse and revocation

A personal unlock code is generated once per invitation and Fantazone does not save it. Because there is no trusted backend, however, it is not a server-enforced one-time token: somebody retaining both link and code can repeat the decryption while the shared PAT remains valid.

A generic password invitation is intentionally reusable. Anybody possessing both the link and the password can attempt Microsoft-authenticated enrollment until one of those factors or the underlying PAT is changed.

Application membership revocation and repository-level revocation are different boundaries:

- setting a member role to `None` prevents that Microsoft account from re-entering through the generic invitation;
- replacing the generic link/password prevents future users who know only the old pair from decrypting a newly generated invitation, but does not revoke a PAT they may already have obtained;
- rotating the dedicated GitHub PAT is required for strong repository-level revocation after the credential itself may have been exposed.

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

Canonical app writes use a two-phase `manifest.json` revision. A race while starting a write remains a real failure, but once the canonical document has already been committed, a later race while publishing `updating:false` is no longer reported to the UI as if the document itself had failed. The repository remains conservatively marked updating until a later successful transition.

The real integration suite validates these capabilities against `Fantazone.Test`; a token with Contents write but without Workflows write can mutate league data but deliberately fails runtime bootstrap.

## Security boundary

This design preserves functional authorization in the app and canonical/concurrency checks in GitHub Actions, but it is not a per-user server-side security boundary. A participant who extracts the shared PAT can call GitHub directly with the permissions granted to that PAT.

For that reason:

- use a dedicated fine-grained PAT for each Fantazone group repository;
- scope it only to that repository;
- grant only the repository permissions Fantazone needs;
- deliver the link and its out-of-band code/password separately;
- use a strong generated password for generic invitations when practical;
- disable users in Fantazone when their application access should stop;
- rotate the PAT if the shared repository credential may have been exposed or repository-level access must be revoked.

This is the accepted tradeoff for keeping Fantazone fully zero-backend.
