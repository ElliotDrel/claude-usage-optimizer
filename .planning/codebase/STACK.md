# Technology Stack

**Analysis Date:** 2026-04-16

This is an umbrella repository containing two independent subprojects with different stacks. The long-term roadmap (see `README.md`) is to merge them so the tracker auto-triggers the sender.

- `Claude Usage Tracker/claude-usage-tracker/` — Next.js + TypeScript dashboard (polls Claude.ai usage API into local SQLite)
- `Claude Message Sender/` — Python scripts that send messages to Claude to intentionally start or shift the 5-hour usage window

Note: A working copy of the tracker also exists at `claude-usage-tracker/` (lowercase, at repo root). It is a build/runtime directory and is not git-tracked — the authoritative source is under `Claude Usage Tracker/claude-usage-tracker/`.

## Languages

**Primary:**
- TypeScript `^5` (strict mode) — used for all tracker app code under `Claude Usage Tracker/claude-usage-tracker/src/`
- Python 3 — used for all sender scripts under `Claude Message Sender/` (shebang `#!/usr/bin/env python3`)

**Secondary:**
- PowerShell — Windows startup/autostart scripts at `Claude Usage Tracker/claude-usage-tracker/scripts/*.ps1`
- CSS (Tailwind v4) — `Claude Usage Tracker/claude-usage-tracker/src/app/globals.css` (custom properties for theming)

## Runtime

**Tracker (Node/Next.js):**
- Node.js (required for Next.js 16). No `.nvmrc` or engines field pinned.
- Next.js server runs via `next dev` / `next start`.
- Collector uses Node native `fetch`, `node:fs`, `node:path`, `node:child_process` (in `src/instrumentation.ts`).

**Sender (Python):**
- Standard CPython 3 interpreter. No `pyproject.toml` / version pin — only `Claude Message Sender/requirements.txt`.

**Package Managers:**
- npm (tracker) — lockfile `Claude Usage Tracker/claude-usage-tracker/package-lock.json`. Note: a second lockfile exists at the working copy `claude-usage-tracker/package-lock.json` but `.gitignore` excludes `package-lock.json` within the subproject.
- pip (sender) — `requirements.txt` only; no lockfile.

## Frameworks

**Tracker core:**
- `next` 16.2.2 — App Router. Config at `Claude Usage Tracker/claude-usage-tracker/next.config.ts` (declares `serverExternalPackages: ["better-sqlite3"]` so the native module is not bundled).
- `react` 19.2.4 / `react-dom` 19.2.4
- `tailwindcss` `^4` with `@tailwindcss/postcss` plugin (`postcss.config.mjs`)
- Instrumentation hook at `src/instrumentation.ts` boots the collector + optionally opens the browser on server start.

**Tracker charts:**
- `recharts` `^3.8.1` — used in `src/components/UsageTimeline.tsx` and `src/components/PeakHours.tsx`

**Tracker utilities:**
- `date-fns` `^4.1.0` — used in `CollectorHealth.tsx`, `UsageCards.tsx`, `UsageTimeline.tsx`, `ExtraUsageCard.tsx`

**Sender:**
- `schedule>=1.2.0` (only declared dep in `Claude Message Sender/requirements.txt`)
- `pyautogui` (used but NOT declared in requirements.txt) — browser-driven sender relies on it (`claude_message_send_with_browser.py`)
- Standard library: `webbrowser`, `subprocess`, `schedule`, `bisect`, `tempfile`, `random`, `datetime`

**Testing:**
- Node built-in `node:test` runner (tracker). Scripts run via `tsx --test test/*.test.ts` (`package.json` → `"test"` script). Assertions via `node:assert/strict`.
- No test framework in sender — `test_send_now.py` is a manual trigger only.

**Build/Dev:**
- `next build` / `next start` for the tracker.
- `tsx` `^4.21.0` — executes TypeScript tests directly.
- `eslint` `^9` with `eslint-config-next` 16.2.2 — flat config at `Claude Usage Tracker/claude-usage-tracker/eslint.config.mjs` (extends `core-web-vitals` + `typescript`).

## Key Dependencies

**Critical (tracker):**
- `better-sqlite3` `^12.8.0` — synchronous embedded SQLite (see `src/lib/db.ts`). Enabled with WAL journal mode. Declared as an external in `next.config.ts` because it ships a native binding.
- `@types/better-sqlite3` `^7.6.13`

**Framework types:**
- `@types/node` `^20`, `@types/react` `^19`, `@types/react-dom` `^19`

**Critical (sender):**
- `schedule` — cron-like in-process scheduler
- `pyautogui` — UI automation for browser variant (undeclared dependency; runtime will fail without it if used)

## Configuration

**Tracker environment (see `Claude Usage Tracker/claude-usage-tracker/.env.example`):**
- `CLAUDE_SESSION_COOKIE` — full Cookie header from claude.ai (preferred auth). If it contains `lastActiveOrg`, org endpoint is derived automatically.
- `CLAUDE_BEARER_TOKEN` — OAuth bearer; used only when cookie is empty. Auto-read from `~/.claude/.credentials.json` (`claudeAiOauth.accessToken`) when blank (see `src/lib/config.ts` lines 39-49).
- `CLAUDE_ORG_ID` — fallback when cookie lacks `lastActiveOrg`
- `CLAUDE_USAGE_ENDPOINT` (legacy), `CLAUDE_BEARER_USAGE_ENDPOINT`, `CLAUDE_COOKIE_USAGE_ENDPOINT` — endpoint overrides
- `DEV_DEMO_MODE`, `PROD_DEMO_MODE` — demo mode toggles (dev defaults to demo ON; prod defaults to demo OFF)
- `APP_HOST`, `PORT`, `AUTO_OPEN_BROWSER`, `DATA_DIR`, `NODE_ENV`
- `.env.local` file exists at the working copy `claude-usage-tracker/.env.local` — contents not read here (secret).

**Tracker runtime config source of truth:** `Claude Usage Tracker/claude-usage-tracker/src/lib/config.ts` — exposes a `Config` interface and a pure `getConfig()` factory. Consumers: `instrumentation.ts`, `collector.ts`, `collector-singleton.ts`, all API routes.

**Tracker scripts (`package.json` scripts):**
- `dev` — `APP_HOST=localhost`, `PORT=3017`, `AUTO_OPEN_BROWSER=true`, `next dev`
- `start:prod` — `APP_HOST=127.0.0.1`, `PORT=3018`, `AUTO_OPEN_BROWSER=false`, `next start`
- `startup:install` / `startup:restart` / `startup:uninstall` — wrap PowerShell scripts in `scripts/` to register a Windows Scheduled Task that launches the app at logon (see `scripts/install-startup.ps1`, `scripts/start-app.ps1`).
- `lint` — `eslint`
- `test` — `tsx --test test/*.test.ts`

**Tracker TypeScript (`tsconfig.json`):**
- `strict: true`, `target: ES2017`, `module: esnext`, `moduleResolution: bundler`, `jsx: react-jsx`
- Path alias: `@/*` → `./src/*`
- Excludes `node_modules`

**Sender configuration:** In-file constants at the top of each script (e.g., `start_time = "05:05"`, `interval_hours = 5`, `CLAUDE_MODEL = "haiku"`, `QUESTIONS = [...]` in `claude_message_send_with_CC_CLI.py`). No env vars.

## Platform Requirements

**Development:**
- Node.js + npm for the tracker. The dev script uses Windows-style `set VAR=value&& ...` so `npm run dev` assumes a Windows shell (cmd.exe / PowerShell). On POSIX shells the env vars will not be exported correctly.
- Python 3 + pip for the sender. `pyautogui` requires a local display/desktop session for the browser variant.

**Production:**
- Tracker: designed for **local desktop deployment on Windows** — the PowerShell scripts under `Claude Usage Tracker/claude-usage-tracker/scripts/` register a `ClaudeUsageTracker` Scheduled Task that runs `npm run start` bound to `127.0.0.1:3018` at user logon. Requires a production build (`npm run build`) before installation.
- No container, CI, or cloud deployment artifacts (no Dockerfile, no `.github/workflows/`, no `vercel.json`).
- Data persists to a local SQLite file at `${DATA_DIR or cwd/data}/usage.db` (or `demo.db` in demo mode). Dir is `.gitignore`d via `**/data/`.

**Storage:**
- SQLite database file (path resolved in `src/lib/config.ts` as `path.join(dataDir, demoMode ? "demo.db" : "usage.db")`).
- Schema + migrations defined inline in `src/lib/db.ts` (`SCHEMA`, `MIGRATIONS`, and `migrateExtraUsageMoneyToDollars`).

---

*Stack analysis: 2026-04-16*
