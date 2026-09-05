# Public source repository and credential model

The **Fantazone source-code repository** is intentionally public so its architecture can be studied and presented at events. That does not mean repositories containing real fantasy-group data should be public.

## Three different identities

Fantazone keeps these concepts separate:

1. **Human application identity** — Google or Microsoft identity proving who the person is.
2. **GitHub repository authorization** — the PAT/credential that determines which `Fantazone.<group>` repositories can be opened.
3. **Auction session identity** — ephemeral participant/host identity used inside a WebRTC auction session.

Repository selection happens before application login. After Google/Microsoft returns an email, Fantazone resolves that email against the selected group's `GroupRaw.u` list.

## Group repositories are private by default

`GroupRaw` intentionally preserves the Fantasoccer JSON contract and therefore includes users and email addresses. New `Fantazone.<group>` repositories are created **private by default**.

A public group repository is appropriate only for an explicit demo using synthetic/non-personal data. Never publish a real group merely to make read access easier: Git history can retain data even after a later file deletion.

The public teaching repository and a private runtime group repository serve different purposes:

```text
KeyserDSoze/Fantazone       public source / educational project
Fantazone.<real-group>      private runtime data by default
Fantazone.Demo-*            may be public only with synthetic data
```

## V1 shared PAT

V1 accepts a PAT because it makes the repository-per-group experiment easy to demonstrate. It is a bearer secret and must be treated as such.

The invite payload currently travels in a URL fragment. Fragments are not sent as part of the HTTP request, but the payload is only encoded and is readable by anyone who receives the link.

Use a fine-grained PAT scoped to only the group repositories required by that installation. Rotate/revoke it when membership changes or after a public workshop where a demo credential was shared.

## Event/demo token

For a public workshop/event:

- create a dedicated synthetic `Fantazone.Demo-*` repository;
- put no real participant emails/profile data in it;
- create a dedicated fine-grained PAT;
- scope it only to the demo repository/repositories;
- grant only the repository permissions the demo flows need;
- rotate/revoke it after the event if participants received it.

## Target authorization

The long-term adapter should support an interface conceptually similar to:

```ts
interface RepositoryCredentialProvider {
  getAccessToken(repository: string): Promise<string>
  clear(): Promise<void>
}
```

The implementation can move from a stored PAT to GitHub App/OAuth installation authorization while persistence/business code continues to depend only on the repository adapter.

## Data classification

Preserving a legacy JSON contract does not make its contents public. Repository visibility is part of the security boundary.

- canonical match/league data can be published where intentionally public;
- `GroupRaw.u` contains membership/email data and requires a private real-group repository;
- local UI state may stay device-local;
- PATs, OAuth tokens and other bearer credentials are never committed.

If a future product requirement needs public standings while keeping the exact private Group JSON, publish a separate derived public projection rather than altering or partially redacting the canonical legacy GroupRaw file.
