# Testing strategy

Fantazone uses three complementary test layers.

## 1. Deterministic unit and contract tests

`npm test` runs the domain, GitHub-adapter, application-service and job suites on every pull request and push to `main`.

These tests intentionally use pure reducers, filesystem fixtures or fake `RepositoryContentClient` implementations so business-rule regressions are fast and deterministic.

## 2. Browser end-to-end tests

Playwright runs against the static Expo web export on every CI validation.

Current projects:

- Chromium desktop;
- Chromium mobile emulation.

Run locally after building the web app:

```bash
npm install
npm run export:web --workspace=fantazone-app
npx playwright install chromium
npm run test:e2e
```

The first smoke test verifies that the real generated application reaches the Microsoft login shell and remains usable at desktop and mobile sizes. Authenticated flows will be added incrementally without replacing the lower-level deterministic tests.

## 3. Real GitHub integration

`.github/workflows/real-integration.yml` exercises the actual GitHub Contents API with a dedicated test repository. It is deliberately separate from pull-request CI because it uses a secret and performs real writes.

Create a dedicated private repository:

```text
KeyserDSoze/Fantazone.IntegrationTests
```

Then create a fine-grained PAT scoped only to that repository with the minimum required permission:

```text
Repository permissions -> Contents -> Read and write
```

Add that token to `KeyserDSoze/Fantazone` as the Actions secret:

```text
FANTAZONE_TEST_PAT
```

Optionally set the Actions repository variable:

```text
FANTAZONE_TEST_REPOSITORY=KeyserDSoze/Fantazone.IntegrationTests
```

The default already targets that repository name.

The real integration test uses one stable canary document:

```text
integration/github-json-store-canary.json
```

It verifies:

1. PAT authentication;
2. exact repository visibility and push permission;
3. real JSON write through `GitHubJsonStore`;
4. fresh GitHub read and returned blob SHA;
5. successful update with the expected SHA;
6. rejection of a stale concurrent writer through GitHub's real 409/422 conflict behavior;
7. final canonical content after the conflict.

The workflow can be dispatched manually and also runs weekly. If `FANTAZONE_TEST_PAT` is not configured, it exits without installing dependencies or making network writes.

## Rules

- Never use a production group PAT for integration tests.
- Never expose integration secrets to pull-request jobs.
- Keep the integration repository disposable and free of real user/group data.
- A feature migration still requires deterministic representative tests even when an end-to-end test exists.
- Real-provider tests and real-GitHub tests complement fixtures; they do not replace them.
