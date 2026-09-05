# Public source repository and credential model

The **Fantazone source repository** is public for study/events. Real fantasy-group data repositories remain private by default.

## Three different identities

1. **Human application identity** — Google/Microsoft identity.
2. **GitHub repository authorization** — PAT/credential controlling which `Fantazone.<group>` repositories can be opened.
3. **Auction session identity** — ephemeral WebRTC host/participant identity.

Repository selection happens before application login. After Google/Microsoft returns an email, Fantazone resolves it against the selected `Group.users` array.

## Group repositories are private by default

Readable schema v2 makes data easier to inspect, but it does not make personal data public. `config/group.json` contains `users[].email`, so real `Fantazone.<group>` repositories are private by default.

```text
KeyserDSoze/Fantazone       public source / educational project
Fantazone.<real-group>      private runtime data
Fantazone.Demo-*            public only with synthetic data
```

Git history can retain deleted values, so never publish a real group merely to simplify reads.

## V1 shared PAT

The group PAT is a bearer secret. Invite transport uses a URL fragment at `https://fanta.plus`, but encoding is not encryption. Use a fine-grained PAT scoped to the needed repository/repositories and rotate it when membership changes or after a public demo where it was shared.

PATs, Google/Microsoft tokens and other secrets are never committed to group JSON.

## Data classification

- match/league data may be public when intentionally published;
- `Group.users` contains membership/email data and belongs in a private real-group repository;
- UI-only selected state can remain local;
- credentials are local/secure-store data, never repository state.

If public standings are needed for a private group, publish a separate derived public projection rather than exposing or partially redacting canonical `config/group.json`.
