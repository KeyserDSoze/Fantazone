# Event / workshop demo guide

Fantazone is useful as a live architecture story because every major backend responsibility maps to a visible GitHub primitive.

## The 8-minute version

### 1. Start from the question (1 minute)

> What happens if a fantasy-football application is rebuilt with no always-on application server?

Show the root README architecture diagram. Emphasize that this is an experiment with explicit tradeoffs, not a claim that GitHub is a universal database.

### 2. Open the public web demo (1 minute)

Open the GitHub Pages application and choose **Esplora l'architettura**. No credential is required for this path.

Show the four runtime responsibilities:

- React Native/Expo/Tamagui client;
- GitHub repositories for durable state/history;
- GitHub Actions for background work;
- WebRTC for low-latency auction traffic.

### 3. Show repository-per-group state (2 minutes)

Explain the V1 naming convention:

```text
Fantazone.Amici-del-Bar
Fantazone.Ufficio
Fantazone.Torneo-2026
```

The platform does not need one central group database. Each group owns/version-controls its state.

Show `docs/03-github-data-contract.md` and point out canonical data vs diagnostic Action artifacts.

### 4. Show the worker split (1 minute)

Use `docs/07-runtime-topology.md`:

- Serie A / players / votes are ingested once globally;
- standings, market, formations and group-specific calculations execute per group;
- per-group workflows can use their own `GITHUB_TOKEN` instead of a server-side PAT database.

### 5. Show the realtime exception (2 minutes)

Open `docs/05-webrtc-auction.md`.

The auction cannot reasonably commit every bid to GitHub. The auctioneer device is therefore the authoritative WebRTC host, while GitHub is used for rendezvous/checkpoints/final state.

This is the useful architectural lesson: **zero-server does not mean forcing every workload through the same storage primitive.**

### 6. End with the safety net (1 minute)

Open `tests/domain` and `tests/github`. Explain the migration strategy:

1. capture Fantasoccer behavior;
2. extract deterministic rules;
3. port parity tests;
4. replace infrastructure behind adapters;
5. mark the migration checklist only when behavior is covered.

## Optional 20-minute deep dive

Add these sections:

- why URL fragments leak less than query strings but do not secure a PAT;
- GitHub Contents API optimistic concurrency through SHA values;
- why append-only commands/events help with concurrent writes;
- why global scraping must not be duplicated in every group repository;
- WebRTC ordering, host sequence numbers and idempotent command IDs;
- how a GitHub App can later replace PAT authorization without rewriting screens.

## Demo hygiene

Use a dedicated demo repository and a fine-grained disposable PAT. Never project a real personal PAT, even briefly. Keep browser developer tools closed while a live token is in storage, and rotate the demo token after the event if it was distributed to participants.
