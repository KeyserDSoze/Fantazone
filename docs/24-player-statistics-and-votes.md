# Derived player statistics and canonical vote contract

This slice migrates the global `StatPlayers` projection used by Fantasoccer without coupling it to the legacy backend, group repositories or external vote scraping.

## Legacy source of truth

Private repository: `KeyserDSoze/Fantasoccer`.

Relevant legacy code:

- `Fantasoccer.Business/Stats/StatsPlayerGenerator.cs`
- `Fantasoccer.Business/Vote/TeamCalculator.cs` (`FinalValue`)
- `Fantasoccer.Domain/Stats/StatPlayer*.cs`
- `Fantasoccer.Domain/SerieA/Vote/Vote.cs`
- `VotedRealPlayer.cs` / `VotedRealPlayerWrapper.cs`

## Canonical global documents

Fantazone uses readable schema-v2 documents:

```text
data/serie-a/votes/live/<seasonId>/<serieADay>.json
data/serie-a/votes/official/<seasonId>/<serieADay>.json
data/serie-a/stats/<seasonId>.json
```

A vote document is self-describing with `year`, `serieADay` and readable `players[].vote` fields. Statistics are self-describing with `year`, `untilSerieADay` and readable player counters/history.

Provider-specific HTML/JSON is never persisted as the canonical model.

## Vote domain

The shared `Vote` contract preserves the legacy semantics used by live/final data and score calculations:

- raw vote value + `hasVote`;
- goal, penalty, assist, stopped penalty, suffered goal, wronged penalty and own goal;
- yellow/red card behavior;
- injury and Man of the Match;
- in/out state and final/live flag.

`calculateVoteValue()` is a pure port of the part of `TeamCalculator.FinalValue` required by player statistics. It applies the configured role vote settings and the goalkeeper clean-sheet special.

For statistics, the legacy generator used `LeagueSetting.Default`; Fantazone does the same unless an explicit setting is injected in a deterministic test/caller.

## Statistics reducer

`generatePlayerStatistics()` is storage/network independent. Inputs are:

```text
RealPlayers
+ official vote document per Serie A day
+ untilSerieADay
-> StatPlayers
```

The reducer preserves the legacy behavior:

- days are processed from `untilSerieADay` down to 1;
- missing player in the day's official votes => `noPlayed++`, null game vote, positiveness `-2`;
- player present with null vote => same no-play behavior;
- vote with `hasVote=false` => `withoutVote++`, positiveness `-2`;
- valid vote => accumulate base/fantasy totals, bonuses, cards, injury, sufficiency, specials and per-game positiveness;
- `average` and `fantaAverage` remain computed helpers, not duplicated persisted fields;
- duplicate legacy player keys inside one official-vote document fail loudly.

## `rebuild-player-stats`

The job reads canonical files from the platform repository, runs the pure reducer and writes:

```text
data/serie-a/stats/<seasonId>.json
```

When no explicit day is passed it mirrors the old `AllPlayersAndAllTeamsJob` choice:

```text
RealCalendar.LastDay?.SerieADay ?? 38
```

A manual day can be supplied through `workflow_dispatch` for deterministic repair/backfill.

## Master-data trigger

Legacy `AllPlayersAndAllTeamsJob` regenerated statistics only when the resulting player **count** changed. Transfer-only changes did not trigger it.

Fantazone keeps that exact signal but separates the responsibility:

```text
ingest-master-data
  -> reconciliation.playerCountChanged
  -> if true: rebuild-player-stats
```

The stats reducer remains an independent job and can also be invoked directly.

## Responsibility split

This slice defines and consumes the canonical vote format, but it does not fetch votes from external sites.

External production is tracked separately in issue #29:

- `ingest-final-votes` produces `official` vote documents;
- `ingest-live-votes` produces `live` vote documents;
- statistics consume only `official` documents.

This keeps scraping/provider volatility outside deterministic football-domain calculations.
