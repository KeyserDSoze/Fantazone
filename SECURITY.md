# Security policy and prototype boundaries

Fantazone is an educational zero-server experiment under active development. Some current mechanisms are intentionally simple so architectural ideas can be tested before the production identity model is finalized.

## The V1 PAT flow is not the final security model

Today a group can be connected using a GitHub Personal Access Token (PAT), and an invite can carry that token in an encoded URL fragment.

Important facts:

- base64url encoding is **not encryption**;
- possession of a PAT is equivalent to possession of its granted GitHub permissions;
- a URL fragment reduces accidental server/referrer logging compared with a normal query string, but it does not make the secret safe to redistribute;
- browser `localStorage` is exposed to JavaScript running in that origin and therefore is not equivalent to a native secure enclave/keychain;
- native clients use Expo SecureStore, which is preferable but does not make an over-privileged PAT safe.

For experiments, create a dedicated fine-grained token limited to the specific demo repositories and only the permissions required. Never reuse a broad personal/organization token. Rotate a token immediately if it is exposed in screenshots, issue text, logs, chat, analytics or source control.

## Target model

The GitHub credential is behind an adapter so V1 can evolve toward GitHub App/OAuth authorization with short-lived or installation-scoped credentials. Google/Microsoft login remains a separate human identity concern.

## Public repositories

A public `Fantazone.<group>` repository means its committed canonical data and history are public by design. Do not put private profile information, secrets or data that participants do not intend to publish in it.

## Reporting a security problem

Do not open a public issue containing a live credential or exploitable secret. Revoke/rotate the credential first. When reporting a design weakness publicly, use synthetic tokens and demo repositories only.
