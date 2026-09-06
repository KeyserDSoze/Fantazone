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

The GitHub credential is **not** synchronized in clear text through OneDrive. It remains device-local through the existing credential storage adapter; native builds use Expo SecureStore, while the current web build keeps the established browser storage behavior. A new device therefore knows which groups exist but asks for the GitHub credential once before opening a group.

This is an intentional security correction to the initial idea of putting the PAT directly inside `settings.json`: the group catalog is cloud-synced, the secret is not.

## Microsoft permission

The PKCE login requests `Files.ReadWrite.AppFolder` in addition to OpenID profile/email scopes. The Graph adapter only accesses the app-specific OneDrive folder and stores `settings.json` there.

Web keeps the existing SPA callback on `https://fanta.plus`. iOS and Android now use the same authorization-code + PKCE protocol through the system authentication browser and return to the Expo deep link `fantaplus://auth`. The native redirect can be overridden at build time with `EXPO_PUBLIC_MICROSOFT_NATIVE_REDIRECT_URI`, but the configured URI must match the Microsoft Entra app registration exactly.

The native flow validates `state`, validates the ID-token audience/nonce/expiry, exchanges the code with the same redirect URI and PKCE verifier, and then reads the Microsoft OIDC user profile before OneDrive settings are opened.

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
