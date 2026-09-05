# Definitive fantasy-day recalculation

This workstream replaces the legacy `GroupsManagerJob` and the misleading admin recalculation endpoint with explicit deterministic group-owned recalculation.

## Legacy responsibility split

The old `/Recalculation/RecalculateDay` endpoint did **not** recalculate fantasy matches. It only forced regeneration of official Serie A votes.

The definitive fantasy work happened later inside `GroupsManagerJob`:

```text
official votes + TeamDay
        -> TeamCalculator.CalculatePoint
        -> Calendar game results
        -> RankCalculator/GetRank
        -> Cup/NewCup AddDaysInLeague
        -> Calendar + season Rank + daily Rank persistence
```

Fantazone keeps those responsibilities separate:

- `ingest-final-votes` is a **platform/global producer**;
- `recalculate-day` and `recalculate-all` are **group-repository jobs**.

## Pure reducers

### `calculateDefinitiveDay()`

Inputs:

- one readable `CalendarDay`;
- TeamDay documents keyed by owner;
- the official `VotedRealPlayers` document for that Serie A day;
- annual `LeagueSetting`;
- annual `LeagueType`.

Output: a cloned `CalendarDay` with definitive `GameResult` values.

Rules preserved from `GroupsManagerJob.CalculateDayAsync`:

- cancelled games remain untouched;
- a missing TeamDay produces `Point.Zero`;
- home advantage is applied only when the home TeamDay exists;
- definitive scoring uses **official votes only**;
- substitutions/Best Formation/defence/good-people/own-goal semantics come from the shared `calculateTeamPoint()` reducer;
- goals use the shared `GameResultHelper.calculateGoals()` rules.

Live votes are intentionally not accepted by this API, so a persisted definitive result cannot accidentally depend on a live snapshot.

### `calculateRankFromCalendar()`

Rebuilds a canonical Rank from calculated Calendar data, preserving the old rank counters and money effects:

- points, wins, draws and losses;
- goals and goals conceded;
- fantasy points and conceded fantasy points;
- `rankWithValuePoints` behavior;
- goal/suffered-goal money bonuses;
- sort by league points, then fantasy points.

Cup rounds excluded from group-stage ranking preserve legacy behavior:

```text
Cup     -> Finals
NewCup  -> Finals, Europa League, Supercoppa
```

## Deterministic Cup/NewCup progression

`progressLeagueCalendar()` replaces legacy `AddDaysInLeague` for the two knockout competition types.

Classic Cup preserves:

- top two qualifiers from each group;
- two-legged knockout stages;
- legacy aggregate-goal and away-goal tie rules;
- fantasy-point tie break;
- group-rank `valuePoint` tie break;
- one-game final.

NewCup preserves:

- top eight -> `Finals` bracket;
- next eight -> `Europa League` bracket;
- two-legged knockout rounds;
- one-game finals;
- winner-vs-winner `Supercoppa` at Serie A day 38.

### Intentional difference: perfect ties

The legacy implementation called `RandomNumberGenerator.GetInt32()` as the last fallback when every sporting and fantasy tie-break remained equal. That made full rebuild output non-deterministic.

Fantazone uses a stable seeded choice based on season/round/participants instead. Rebuilding the same canonical inputs therefore always produces the same qualifier and the same generated game IDs.

## Group job orchestration

`src/jobs/src/groupRecalculation.ts` reads two checkouts:

```text
FANTAZONE_GROUP_REPO_ROOT
  config/group.json
  data/groups/...

FANTAZONE_PLATFORM_REPO_ROOT
  data/serie-a/votes/official/...
```

### `recalculate-day`

Requires an explicit Serie A day. If that day exists in a fantasy calendar but the official vote document is missing, the job fails closed and writes nothing for that recalculation instead of producing a fake 0-0.

### `recalculate-all`

Recalculates every calendar day for which an official vote document exists. Future/missing-vote days remain untouched. Existing completed Calendar state can still trigger Cup/NewCup progression even when no new vote document is needed.

Both jobs write group-owned canonical files:

```text
data/groups/seasons/<season>/leagues/<league>/calendar.json
data/groups/seasons/<season>/leagues/<league>/ranking.json
data/groups/seasons/<season>/leagues/<league>/days/<serie-a-day>/ranking.json
```

## Group-owned workflow

Every initialized group repository receives:

```text
.github/workflows/fantazone-group.yml
```

The workflow:

1. checks out the group repository into `group/`;
2. checks out public `KeyserDSoze/Fantazone` into `platform/`;
3. runs the shared TypeScript job engine from the platform checkout;
4. lets the reducer read global official votes from the platform checkout;
5. commits only the changed group `data/` files using that repository's own `GITHUB_TOKEN`.

No central Fantazone workflow stores group PATs.

Concurrent group-maintenance runs are serialized with a workflow concurrency group to avoid competing commits.

## Bootstrap credential requirement

Creating/updating `.github/workflows/*` requires the bootstrap GitHub credential to be authorized to modify workflows. For a classic PAT this means the `workflow` scope in addition to repository access; granular tokens must grant the corresponding workflow write permission.

`ensureGroupInitialized()` installs the workflow idempotently and returns a specific bootstrap error if that permission is missing.

## Retired `GroupsManagerJob`

The old scheduled `GroupsManagerJob` is no longer copied into the platform background workflow.

Its useful behavior is now split into:

```text
external vote producer     -> platform Action
fantasy scoring/ranking    -> pure shared reducers
group persistence/rebuild  -> group-owned workflow
live derived view          -> local GroupLiveComposer
```

This keeps global scraping global, group state group-scoped, and derived live state on the client.
