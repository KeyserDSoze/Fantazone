# Group market runtime

Fantazone ports the legacy Fantasoccer `MarketManager` and `MarketJob` without recreating a backend.

## Storage

For season `<season>` and league `<league>`:

```text
data/groups/seasons/<season>/markets/<league>/state.json
data/groups/seasons/<season>/markets/<league>/commands/<command-id>.json
```

`state.json` is canonical readable market history. Commands are append-only client requests with a unique id and one of `create`, `approve`, `deny`, `cancel`.

The client never changes a Team or market state as part of a market operation. `GroupMarketService` performs fast local UX/identity validation and creates only the command document with `createOnly` optimistic semantics.

## Canonical processing

Group runtime v4 watches market command paths and `manifest.json`. A repository-scoped concurrency group serializes all group maintenance. On each stable push it runs formation snapshotting and market processing; while `manifest.updating` is true, market processing defers until the stable manifest push.

For every pending command the Action:

1. uses the Git commit that created the command as the authoritative request time;
2. reloads `config/group.json` and current season Team files;
3. reloads current market state;
4. runs the pure market reducer;
5. writes the command result plus any changed Team/market documents;
6. commits all canonical changes together with one manifest revision.

Commands are processed in commit-time order. If a run fails before the final Git commit, the command remains pending in the repository and a later run can process it again.

## Legacy rules preserved

The reducer is a direct behavioral port of `Fantasoccer.Business/Market/MarketManager.cs`:

- only the current season is editable;
- a league can use `WithVote`, `WithoutVote`, or `Denied` market mode;
- only the buyer creates a proposal;
- buyer and seller must be distinct team owners in the league;
- money values are non-negative integers;
- every requested player must still be active in the canonical Team;
- both sides exchange at least one player;
- both sides exchange the same count per real-player role;
- buyer and seller count as initial approvals;
- vote quorum is absolute majority: `floor(teamCount / 2) + 1`;
- only neutral league team owners can approve/deny;
- a neutral owner may change their vote while the proposal is pending;
- denial quorum wins before approval execution;
- only buyer/seller can cancel;
- budget is recalculated from the latest Team state when quorum is reached;
- missing players produce `NoPlayers`;
- insufficient money produces `NoMoney`;
- successful execution swaps players, preserves the outgoing formation slots per role and applies the money transfer through `moneyFromRank`;
- pending proposals expire strictly after 14 days.

## Daily expiry

Legacy `MarketJob` ran daily to expire old proposals. Runtime v4 schedules `process-market` at `02:00 UTC` every day, even if no market command was created.

## Concurrency model

This replaces the legacy in-process semaphore with Git/GitHub primitives:

```text
client create-only command
        ↓
GitHub commit
        ↓
repository Actions concurrency lock
        ↓
canonical reread + reducer
        ↓
Team + market + command result
        ↓
manifest revision + one Git commit
```

The existing workflow persistence retry handles a branch that moves while the Action is running. No central lock service or server process exists.

## Security boundary

As documented in `30-shared-group-credential.md`, the group PAT is shared with participants. The Action therefore provides canonical business/concurrency enforcement, not cryptographic per-user attribution: a participant who extracts the PAT can forge a command actor outside the app. This is the accepted limitation of the zero-backend/shared-credential design.
