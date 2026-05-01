# Contributing

## Before opening changes

- Read `CLAUDE.md` for project constraints and operating assumptions.
- Keep the dashboard localhost-only in production.
- Do not commit secrets, local data, or environment files.

## Development

```bash
npm ci
npm run dev
```

## Validation

Run the relevant checks before proposing changes:

```bash
npm test
npm run lint
```

## Scope discipline

- Keep changes tightly scoped.
- Update docs when behavior or setup changes.
- Avoid committing machine-specific artifacts, local logs, or scratch files.
