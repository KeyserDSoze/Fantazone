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
npm ci
npm run export:web --workspace=fantazone-app
npx playwright install chromium
npm run test:e2e
```

The first smoke test verifies that the real generated application reaches the Microsoft login shell and remains usable at desktop and mobile sizes. Authenticated flows will be added incrementally without replacing the lower-level deterministic tests.

## 3. Real GitHub integration

`.github/workflows/real-integration.yml` exercises the actual GitHub API with the dedicated disposable repository:

```text
KeyserDSoze/Fantazone.Test
```

The repository can remain on `main` permanently. We intentionally do not use throw-away branches or force-reset history.

At the beginning of every real integration suite, the test creates a normal commit named `test: reset repository ...` whose complete tree contains only:

```text
.fantazone-test.json
```

That cleanup commit removes every file produced by the previous suite from the current `main` tree while preserving all previous commits and generated files in Git history. This gives every suite a clean canonical repository without losing the audit/debug trail of earlier runs.

The repository must never contain real group or user data. It may be public because all test data is synthetic, but the test PAT must still be scoped as narrowly as possible.

Create a fine-grained PAT scoped only to `KeyserDSoze/Fantazone.Test` with the minimum required permission:

```text
Repository permissions -> Contents -> Read and write
```

Add that token to `KeyserDSoze/Fantazone` as the Actions secret:

```text
FANTAZONE_TEST_PAT
```

Optionally set the Actions repository variable:

```text
FANTAZONE_TEST_REPOSITORY=KeyserDSoze/Fantazone.Test
```

The default already targets that repository name.

The current real integration suite verifies:

1. PAT authentication;
2. exact repository visibility and push permission;
3. a real cleanup commit on `main` that restores the baseline tree;
4. real JSON write through `GitHubJsonStore`;
5. fresh GitHub read and returned blob SHA;
6. successful update with the expected SHA;
7. rejection of a stale concurrent writer through GitHub's real 409/422 conflict behavior;
8. final canonical content after the conflict.

The workflow can be dispatched manually and also runs weekly. If `FANTAZONE_TEST_PAT` is not configured, it exits without installing dependencies or making network writes.

The same repository is the target for the next integration scenarios: real group initialization, canonical group writes, managed workflow installation/dispatch and GitHub Action mutations. Each scenario starts from the same reset convention rather than creating another repository.

## Rules

- Never use a production group PAT for integration tests.
- Never expose integration secrets to pull-request jobs.
- Keep the integration repository disposable and free of real user/group data.
- Reuse `main` and preserve history; reset current contents with ordinary cleanup commits.
- A feature migration still requires deterministic representative tests even when an end-to-end test exists.
- Real-provider tests and real-GitHub tests complement fixtures; they do not replace them.
