# fanta.plus login, user settings and branding

## Entry flow

The application is Microsoft-login first. After OAuth completes, fanta.plus reads `settings.json` from the Microsoft Graph OneDrive App Folder. If the file does not exist, it is created with an empty group list and the UI immediately shows the first-group creation flow.

## User settings

The OneDrive document is deliberately small and portable:

```json
{
  "version": 1,
  "groups": [
    {
      "id": "...",
      "name": "Amici del Bar",
      "repository": "owner/Fantazone.AmiciDelBar"
    }
  ]
}
```

The GitHub credential is **not** synchronized in clear text through OneDrive. It remains device-local through the existing credential storage adapter; native builds use Expo SecureStore, while the current web build keeps browser-local storage behavior. A new device therefore knows which groups exist but asks for the GitHub credential once before opening a group.

Repository credentials are namespaced by the authenticated application identity (`provider + subject`). Switching Microsoft accounts on the same device does not automatically reuse the previous account's PAT map. Legacy unscoped PAT storage is purged the first time a repository credential is saved under the new identity-scoped model.

This is an intentional security correction to the initial idea of putting the PAT directly inside `settings.json`: the group catalog is cloud-synced, the secret is not.

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
