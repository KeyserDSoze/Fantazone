# Calendar migration: first end-to-end repository slice

Calendar is the first Fantasoccer feature migrated through the complete domain/persistence pattern.

## Legacy shape

The React Native `calendarService` used `rystem.repository.client`:

```text
CalendarService
  -> RepositoryServices.Repository<CalendarRaw, LeagueKeyRaw>('Calendar')
  -> mapRawCalendarToCalendar
  -> CalendarHelper
```

Its logical key contained `group + league + year` because all groups shared one backend repository.

## Fantazone shape

A Fantazone repository already identifies the group, so the group component no longer belongs in every document key:

```text
GitHubCalendarRepository
  -> GitHubJsonStore
  -> Fantazone.<group>
  -> data/groups/seasons/<season>/leagues/<league>/calendar.json
  -> mapRawCalendarToCalendar
  -> CalendarHelper
```

The compact raw calendar representation and helper behavior are ported from Fantasoccer into `@fantazone/domain`. This preserves the existing wire/data semantics while replacing only the persistence mechanism.

## Why this is the migration template

Calendar demonstrates the intended sequence for other services:

1. copy the compact raw contract and deterministic helpers into the shared domain package;
2. port representative parity tests before changing behavior;
3. define one canonical repository path;
4. write a GitHub-backed repository adapter around `GitHubJsonStore`;
5. expose clean domain objects to future screens;
6. let the store own SHA/cache/conflict concerns.

React screens therefore do not call `fetch('https://api.github.com/...')` and do not know about base64 or GitHub content SHAs.

## Current scope

Migrated in this slice:

- raw/clean calendar contracts;
- compact-model mapping;
- result helpers;
- fantasy goal threshold calculation;
- round/day/game helpers;
- pending games;
- case-insensitive team lookup;
- enhanced calendar projection;
- GitHub repository read adapter and canonical path;
- cache reuse through the shared JSON store.

Still pending:

- Calendar screen/navigation parity;
- Actions that generate/recalculate the canonical calendar file;
- integration with rankings and game/day views;
- migration fixtures captured from a real Fantasoccer group dataset.
