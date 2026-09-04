# Fantazone

Fantazone is the zero-server evolution of [Fantasoccer](https://github.com/KeyserDSoze/Fantasoccer).

The target is a single React Native/Expo + Tamagui application (native + web/PWA) where:

- GitHub repositories are the persistent data store and audit history;
- the browser/app talks directly to the GitHub REST API;
- each fantasy-football group uses a repository named `Fantazone.<group>`;
- V1 authenticates GitHub writes with a PAT supplied when joining/creating a group;
- Google and Microsoft login remain the human application identity;
- GitHub Actions replace the legacy background-job host;
- WebRTC DataChannels replace SignalR for live auctions, with the auctioneer device acting as the authoritative host;
- static assets previously stored in Azure Storage are served from GitHub/raw GitHub content;
- calculations are deterministic and shared between the app, tests and Actions whenever possible.

## Repository layout

```text
.github/workflows/   CI, Pages, ingestion and recalculation workflows
docs/                Product, architecture and migration documentation
src/app/             Expo / React Native / Tamagui application
src/domain/          Framework-independent TypeScript business contracts
src/github/          GitHub repository client and persistence adapters
src/jobs/            Background-job runners used by GitHub Actions
tests/               Application, domain, GitHub adapter and job tests
```

Start with [`docs/README.md`](docs/README.md).
