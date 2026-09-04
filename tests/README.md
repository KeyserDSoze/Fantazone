# Tests

Tests are intentionally top-level so parity can be tracked independently from implementation packages.

Planned suites:

- `tests/app/` — screen/component/application orchestration tests;
- `tests/domain/` — pure calculations, market rules, standings and formation logic;
- `tests/github/` — repository naming, invite parsing, GitHub API mapping and conflict handling;
- `tests/jobs/` — fixtures captured from legacy background jobs;
- `tests/realtime/` — WebRTC auction protocol/state-machine tests.

The existing Fantasoccer `groupAdmin.test.mjs` and `marketRules.test.mjs` are early parity fixtures to port.
