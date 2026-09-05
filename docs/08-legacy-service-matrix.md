# Legacy frontend service migration matrix

The Fantasoccer app remains the product reference. Fantazone replaces backend/storage/realtime responsibilities while schema v2 persists readable domain JSON directly.

Legend: **GitHub R/W**, **Local**, **Action**, **WebRTC**.

| Fantasoccer service | Fantazone replacement |
|---|---|
| `appIdentityService` | remove central AppIdentity repository; OAuth proves identity and selected `Group.users` supplies membership/roles |
| `authService` | provider-native login on `fanta.plus`; no Fantasoccer JWT exchange |
| `tokenStorageService` | separate social session and GitHub group credential storage |
| `groupService` | GitHub R/W readable `Group` at `config/group.json` |
| `calendarService` | GitHub R/W readable fantasy `Calendar`; generation/progression through shared domain logic and group Actions |
| `rankService` | GitHub R/W canonical `Rank`; live projection Local through `applyLiveRoundsToRank()` |
| `chanceService` | GitHub R inputs + Local derived calculations |
| `realPlayerService` | GitHub R global Serie A data |
| `realVoteService` | GitHub R global vote data; ingestion Action |
| `serieAService` | GitHub R global football data; Actions only for external producers |
| `statPlayerService` | GitHub R derived statistics; Action/Local reducers |
| `teamService` | GitHub R/W readable Team season/day documents |
| `formationService` | Local validation/rules + GitHub R/W `TeamDay` |
| `teamCalculatorService` | Local deterministic `calculateVoteValue()` + `calculateTeamPoint()` |
| `gameService` | Local `GroupGameComposer` + `GroupFormationWriter`; definitive scoring uses `calculateDefinitiveDay()` |
| `liveGroupService` | Local `GroupLiveComposer`; no backend aggregate/cache loop |
| `leagueManagerService` | Local ranking/progression algorithms + group Action only when canonical persistence is required |
| `recalculationService` | group-owned `workflow_dispatch`: `recalculate-day` / `recalculate-all`; no backend endpoint |
| `marketService` | readable command/event JSON + Local validation + group Action reducer |
| `cardService` | GitHub R/W readable configuration/entity JSON |
| `settingsService` | GitHub R/W readable config/assets |
| `hallOfFameService` | GitHub R historical projection; group Action rebuild |
| `fantasoccerLogService` | Git history + structured readable event/diagnostic JSON |
| `pushNotificationService` | GitHub preferences + separate push transport decision |
| `auctionService` | GitHub durable state + WebRTC realtime transport |

## Recalculation replacement in detail

The old admin API name was misleading: its day recalculation endpoint only regenerated official votes. Fantazone makes the split explicit:

```text
provider -> global ingest-final-votes
                    |
                    v
            official vote JSON
                    |
                    v
Fantazone.<group> workflow_dispatch
        -> calculateDefinitiveDay()
        -> calculateRankFromCalendar()
        -> progressLeagueCalendar()
        -> Calendar + season/daily Rank commit
```

This also replaces the useful part of legacy `GroupsManagerJob` without recreating a central service.

## Migration rule for every remaining service

1. enumerate behavior and callers;
2. define/read the readable schema-v2 document;
3. preserve deterministic business behavior rather than old transport details;
4. decide whether the old server operation is a real producer/write or just a derived cache;
5. prefer Local composition for deterministic read models;
6. use platform Actions only for global ingestion and group Actions only for group-owned persistence;
7. add representative parity/concurrency tests;
8. migrate UI callers;
9. remove HTTP/SignalR/repository-framework dependencies.

Do not introduce `*Raw` mirror types merely to reproduce historical one-letter JSON names.
