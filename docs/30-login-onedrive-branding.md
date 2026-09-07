# fanta.plus login, user settings and branding

## Entry flow

The application is Microsoft-login first. After OAuth completes, fanta.plus reads `settings.json` from the Microsoft Graph OneDrive App Folder. If the file does not exist, it is created with an empty group list and the UI immediately shows the first-group creation flow.

## User settings

The OneDrive document is deliberately small and portable. Schema v2 stores the selected repository together with the shared group GitHub credential, by product design:

```json
{
  "version": 2,
  "groups": [
    {
      "id": "...",
      "name": "Amici del Bar",
      "repository": "owner/Fantazone.AmiciDelBar",
      "pat": "github_pat_..."
    }
  ]
}
```

The PAT is the same shared group credential used by the browser/native client to access that exact repository. This is an explicit zero-backend trade-off: participants who can use the group can inspect the client-visible credential, so frontend and Actions enforce product rules but the PAT is not a cryptographic per-user authorization boundary.

OneDrive App Folder is the cross-device source for the group catalog and its shared PAT. The credential is also cached locally so normal reconnect does not require another cloud read. Legacy v1 settings contained only `id`, `name` and `repository`; after one successful reconnect with an available local/invite credential, the app upgrades the entry to v2 and persists the PAT in OneDrive.

Repository credentials cached locally remain namespaced by the authenticated application identity (`provider + subject`). Switching Microsoft accounts on the same device does not automatically reuse another account's local PAT map. The OneDrive copy remains scoped to the Microsoft account whose App Folder is being read.

## Microsoft permission and session lifetime

The PKCE login requests `Files.ReadWrite.AppFolder` plus OpenID profile/email scopes and `offline_access`. The Graph adapter only accesses the app-specific OneDrive folder and stores `settings.json` there.

Web keeps the existing SPA callback on `https://fanta.plus`. iOS and Android use the same authorization-code + PKCE protocol through the system authentication browser and return to the Expo deep link `fantaplus://auth`. The native redirect can be overridden at build time with `EXPO_PUBLIC_MICROSOFT_NATIVE_REDIRECT_URI`, but the configured URI must match the Microsoft Entra app registration exactly.

The initial flow validates `state`, ID-token audience/nonce/expiry and PKCE. Access tokens are refreshed before expiry. A rotated refresh token replaces the previous one when Microsoft returns it.

Session persistence is deliberately platform-specific:

- **iOS/Android:** only the Microsoft refresh token is persisted in Expo SecureStore. App startup silently exchanges it for a fresh access token, reads the Microsoft OIDC profile again, and only then loads OneDrive settings. Access tokens and copied profile claims are not persisted as the source of truth.
- **Web/PWA:** refresh material stays in memory only. Reloading the page still requires a new Microsoft provider proof; no Microsoft identity session is trusted from persistent browser storage.
- **Logout/account switch:** native logout deletes the stored refresh token. A new authorization request uses `prompt=select_account`, so the next login can explicitly choose another Microsoft account.

If a running session cannot refresh, fanta.plus retries while the current access token is still valid. Once the token is actually expired, the group runtime is closed and the app returns to Microsoft login rather than continuing indefinitely with a stale human identity.

### Entra registration required for native builds

The Microsoft application registration must expose the native redirect as a **Mobile and desktop application** redirect URI and allow public-client authorization-code + PKCE. For the current build contract the URI is:

```text
fantaplus://auth
```

Until that URI is registered in Microsoft Entra, the native application code is complete but a real device login will be rejected by Entra with a redirect-URI mismatch. This is an external app-registration setting and is not stored in this repository.

## Branding

The product display name is `fanta.plus`. The supplied black/yellow hornet-football artwork is the visual source for the installed launcher assets:

- `src/app/assets/icon.png` for the Expo/iOS application icon;
- `src/app/assets/adaptive-icon.png` as the Android adaptive foreground over `#FFD100`;
- `src/app/assets/favicon.png` for the web build;
- `src/app/public/apple-touch-icon.png` and `src/app/public/favicon.png` for static web consumers;
- `src/app/public/brand/logo.svg` for the login wordmark.

`app.json` wires the icon, iOS icon, Android adaptive icon and web favicon so Expo produces the correct platform metadata from one checked-in brand set. The app scheme is `fantaplus`, which is also the callback scheme used by native Microsoft authentication.
