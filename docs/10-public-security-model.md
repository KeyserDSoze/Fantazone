# Public repository and credential model

Fantazone is now intentionally public so its architecture can be studied. Public source code and public group repositories change what must be treated as secret.

## Three different identities

Fantazone should keep these concepts separate:

1. **Human application identity** — Google or Microsoft account used to identify the fantasy-football participant.
2. **GitHub repository authorization** — permission to read/write a `Fantazone.<group>` repository.
3. **Auction session identity** — ephemeral participant/host identity used inside a WebRTC auction session.

Conflating these identities would make later migration away from a shared PAT significantly harder.

## V1 shared PAT

V1 accepts a PAT because it makes the repository-per-group experiment easy to demonstrate. It is a bearer secret and must be treated as such.

The invite payload currently travels in a URL fragment. This is preferable to a query string for the prototype because fragments are not sent as part of the HTTP request and are less likely to appear in ordinary server/referrer logs. The payload is only encoded, however, and is readable by anyone who receives the link.

## Recommended demo token

For a public workshop/event:

- create a dedicated fine-grained PAT;
- scope it to a dedicated `Fantazone.Demo-*` repository or the minimum demo repositories;
- grant only the repository permissions the current flows need;
- do not grant organization administration or unrelated repository access;
- rotate/revoke it after the event if participants received it.

## Target authorization

The long-term adapter should support an interface conceptually similar to:

```ts
interface RepositoryCredentialProvider {
  getAccessToken(repository: string): Promise<string>
  clear(): Promise<void>
}
```

The implementation can then move from a stored PAT to GitHub App/OAuth installation authorization while persistence/business code continues to depend only on the repository adapter.

## Public data vs private data

A public group repository should contain only information participants accept as public. Email addresses, private profile information and secrets should not be committed merely because the old backend model stored them.

As Fantasoccer models are migrated, each field should be classified as:

- public canonical game data;
- public participant display data;
- local-only/private client data;
- secret credential material (never committed).

This classification should be completed before full group/user parity is considered done.
