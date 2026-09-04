# Contributing to Fantazone

Fantazone is both a real migration and an educational repository. Contributions should make the codebase easier to understand **without weakening the architecture experiment**.

## Architectural invariants

1. There is no always-on Fantazone application backend.
2. Durable group state belongs to the corresponding `Fantazone.<group>` repository.
3. Shared football ingestion should run once globally, not once per group.
4. Group-specific Actions operate with that repository's `GITHUB_TOKEN` where possible.
5. Realtime auction traffic must not create a Git commit per message or bid.
6. Deterministic business logic should live in `@fantazone/domain` and be reusable from the app and Actions.
7. A migrated behavior needs a test/fixture or an explicitly documented intentional difference from Fantasoccer.
8. GitHub authorization and human Google/Microsoft identity are separate concepts.

## Recommended migration workflow

1. Find the Fantasoccer screen/service/job that represents the existing behavior.
2. Capture representative inputs/outputs or port its existing tests.
3. Extract pure business behavior to `src/domain` where appropriate.
4. Put GitHub-specific persistence in `src/github` rather than UI components.
5. Put scheduled/ingestion orchestration in `src/jobs` + `.github/workflows`.
6. Keep WebRTC transport behind an auction transport abstraction.
7. Update `docs/06-migration-checklist.md` in the same PR.

## Development

```bash
npm install
npm run typecheck
npm test
npm run export:web --workspace=fantazone-app
```

CI must stay green. The static Expo export is part of the test suite because the web/PWA build is a first-class deployment target.

## Pull requests

Prefer small vertical slices that include behavior, tests and documentation together. A good PR description explains:

- which Fantasoccer behavior is being preserved;
- which old dependency is being removed (HTTP API, SignalR, storage, worker host);
- what the new GitHub/WebRTC mechanism is;
- how parity is verified;
- any security or concurrency tradeoff introduced.

## Security

Do not commit PATs, OAuth tokens, private group data or copied production secrets. The V1 shared PAT mechanism is intentionally temporary and must not be presented as a production-safe credential-distribution design. See `SECURITY.md`.
