# Dependency hardening

Fantazone uses one committed root npm workspace lockfile. CI, Pages, platform jobs, real integration and generated group workflows install it with `npm ci`.

## Audit classification

Audit captured on 2026-09-08 after a non-breaking lockfile-only `npm audit fix`.

| Scope | Low | Moderate | High | Critical | Total |
|---|---:|---:|---:|---:|---:|
| production (`--omit=dev`) | 0 | 16 | 0 | 0 | 16 |
| full workspace | 1 | 19 | 0 | 0 | 20 |

High/critical production advisories fail this closure workflow. Remaining low/moderate transitive findings are reviewed during routine dependency maintenance instead of forcing breaking Expo ecosystem upgrades during refactor closure.
