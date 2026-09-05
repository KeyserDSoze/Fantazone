# Migration checklist

`[ ]` pending, `[~]` in progress/scaffolded, `[x]` implemented with tests.

## Foundation

- [x] Initialize Fantazone repository and documentation.
- [~] Expo/React Native/Tamagui app.
- [~] shared TypeScript domain/GitHub client/Actions runner.
- [~] GitHub Pages at canonical `https://fanta.plus`.
- [x] readable JSON schema v2; no single-letter persistence for migrated features.

## Identity and groups

- [ ] Wire Google login after group selection to configured `fanta.plus` client.
- [ ] Wire Microsoft login after group selection to configured `fanta.plus` client.
- [~] PAT validation/repository discovery before login.
- [x] readable Group initialization and `group.users` membership resolution.
- [~] secure credential persistence / invite / group switch / login gate.
- [~] GroupSession shares Group/Calendar/Ranking/Team/LiveGroup repositories.
- [ ] authenticated session after provider membership resolution.

## UI parity

- [ ] App shell/Home.
- [ ] Calendar/Game/day/Formation UI.
- [ ] Ranking/luck UI.
- [ ] Live Serie A/votes.
- [ ] Players/statistics/Teams.
- [ ] Market/trades/cards/group admin/settings.
- [ ] Hall of Fame/logs/patch notes/push UX.

## Service/domain migrations

- [x] Group.
- [x] Calendar.
- [x] Ranking.
- [x] Team/Player.
- [x] LiveGroup readable snapshot/helpers/repository.
- [ ] Game/day composition.
- [ ] Formations.
- [ ] Real players / Serie A.
- [ ] Statistics/chances/votes.
- [ ] Market persistence/commands.

## Infrastructure backlog

- [ ] Replace remaining `buildApiUrl(...)` calls.
- [~] remove backend JWT/AppIdentity dependency; OAuth adapter pending.
- [~] replace `rystem.repository.client` with GitHub adapters.
- [ ] replace Azure/static URLs.
- [~] SHA cache + optimistic concurrency.
- [ ] ETag conditional reads.
- [ ] one-time schema-v1→v2 migration tooling if any compact runtime repositories exist.

## Background jobs

- [ ] Serie A/player/team ingestion.
- [ ] live/final votes, odds/images.
- [ ] formation/groups manager.
- [ ] HallOfFame/Market.
- [ ] day/full-season recalculation.

## Auction

- [ ] readable schema-v2 auction domain/state.
- [ ] UI + WebRTC host/participants + GitHub signaling.
- [ ] timer/bid/idempotency/reconnection/STUN/TURN.

## Definition of done

A feature preserves desired Fantasoccer behavior, uses readable schema-v2 JSON, has representative tests and no longer depends on the legacy backend/storage transport.
