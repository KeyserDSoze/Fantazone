# Legacy frontend service migration matrix

The existing Fantasoccer React Native application is intentionally the UI/product source of truth. Its service layer is the seam where backend/storage/realtime calls are replaced.

Legend:

- **GitHub R** — direct repository read;
- **GitHub W** — direct repository write/append command;
- **Local** — deterministic TypeScript calculation in the app/shared domain package;
- **Action** — GitHub Action / job runner;
- **WebRTC** — live auction peer transport.

| Fantasoccer service | Existing responsibility | Fantazone replacement |
|---|---|---|
| `appIdentityService` | load/update application identity and selected state | Google/Microsoft identity + local selected-state cache + GitHub R/W group member/profile data |
| `authService` | backend social-token exchange, refresh and user lookup | provider-native Google/Microsoft login; remove Fantasoccer JWT dependency; GitHub PAT remains a separate repository credential |
| `tokenStorageService` | backend JWT/refresh persistence | split into social-session storage and GitHub group credential storage; secure native storage, explicit web policy |
| `groupService` | group, baskets, years, users/roles | GitHub R/W under `config/`, `members/` and group data |
| `calendarService` | fantasy league calendar | GitHub R of generated calendar; generation/rebuild is Local/Action |
| `rankService` | rankings/standings | GitHub R of derived rank; reducer calculation shared Local/Action |
| `chanceService` | chance/luck data | GitHub R global/day inputs + Local calculation/derived group data as appropriate |
| `realPlayerService` | real Serie A player master data | GitHub R from global normalized data |
| `realVoteService` | real/live/final fantasy votes | GitHub R from global normalized data; global ingestion Action |
| `serieAService` | real calendar/ranking/live Serie A | GitHub R global data; global ingestion/rank Action |
| `statPlayerService` | player statistics | GitHub R global derived statistics; global Action/Local reducers |
| `teamService` | team/season/day data | GitHub R/W group team/formations files with SHA concurrency |
| `formationService` | formation state and edits | GitHub R/W one team/day file; append command/event where concurrent mutation matters |
| `teamCalculatorService` | fantasy team/day score calculation | shared Local domain calculation; same reducer used by group recalculation Action |
| `gameService` | game/day load, save formation/team | compose GitHub R global+group inputs; GitHub W formations/team changes; Local score calculation |
| `liveGroupService` | derived live group state | GitHub R inputs + Local live projection; optional periodically committed derived snapshot |
| `leagueManagerService` | create calendar/rank, randomize auctions, recalculate | Local deterministic algorithms and manually/scheduled group Actions; no HTTP controller |
| `recalculationService` | recalc one day / statistics | group Action `workflow_dispatch` for one day/all/stat rebuild; same shared domain reducers |
| `marketService` | trades/market state and operations | GitHub append-only commands/events + Local validation + group Action/reducer for scheduled processing |
| `cardService` | card CRUD | GitHub R/W configuration/entity files; preserve current UI |
| `settingsService` | league/group settings and logo upload/copy | GitHub R/W config; logos/assets become repository static content |
| `hallOfFameService` | historical Hall of Fame data | GitHub R; group Action rebuild/aggregation |
| `fantasoccerLogService` | application/business logs | Git commit history + structured `events/`/diagnostic artifacts; preserve user-visible log screen where useful |
| `pushNotificationService` | notification preferences/subscriptions | GitHub R/W preferences; decision logic Local/Action; actual push transport requires separate infrastructure decision |
| `auctionService` | auction HTTP API + SignalR connection/events | GitHub R/W initial/final state + **WebRTC** star transport; auctioneer device authoritative host |

## Legacy HTTP endpoints that become commands/calculations

Known API-backed operations include:

- card CRUD;
- game load/save formation/save team;
- league calendar/rank creation;
- randomized auction player ordering;
- one-day/last-day/precise-day league recalculation;
- general day/stat recalculation;
- market retrieval/operations;
- settings/logo operations;
- auction creation/initial state.

None should survive as a custom Fantazone HTTP endpoint. Each must end as GitHub state, a deterministic function, an Action command, or WebRTC realtime operation.

## Repository-framework entities already used by the client

The Fantasoccer client directly models repository-backed data including at least:

- `AppIdentity`;
- `RealPlayers`;
- `VotedRealPlayerWrapper/live` and vote wrappers;
- `Team`;
- `LiveGroup`;
- `Calendar`;
- `StatPlayersWrapper`;
- `Rank`;
- `RealRank`;
- `ChancedRealPlayerWrapper`;
- `PushNotificationSettings`.

During migration, keep the existing clean TypeScript models/mappers where possible and replace only the persistence adapter first. This lets screens/components move nearly unchanged and reduces simultaneous UI + business + transport risk.

## Migration rule for each service

1. enumerate public methods and existing tests/callers;
2. preserve its TypeScript-facing contract where useful;
3. replace backend/repository implementation behind the contract;
4. add parity fixture/tests;
5. migrate screens/hooks;
6. delete the old HTTP/SignalR/backend-token dependency only when no caller remains.
