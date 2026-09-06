# Serie A live and official vote ingestion

This slice migrates the two external vote producers used by Fantasoccer while keeping provider-specific formats outside the canonical football domain.

## Canonical outputs

```text
data/serie-a/votes/official/<seasonId>/<serieADay>.json
data/serie-a/votes/live/<seasonId>/<serieADay>.json
```

Both use the readable `VotedRealPlayers` / `Vote` schema defined in `docs/24-player-statistics-and-votes.md`.

## Official/final votes

Legacy source of truth:

- `Fantasoccer.Business/Vote/Final/OfficialVote.cs`
- `Fantasoccer.Business/Stats/VotePlayerGenerator.cs`
- `Fantasoccer.Business.BackgroundJobs/IngestionData/FinalVotesJob.cs`

`ingest-final-votes` preserves the useful behavior:

- internal season id 15 maps to provider label `2026-27`;
- parses team/player blocks, roles, decimal votes, all bonus counters, cards and MOTM;
- provider sentinel `55` means no vote;
- card without a numeric vote is promoted to legacy vote 6;
- final votes have `isFinal=true`, `isIn=true`, `isOut=false`;
- delayed matches create synthetic vote-6 records for every matching master player, with `isIn=false`;
- completeness counts only teams whose matches were not delayed;
- partial provider results are still persisted but reported `complete=false` so a later run can retry;
- a complete final-vote run triggers `rebuild-player-stats` for the same day.

Without an explicit day the job mirrors legacy `FinalVotesJob` and chooses `RealCalendar.LiveDay ?? RealCalendar.LastDay`.

The default source is:

```text
https://www.fantacalcio.it/voti-fantacalcio-serie-a/
```

and can be overridden by `FANTAZONE_FINAL_VOTES_BASE_URL`.

Intentional schema improvement: synthetic delayed players are copied from canonical `RealPlayers`, so team, role and visibility remain complete instead of producing partially populated legacy records.

## Live votes

Legacy source of truth:

- `Fantasoccer.Business/Services/Votes/Live/LiveVote.cs`
- `Fantasoccer.Business.BackgroundJobs/IngestionData/LiveVotesJob.cs`

The active legacy provider uses a two-step protocol:

```text
POST https://www.fantacalcio.it/api/v1/SignedUri
  body -> https://api.fantacalcio.it/v1/st/<sourceSeason>/matches/live/<day>.dat
  -> signedUri
GET signedUri
  -> protobuf payload
```

The provider source season preserves the legacy mapping `internalSeason + 6` (`15 -> 21`).

Fantazone implements the small protobuf schema directly instead of adding a general protobuf runtime dependency. The decoder supports only the wire types and fields actually consumed by the legacy live-vote contract and skips unknown supported fields.

Player event mapping preserves legacy semantics:

- 1 yellow card;
- 2 red card;
- 3 goal;
- 4 suffered goal;
- 5/6/21/22/23/24 assists;
- 7 stopped penalty;
- 8 wronged penalty;
- 9 penalty;
- 10 own goal;
- 14 player out;
- 15 player in;
- 26 Man of the Match.

Provider vote `55` becomes value 0 with `hasVote=false`; live votes always have `isFinal=false`.

The canonical live document is merged like the old `LiveVotesJob`:

- known legacy player key -> update only `vote`, preserving stored player metadata;
- new key -> append the new player;
- empty provider response -> do not rewrite the snapshot.

Without an explicit day, `ingest-live-votes` contacts the provider only when `RealCalendar` reports an actually live match; otherwise it is a no-op.

Endpoint overrides:

```text
FANTAZONE_LIVE_SIGNED_URI_URL
FANTAZONE_LIVE_RESOURCE_BASE_URL
```

## Scheduled production live ingestion

The platform Background jobs workflow runs on GitHub's minimum supported cron cadence:

```text
*/5 * * * *
```

A scheduled run always maps to `ingest-live-votes`. Before installing workspace dependencies, a dependency-free guard reads the canonical `data/serie-a/calendars/*.json` files and checks the same legacy per-match live window used by `RealCalendarHelper`: kickoff through kickoff + 2h15, excluding delayed matches.

If no Serie A match is currently live, the workflow exits after checkout + guard and does not install dependencies or call the provider. The `ingestLiveVotes()` implementation repeats the canonical `RealCalendar` guard before the network boundary, so the lightweight workflow check is only an optimization and cannot bypass the business rule.

When live data is produced, the workflow commits only when Git reports a canonical data diff. Rewriting the same JSON bytes therefore produces no commit. Platform background jobs share one non-cancelling concurrency group and rebase before push so scheduled live ingestion does not race other global data producers.

This deliberately replaces the legacy one-minute server cron with a five-minute GitHub schedule while preserving its `LiveDay + IsLive` behavior.

## Testing

All provider adapters are dependency-injected at the network boundary and are tested offline.

Official-vote fixtures cover parsing, missing markup/bonus values, incomplete team coverage, delayed matches and canonical persistence.

Live-vote tests build a protobuf fixture byte-by-byte and verify SignedUri request/body/headers, protobuf decoding, event semantics, merge behavior, provider no-result handling and the RealCalendar live guard.

The scheduled workflow also has tests for the five-minute cron and for the dependency-free guard's live, future, delayed and missing-calendar cases.

## Production validation

Functional migration does not by itself prove that today's third-party provider endpoints are still available. The first real scheduled match remains the operational validation of the current SignedUri/protobuf source.

The dependency chain for a new season remains:

```text
ingest-serie-a
-> ingest-master-data
-> ingest-final-votes for a concluded day
-> rebuild-player-stats (automatic when final votes are complete)
```

`ingest-live-votes` can also be invoked manually with an explicit day for controlled provider diagnostics, while normal scheduled executions always rely on the live calendar guard.
