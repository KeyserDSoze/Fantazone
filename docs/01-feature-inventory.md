# Legacy feature inventory

This inventory was created from the current Fantasoccer repository and is the initial parity checklist.

## Application shell and identity

- Expo React Native application with web target/PWA support.
- Tamagui design system.
- Light and dark themes with runtime switching.
- Responsive navigation and reusable layout components.
- Login and post-login redirect flow.
- Google/Microsoft identity must remain available in Fantazone.
- Persistent user state: selected year, group, league and acting/leader identity.
- Install-to-home-screen and service-worker update UX on web.

## Group and league management

- Group selection and group configuration.
- Group users administration and roles.
- Basket/competition administration.
- League creation/configuration and league settings editor.
- Multiple competitions inside one group: split leagues, global leagues and knockout/tournament-style competitions are first-class Fantazone goals.
- Team ownership by year and basket/league.
- Rules/settings screens and administrative editing.

## Match-day gameplay

- Formation management and copying forward the previous formation when required.
- Football-pitch visualization, player cards, swaps and player detail modal.
- Calendar and match/game view.
- Ranking/standings.
- Luck/chance calculations and detail display.
- Team statistics and validation.
- Live Serie A data and live votes.
- Real-player and real-vote views.
- Player statistics, odds and images.

## Market and roster management

- Player market.
- Trades between teams.
- Market rules and validations.
- Team list/details, budgets and roster state.
- Cards/card administration and card editing.

## Auction

Existing Fantasoccer includes:

- auction creation;
- auction types/kinds;
- live auction screen;
- auctioneer panel;
- current player display;
- player search;
- current/highest bid;
- custom bids;
- team/budget panels;
- remaining/discarded players;
- role/status changes;
- substitute selection;
- pause/resume/close/reset operations;
- timer updates/resets;
- emojis/reactions;
- connected-user join/leave state;
- auctioneer migration/change;
- player assignment and team updates.

Fantazone must preserve this UI/behavior while changing the transport from SignalR + HTTP API to WebRTC + GitHub snapshots.

## Historical/social/operations

- Hall of Fame.
- News (legacy job currently disabled but must be tracked).
- Application logs/history.
- Patch notes/version update UX.
- Push-notification management and push-notification job behavior; delivery mechanism requires a separate zero-server feasibility decision because push delivery normally requires an external push service.
- Administrative recalculation of one match day or all match days.

## Legacy frontend service surface to migrate

The existing React Native client has dedicated services for app identity, auction, auth, calendar, cards, chance, logs, formation, game, group, Hall of Fame, league manager, live group, market, push notifications, ranking, real players, real votes, recalculation, Serie A, settings, player statistics, team calculation and team state.

Each service will be replaced by one of:

1. a GitHub repository read/write adapter;
2. a pure local domain calculation;
3. a GitHub Actions command/workflow;
4. a WebRTC realtime operation.

No legacy HTTP API or SignalR call should remain after migration completion.
