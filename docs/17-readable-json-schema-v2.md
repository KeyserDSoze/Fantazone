# Readable JSON schema v2

## Decision

Fantazone intentionally removes Fantasoccer's abbreviated JSON property names. GitHub is now the durable, inspectable state store, so a person opening a repository should understand a document without a mapper or field legend.

Examples:

```text
u → username
e → email
r → role
n → name
o → owner
p → players / point (depending on the old type)
```

Schema v2 does not perform a mechanical global letter replacement. Each field uses its real domain name. Ambiguous legacy settings were resolved from the original C# properties, e.g. `mg` becomes `maxGoalKeepersInBench`.

## One model, one document

For persisted aggregates, the TypeScript domain type is also the JSON shape. Infrastructure may still parse transport metadata (GitHub SHA/ETag) and code may expose helpers for JSON-native values such as ISO dates, but there is no duplicate naming model.

## Compatibility policy

This is a breaking schema change. Existing schema-v1 compact repositories must be migrated once. Runtime code does not keep permanent v1→v2 mapping because that would recreate the dual-model complexity this change removes.

New repositories declare `schemaVersion: 2` and start with readable documents.

## Migration rule for future features

When LiveGroup, Formation, Market, Serie A data, statistics, cards, auctions or other features are ported:

1. start from the real Fantasoccer domain meaning;
2. use descriptive camelCase property names;
3. make the persisted JSON directly match that domain document;
4. preserve business semantics/calculations, not abbreviated serialization names;
5. add tests that inspect the readable persisted shape;
6. never add a `*Raw` mirror solely to restore one-letter keys.

## Web origin

The canonical web origin for GitHub Pages, invitations and OAuth configuration is `https://fanta.plus`.
