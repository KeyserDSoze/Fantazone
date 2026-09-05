# Web OAuth and group invitations

Fantazone on `https://fanta.plus` uses a two-boundary login:

1. GitHub credential opens exactly one group repository.
2. Google or Microsoft proves the human identity and its email must be present in `config/group.json -> users`.

An invite may add a third constraint: the provider email must also match the invite recipient email.

## Microsoft

Public client id: `fc83d630-7c49-4bb8-9361-c14950b6ff49`.
Home tenant id: `302135a8-33c7-448c-87cb-cc71fe0136c9`.

The web app uses the `common` Microsoft identity authority by default so a fantasy group is not artificially limited to the registration's home tenant. The App Registration must therefore allow the account types that the product wants to accept.

`https://fanta.plus` must be registered under **Authentication -> Single-page application (SPA)**, not as a confidential Web redirect. The browser uses authorization code + PKCE and no client secret.

If a deployment must become tenant-only, set `EXPO_PUBLIC_MICROSOFT_AUTHORITY_TENANT` to the tenant id instead of `common`.

## Google

The Pages build reads `EXPO_PUBLIC_GOOGLE_CLIENT_ID` from the GitHub Actions repository variable with the same name. This is a public OAuth client identifier, not a secret.

The Google web client must allow JavaScript origin `https://fanta.plus`. Fantazone uses Google Identity Services popup token flow with only `openid profile email`, then reads the standard OIDC UserInfo endpoint.

## Identity lifetime in the SPA

The selected group connection may remain persisted so a reload can reopen the same repository. The authenticated human identity does **not** come back from local/session storage: it lives only in the current React runtime. After a page reload the user must prove Google/Microsoft again before an authenticated Fantazone session is rebuilt.

Microsoft is the one navigation exception: authorization-code + PKCE needs `state`, `nonce` and the code verifier to survive the full-page round trip to Microsoft. Those short-lived transaction values are stored in `sessionStorage` only while login is pending and are removed in the callback `finally` block. They are not an authenticated email, subject or Fantazone session.

This prevents a locally edited JSON blob from being treated as a provider-proven identity after reload. The provider usually still has its own session, so proving the account again should not mean entering credentials from scratch every time.

## First group administrator

A newly created repository cannot start with `group.users: []`, otherwise nobody could ever pass the membership gate and become the first administrator. Group creation therefore requires an initial administrator email. Fantazone writes it into the initial readable Group document with Participant + Admin + SuperAdmin flags and immediately binds the first login to that same email.

This is a bootstrap operation tied to repository creation. It is different from normal invitations, which remain restricted to an already-authenticated Admin/SuperAdmin. An old already-created repository with an empty `group.users` list can be bootstrapped once; a populated membership list is never overwritten by the creation helper.

## Invite flow

Only an authenticated Group Admin/SuperAdmin gets the invite form in the normal UI.

```text
admin login
  -> enter recipient email/name
  -> refresh config/group.json
  -> upsert group.users recipient as Participant
  -> commit readable Group JSON with SHA concurrency
  -> create fanta.plus #join link containing PAT + repo + expected email
  -> recipient opens link
  -> repo selected before login
  -> expected email shown and passed as login_hint
  -> Google/Microsoft returns identity
  -> expected email must match
  -> group.users must contain same email and role != None
  -> authenticated Fantazone session
```

The email inside the invite is not the source of authorization; it is an extra constraint. `group.users` remains the membership source of truth.

## Security boundary

This remains a client-only application. The checks above prevent accidental/wrong-account access in the normal Fantazone client, but browser JavaScript is not a trusted server-side authorization boundary. A person holding a repository write credential can bypass the UI and call GitHub directly. Strict unforgeable per-user write authorization would still require repository rules/signatures or a trusted command service.

## Native follow-up

The current OAuth adapter is deliberately the web adapter for `fanta.plus`. iOS/Android require their own registered app scheme / universal-link redirects; `https://fanta.plus` alone cannot deep-link an OAuth result back into a standalone native build.
