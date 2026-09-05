# Legacy frontend service migration matrix

The Fantasoccer app remains the product reference. Fantazone replaces backend/storage/realtime responsibilities while schema v2 persists readable domain JSON directly.

Legend: **GitHub R/W**, **Local**, **Action**, **WebRTC**.

| Fantasoccer service | Fantazone replacement |
|---|---|
| `appIdentityService` | remove central AppIdentity repository; Microsoft/Google proves identity after group selection, membership/roles come from selected `Group.users`, UI selection stays local |
| `authService` | provider-native login on `fanta.plus`; Microsoft active now, Google adapter feature-flagged off until its client is configured; no Fantasoccer JWT exchange |
| `tokenStorageService` | separate social session and GitHub group credential storage |
| `groupService` | GitHub R/W readable `Group` at `config/group.json` |
| `calendarService` | GitHub R readable `Calendar`; generation/rebuild Local/Action |
| `rankService` | GitHub R/W readable `Rank` season/day projections |
| `chanceService` | GitHub R inputs + Local derived calculations |
| `realPlayerService` | GitHub R global Serie A data using readable models |
| `realVoteService` | GitHub R global vote data; ingestion Action |
| `serieAService` | GitHub R global calendar/ranking/live data; ingestion Action |
| `statPlayerService` | GitHub R derived statistics; Action/Local reducers |
| `teamService` | GitHub R/W readable `Team` season/day documents; optional moneyFromRank from selected Rank repository |
| `formationService` | Local shared formation rules + GitHub R/W `TeamDay`; no separate formation document. Chance/stat-driven automatic formation will migrate after those inputs exist |
| `teamCalculatorService` | shared Local deterministic calculation |
| `gameService` | `GroupGameComposer` for local reads + `GroupFormationWriter` for validated position-only TeamDay writes; later Local scoring/live enrichment |
| `liveGroupService` | readable schema-v2 LiveGroup projection + Local helpers |
| `leagueManagerService` | Local algorithms + manual/scheduled Actions |
| `recalculationService` | group Action `workflow_dispatch` using shared reducers |
| `marketService` | readable command/event JSON + Local validation + Action reducer |
| `cardService` | GitHub R/W readable configuration/entity JSON |
| `settingsService` | GitHub R/W readable config; assets in repository content |
| `hallOfFameService` | GitHub R readable historical projection; Action rebuild |
| `fantasoccerLogService` | Git history + structured readable event/diagnostic JSON |
| `pushNotificationService` | GitHub preferences + separate push transport decision |
| `auctionService` | GitHub initial/final readable state + WebRTC realtime transport |

## Migration rule for every remaining service

1. enumerate behavior and callers;
2. define the readable domain document using full property names;
3. preserve deterministic business behavior, not old serialization abbreviations;
4. prefer narrow commands over accepting mutable aggregate JSON from the UI;
5. add GitHub adapter/Action reducer around the same document types;
6. add representative tests and concurrency tests for writes;
7. migrate UI callers;
8. remove old HTTP/SignalR/repository-framework dependencies.

Do not introduce `*Raw` mirror types merely to reproduce historical one-letter JSON names.
