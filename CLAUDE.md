## Project

**Claude Usage Optimizer** — A Next.js app that observes Claude.ai usage, computes an optimal daily send schedule from historical peak patterns, and fires messages via `claude` CLI so two consecutive 5-hour windows span your peak usage period.

**Core Value:** The scheduled anchor send fires at the midpoint of the detected 4-hour peak block, guaranteeing two consecutive 5-hour windows span your peak usage period. Everything else is scaffolding.

## Hard Constraints

These are non-negotiable. Violating any of these is a bug.

- **Auth**: `CLAUDE_CODE_OAUTH_TOKEN` only. Never `ANTHROPIC_API_KEY`, never `claude --bare`.
- **Hosting**: Free-forever tier. GCP e2-micro + 2 GB swap.
- **Deployability**: Non-technical user must install end-to-end. Simplicity is a hard requirement.
- **Runtime**: Node.js only. No Python. No Playwright. No browser automation.
- **Single-process**: One Next.js app, one systemd unit, one log stream.
- **Storage**: SQLite on disk (append-only single-writer). Nightly GCS backup. Max 24h data loss.
- **Security**: Dashboard bound to `127.0.0.1:3018`. Never exposed publicly.
- **Cost**: $0/month.

## Context Routing

Before modifying code, read the relevant reference doc. Do not rely on memory for conventions or architecture — read the source of truth.

| Need to understand... | Read this |
|---|---|
| Stack, frameworks, deps, config, env vars | `.planning/codebase/STACK.md` |
| Naming, code style, imports, function design | `.planning/codebase/CONVENTIONS.md` |
| Architecture, layers, data flow, key abstractions | `.planning/codebase/ARCHITECTURE.md` |
| File tree and module layout | `.planning/codebase/STRUCTURE.md` |
| Test patterns and coverage | `.planning/codebase/TESTING.md` |
| Integration points between subprojects | `.planning/codebase/INTEGRATIONS.md` |
| Known tech debt and risks | `.planning/codebase/CONCERNS.md` |
| Project roadmap and phases | `.planning/ROADMAP.md` |
| Requirements and success criteria | `.planning/REQUIREMENTS.md` |
| Current project state | `.planning/STATE.md` |

## Quick Reference

These are high-frequency lookups that save a file read:

- **Dev server**: `npm run dev` (localhost:3017, demo mode ON)
- **Prod server**: `npm run start:prod` (127.0.0.1:3018, demo OFF)
- **Tests**: `npm test` (runs `tsx --test test/*.test.ts`)
- **Lint**: `npm run lint`
- **Build**: `npm run build`
- **Tracker source**: `Claude Usage Tracker/claude-usage-tracker/src/`
- **Sender source**: `Claude Message Sender/`
- **Path alias**: `@/*` maps to `./src/*`
