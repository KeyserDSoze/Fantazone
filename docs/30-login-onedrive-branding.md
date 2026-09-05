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

## Branding

The product display name is now `fanta.plus`, with the black/yellow hornet-football brand mark under `src/app/public/brand/`. The supplied raster artwork remains the visual source of truth for the final native launcher icon set; native PNG launcher assets are tracked as a follow-up because GitHub's text contents API cannot safely upload the supplied binary files from this chat connection.

## Native auth follow-up

The current Microsoft OAuth adapter remains web-oriented (`https://fanta.plus` redirect). Expo configuration now declares the `fantaplus` scheme; iOS/Android deep-link OAuth wiring must be completed before native Microsoft login is considered production-ready.
