# Claude Usage Optimizer

Claude Usage Optimizer is a local-first Next.js app that watches Claude usage, computes an optimal daily send schedule from observed peak patterns, and can trigger sends through the Claude CLI so two consecutive 5-hour windows cover your peak period.

## What it does

- Tracks Claude usage over time in a local SQLite database
- Computes a recommended send schedule from historical usage patterns
- Exposes a localhost-only dashboard for setup, monitoring, and manual control
- Supports optional nightly Google Cloud Storage backups
- Ships with an Ubuntu installer for a low-cost GCP VM deployment

## Security model

- The production dashboard is intended to stay bound to `127.0.0.1:3018`
- Secrets live outside the repo in environment files
- Local usage data under `data/` is gitignored

## Repo layout

- `src/` - Next.js app, API routes, scheduler, sender, and analysis logic
- `scripts/` - install and operational helper scripts
- `test/` - automated test suite
- `docs/` - deployment notes, hosting guide, and research docs

## Quick start

```bash
npm ci
npm run dev
```

Open `http://localhost:3017`.

## Production start

```bash
npm run build
npm run start:prod
```

The production server binds to `127.0.0.1:3018`.

## Tests

```bash
npm test
npm run lint
```

## Deployment

For the current VM flow, start with [docs/HOSTING-STRATEGY.md](docs/HOSTING-STRATEGY.md).
