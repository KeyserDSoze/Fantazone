# Local live-group composition and LiveJob retirement

This slice retires the legacy high-frequency `LiveJob` instead of recreating it as a GitHub Action.

## Legacy source of truth

Private repository: `https://github.com/KeyserDSoze/Fantasoccer`.

Relevant legacy code:

- `Fantasoccer.Business.BackgroundJobs/IngestionData/LiveJob.cs`
- `Fantasoccer.Business/Vote/TeamCalculator.cs`
- `Fantasoccer.Business/Services/RankCalculator.cs`
- `DefaultLeague.GetRightFormation`
- `SuperLeague.GetRightFormation`

The old job did not ingest an external provider. It repeatedly read already-persisted Group/Calendar/Rank/TeamDay/RealCalendar/vote data, calculated a derived snapshot and persisted `LiveGroup` for every fantasy group.

## Decision

Fantazone treats that snapshot as an ephemeral read model:

```text
group repository                            platform repository
----------------                            -------------------
config/group.json                           RealCalendar
Calendar                                    official votes
Rank                                        live votes
TeamDay
      \                                      /
       \                                    /
        -------- GroupLiveComposer ---------
                     |
                     v
                 LiveGroup
                in memory only
```

There is no production `ingest-live` job and no runtime requirement to commit `data/groups/live-group.json` every minute.

`GitHubLiveGroupRepository` remains temporarily as a compatibility adapter for historical/schema-v2 files while UI callers migrate. It is not the target runtime source anymore.

## Reusable scoring reducer

`calculateTeamPoint()` is a pure port of the useful `TeamCalculator.CalculatePoint` behavior.

Inputs:

- active fantasy `Player[]`;
- official vote document;
- optional live vote document;
- league type;
- annual `LeagueSetting`.

Preserved rules:

1. official player rows take precedence over live rows;
2. if an official row is absent, the live row may be used;
3. normal formations substitute a no-vote starter with the first eligible same-role bench player with a vote;
4. `FormationType.Best` and `LeagueType.SuperLeague` use the legacy SuperLeague selection rules;
5. `FinalValue` uses the shared vote reducer introduced in #28;
6. good-people bonus, strong-defense bonuses and own-goal flag preserve legacy semantics.

### Intentional safety improvement

Legacy SuperLeague temporarily mutated `Player.Position` while selecting the best formation. Fantazone never mutates the persisted player object during a read calculation. The selected position lives only in `EnrichedTeamPlayer.currentPosition`.

The resulting score is unchanged, but a live read cannot contaminate a cached/persisted Team object.

## Live score composition

For the RealCalendar target day (`LiveDay ?? NextDay`), `GroupLiveComposer`:

1. reads official votes for the day;
2. reads live votes only when the selected day is the RealCalendar live day;
3. visits every group league active for the season;
4. selects the matching fantasy `CalendarDay` from each round;
5. reads Home/Away `TeamDay` documents;
6. calculates team points locally;
7. adds `pointInHome` to the home side;
8. calculates fantasy goals through `GameResultHelper.calculateGoals()`;
9. projects the live Rank without mutating canonical Rank JSON.

Missing TeamDay behavior intentionally matches the old job: if the basket/owners are valid but a TeamDay is missing, that side uses `Point.Zero`. Home advantage is still applied to a zero home point, as legacy `LiveJob` did.

Cancelled games remain untouched.

## Live rank reducer

`applyLiveRoundsToRank()` ports the relevant `RankCalculator.AddDay` behavior.

It updates an in-memory clone with:

- victories/draws/defeats;
- goals/conceded goals;
- raw fantasy value points;
- league points with or without `rankWithValuePoints`;
- goal/conceded-goal money.

It preserves the old `CanCalculateRank` guard: a live round is applied only when every non-cancelled game's owners exist in that persisted rank round.

The persisted Rank document is never written by live composition.

## Runtime integration

`GroupSessionRuntime` now exposes:

```text
realCalendarRepository
liveVoteRepository
officialVoteRepository
liveComposer
```

The runtime still exposes `liveGroupRepository` only for migration compatibility.

## Job retirement

The old migration placeholder:

```text
ingest-live
```

is removed from both the TypeScript job-name union and the Background jobs `workflow_dispatch` options.

This is a deliberate zero-server optimization, not missing functionality. Only true producer work remains in Actions (`ingest-live-votes`, `ingest-final-votes`, calendar/master data, etc.). Derived per-group live state is calculated where it is consumed.

## Tests

Representative tests cover:

- official-over-live vote precedence;
- normal same-role substitution;
- good-people/strong-defense/own-goal rules;
- Best Formation without mutating persisted positions;
- in-memory live Rank projection;
- complete GroupLiveComposer composition across group/platform repositories;
- explicit assertion that live composition performs zero repository writes.

Related workstream: #30.
