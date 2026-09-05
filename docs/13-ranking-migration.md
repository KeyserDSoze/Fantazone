# Ranking migration

Ranking uses two canonical paths inside the selected group repository:

```text
data/groups/seasons/<season>/leagues/<league>/ranking.json
data/groups/seasons/<season>/leagues/<league>/days/<day>/ranking.json
```

## Schema v2

`GitHubRankRepository` reads and writes `Rank` directly. The document exposes `serieADay`, `rounds` and full `RankedTeam` names such as `owner`, `victories`, `sufferedGoal`, `valuePoint` and `valueAssets`.

No compact serialization is produced for Actions. The app and Actions share the same readable domain document.

## Shared domain behavior

The migration preserves:

- ranking by points/value assets;
- 1-based team position;
- goal difference;
- games played / points per game;
- enhanced rankings;
- aggregate RankedTeam addition;
- season/daily write methods with GitHub SHA conflict handling.

Authentication and available-year decisions stay outside Ranking domain code.
