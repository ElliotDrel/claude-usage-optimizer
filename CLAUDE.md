<!-- GSD:project-start source:PROJECT.md -->
## Project

**Claude Usage Optimizer**

A single Next.js application that observes your Claude.ai usage, computes an optimal daily send schedule from historical peak patterns, and automatically fires messages via the `claude` CLI so one 5-hour window boundary lands at the midpoint of your 4-hour peak block — letting you drain two full 5-hour budgets across your peak period instead of one. Hosted on a free GCP e2-micro VM; deployable end-to-end by a non-technical user via a single bootstrap script.

**Core Value:** **The scheduled anchor send fires at the midpoint of the detected 4-hour peak block, guaranteeing two consecutive 5-hour windows span your peak usage period.**

Everything else is scaffolding. If this one thing works, the product is valuable.

### Constraints

- **Authentication**: `CLAUDE_CODE_OAUTH_TOKEN` only. Never `ANTHROPIC_API_KEY`, never `claude --bare`. The project's entire purpose is exercising Pro/Max 5-hour windows, which API-key billing bypasses.
- **Hosting**: Must run on a free-forever tier. GCP e2-micro is the chosen target. 1 GB RAM is below Anthropic's stated 4 GB minimum — mitigated by a 2 GB swap file.
- **Deployability**: A non-technical user must be able to install this end-to-end. "Simplicity is a hard requirement, not a nice-to-have." Every automatable step is automated; every remaining step is copy-pasteable and foolproof.
- **Runtime**: Node.js only. No Python. No Playwright. No browser automation.
- **Single-process**: One Next.js app, one systemd unit (`claude-tracker.service`), one log stream (`journalctl -u claude-tracker`).
- **Storage**: SQLite on VM disk (workload is append-only single-writer). Nightly backup to GCS. No more than 24 hours of data loss tolerance.
- **Security**: Dashboard never exposed to the public internet. Bound to `127.0.0.1:3018`, reached via SSH tunnel or Tailscale.
- **Cost**: $0/month target. GCP Always-Free (VM + GCS 5 GB) + OAuth token (Pro/Max subscription already paid).
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

- `Claude Usage Tracker/claude-usage-tracker/` — Next.js + TypeScript dashboard (polls Claude.ai usage API into local SQLite)
- `Claude Message Sender/` — Python scripts that send messages to Claude to intentionally start or shift the 5-hour usage window
## Languages
- TypeScript `^5` (strict mode) — used for all tracker app code under `Claude Usage Tracker/claude-usage-tracker/src/`
- Python 3 — used for all sender scripts under `Claude Message Sender/` (shebang `#!/usr/bin/env python3`)
- PowerShell — Windows startup/autostart scripts at `Claude Usage Tracker/claude-usage-tracker/scripts/*.ps1`
- CSS (Tailwind v4) — `Claude Usage Tracker/claude-usage-tracker/src/app/globals.css` (custom properties for theming)
## Runtime
- Node.js (required for Next.js 16). No `.nvmrc` or engines field pinned.
- Next.js server runs via `next dev` / `next start`.
- Collector uses Node native `fetch`, `node:fs`, `node:path`, `node:child_process` (in `src/instrumentation.ts`).
- Standard CPython 3 interpreter. No `pyproject.toml` / version pin — only `Claude Message Sender/requirements.txt`.
- npm (tracker) — lockfile `Claude Usage Tracker/claude-usage-tracker/package-lock.json`. Note: a second lockfile exists at the working copy `claude-usage-tracker/package-lock.json` but `.gitignore` excludes `package-lock.json` within the subproject.
- pip (sender) — `requirements.txt` only; no lockfile.
## Frameworks
- `next` 16.2.2 — App Router. Config at `Claude Usage Tracker/claude-usage-tracker/next.config.ts` (declares `serverExternalPackages: ["better-sqlite3"]` so the native module is not bundled).
- `react` 19.2.4 / `react-dom` 19.2.4
- `tailwindcss` `^4` with `@tailwindcss/postcss` plugin (`postcss.config.mjs`)
- Instrumentation hook at `src/instrumentation.ts` boots the collector + optionally opens the browser on server start.
- `recharts` `^3.8.1` — used in `src/components/UsageTimeline.tsx` and `src/components/PeakHours.tsx`
- `date-fns` `^4.1.0` — used in `CollectorHealth.tsx`, `UsageCards.tsx`, `UsageTimeline.tsx`, `ExtraUsageCard.tsx`
- `schedule>=1.2.0` (only declared dep in `Claude Message Sender/requirements.txt`)
- `pyautogui` (used but NOT declared in requirements.txt) — browser-driven sender relies on it (`claude_message_send_with_browser.py`)
- Standard library: `webbrowser`, `subprocess`, `schedule`, `bisect`, `tempfile`, `random`, `datetime`
- Node built-in `node:test` runner (tracker). Scripts run via `tsx --test test/*.test.ts` (`package.json` → `"test"` script). Assertions via `node:assert/strict`.
- No test framework in sender — `test_send_now.py` is a manual trigger only.
- `next build` / `next start` for the tracker.
- `tsx` `^4.21.0` — executes TypeScript tests directly.
- `eslint` `^9` with `eslint-config-next` 16.2.2 — flat config at `Claude Usage Tracker/claude-usage-tracker/eslint.config.mjs` (extends `core-web-vitals` + `typescript`).
## Key Dependencies
- `better-sqlite3` `^12.8.0` — synchronous embedded SQLite (see `src/lib/db.ts`). Enabled with WAL journal mode. Declared as an external in `next.config.ts` because it ships a native binding.
- `@types/better-sqlite3` `^7.6.13`
- `@types/node` `^20`, `@types/react` `^19`, `@types/react-dom` `^19`
- `schedule` — cron-like in-process scheduler
- `pyautogui` — UI automation for browser variant (undeclared dependency; runtime will fail without it if used)
## Configuration
- `CLAUDE_SESSION_COOKIE` — full Cookie header from claude.ai (preferred auth). If it contains `lastActiveOrg`, org endpoint is derived automatically.
- `CLAUDE_BEARER_TOKEN` — OAuth bearer; used only when cookie is empty. Auto-read from `~/.claude/.credentials.json` (`claudeAiOauth.accessToken`) when blank (see `src/lib/config.ts` lines 39-49).
- `CLAUDE_ORG_ID` — fallback when cookie lacks `lastActiveOrg`
- `CLAUDE_USAGE_ENDPOINT` (legacy), `CLAUDE_BEARER_USAGE_ENDPOINT`, `CLAUDE_COOKIE_USAGE_ENDPOINT` — endpoint overrides
- `DEV_DEMO_MODE`, `PROD_DEMO_MODE` — demo mode toggles (dev defaults to demo ON; prod defaults to demo OFF)
- `APP_HOST`, `PORT`, `AUTO_OPEN_BROWSER`, `DATA_DIR`, `NODE_ENV`
- `.env.local` file exists at the working copy `claude-usage-tracker/.env.local` — contents not read here (secret).
- `dev` — `APP_HOST=localhost`, `PORT=3017`, `AUTO_OPEN_BROWSER=true`, `next dev`
- `start:prod` — `APP_HOST=127.0.0.1`, `PORT=3018`, `AUTO_OPEN_BROWSER=false`, `next start`
- `startup:install` / `startup:restart` / `startup:uninstall` — wrap PowerShell scripts in `scripts/` to register a Windows Scheduled Task that launches the app at logon (see `scripts/install-startup.ps1`, `scripts/start-app.ps1`).
- `lint` — `eslint`
- `test` — `tsx --test test/*.test.ts`
- `strict: true`, `target: ES2017`, `module: esnext`, `moduleResolution: bundler`, `jsx: react-jsx`
- Path alias: `@/*` → `./src/*`
- Excludes `node_modules`
## Platform Requirements
- Node.js + npm for the tracker. The dev script uses Windows-style `set VAR=value&& ...` so `npm run dev` assumes a Windows shell (cmd.exe / PowerShell). On POSIX shells the env vars will not be exported correctly.
- Python 3 + pip for the sender. `pyautogui` requires a local display/desktop session for the browser variant.
- Tracker: designed for **local desktop deployment on Windows** — the PowerShell scripts under `Claude Usage Tracker/claude-usage-tracker/scripts/` register a `ClaudeUsageTracker` Scheduled Task that runs `npm run start` bound to `127.0.0.1:3018` at user logon. Requires a production build (`npm run build`) before installation.
- No container, CI, or cloud deployment artifacts (no Dockerfile, no `.github/workflows/`, no `vercel.json`).
- Data persists to a local SQLite file at `${DATA_DIR or cwd/data}/usage.db` (or `demo.db` in demo mode). Dir is `.gitignore`d via `**/data/`.
- SQLite database file (path resolved in `src/lib/config.ts` as `path.join(dataDir, demoMode ? "demo.db" : "usage.db")`).
- Schema + migrations defined inline in `src/lib/db.ts` (`SCHEMA`, `MIGRATIONS`, and `migrateExtraUsageMoneyToDollars`).
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Scope
## Naming Patterns
- Library/logic modules: `kebab-case.ts` (e.g., `Claude Usage Tracker/claude-usage-tracker/src/lib/auth-diagnostics.ts`, `src/lib/collector-singleton.ts`, `src/lib/usage-window.ts`)
- Single-word lib modules: `lowercase.ts` (e.g., `src/lib/db.ts`, `src/lib/config.ts`, `src/lib/collector.ts`, `src/lib/analysis.ts`, `src/lib/normalize.ts`)
- React components: `PascalCase.tsx` (e.g., `src/components/CollectorHealth.tsx`, `src/components/UsageCards.tsx`, `src/components/ExtraUsageCard.tsx`)
- Next.js route files: lowercase conventional names (`src/app/page.tsx`, `src/app/layout.tsx`, `src/app/api/dashboard/route.ts`)
- Test files: `<module>.test.ts` matching source name (e.g., `test/collector.test.ts` tests `src/lib/collector.ts`)
- `snake_case.py` (e.g., `Claude Message Sender/claude_message_send_with_CC_CLI.py`, `Claude Message Sender/test_send_now.py`)
- TypeScript: `camelCase` verb-first (`getConfig`, `insertSnapshot`, `buildDashboardData`, `computeNextDelay`, `normalizeUsagePayload`, `parseBooleanEnv`)
- Private helper functions: `camelCase`, module-local (no `export`) — see `toLabel` in `src/lib/normalize.ts`, `tryReadClaudeCredentials` in `src/lib/config.ts`
- Type guard functions: `is<Type>` (`isUsageBucket` in `src/lib/normalize.ts`, `isSameUsageWindow` in `src/lib/usage-window.ts`)
- React components: `PascalCase` function components (`CollectorHealth`, `UsageCards`, `StatusPill`, `Section`)
- `camelCase` for locals and parameters (`sessionCookie`, `isDevelopment`, `demoFiveHour`)
- `UPPER_SNAKE_CASE` for module-level constants (`TIER_DELAYS`, `TIER_DOWN`, `ERROR_BACKOFF`, `SCHEMA`, `MIGRATIONS`, `COOLDOWN_MS`, `OAUTH_USAGE_ENDPOINT`, `COLORS`, `RANGE_CONFIG`)
- Underscore-prefix for singleton globals hanging off `globalThis` (`_usageCollector` in `src/lib/collector-singleton.ts`)
- `PascalCase` for interfaces and type aliases (`Config`, `SnapshotRow`, `CollectorState`, `TierState`, `PollResult`, `DashboardData`, `NormalizedPayload`, `ExtraUsageData`, `HourlyBar`, `HeatmapCell`, `TimelinePoint`)
- String literal unions over enums: `type Tier = "idle" | "light" | "active" | "burst"` (`src/lib/collector.ts:9`), `authMode: "bearer" | "cookie" | "none"` (`src/lib/config.ts:16`)
- Prefer `interface` for object shapes, `type` for unions and computed types
- `snake_case` in SQLite (`five_hour_utilization`, `seven_day_resets_at`, `extra_usage_monthly_limit`) — see `src/lib/db.ts:7-40`
- Mapped to `camelCase` when passed through the insert function (`fiveHourUtilization`, `sevenDayResetsAt`) — see `src/lib/db.ts:110-157`
## Code Style
- No Prettier config detected; formatting is hand-consistent
- Indentation: 2 spaces
- Double quotes for string literals throughout (`"node:test"`, `"ok"`, `"bearer"`)
- Template literals with backticks for interpolation (`` `http://${host}:${port}` ``)
- Trailing commas in multi-line arrays/objects (see `src/lib/collector.ts:37` for the `ERROR_BACKOFF` array and `src/lib/db.ts:91-108` for interface definitions)
- Semicolons required at statement ends
- Arrow functions for callbacks and module-level helpers inside `React.useMemo`/`useCallback`
- `function` keyword for top-level named functions (`function getConfig()`, `function getDb()`)
- ESLint 9 with flat config at `Claude Usage Tracker/claude-usage-tracker/eslint.config.mjs`
- Extends `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`
- Overrides default ignores to `.next/**`, `out/**`, `build/**`, `next-env.d.ts`
- Run with `npm run lint`
- `strict: true` enabled (`tsconfig.json:7`)
- `target: ES2017`, `module: esnext`, `moduleResolution: bundler`
- Path alias: `@/*` maps to `./src/*` — always preferred over relative paths inside `src/` (see `src/app/api/dashboard/route.ts:2-5`)
## Import Organization
- `@/*` → `src/*` (defined in `Claude Usage Tracker/claude-usage-tracker/tsconfig.json:21-23`)
- Used in `src/app/**` and `src/components/**`
- Library files inside `src/lib/` use relative imports to sibling modules (`./config`, `./db`)
- Used in `src/lib/collector.ts:428` (`await import("./db")`) and `src/instrumentation.ts:3,6` for module loading on server startup
## Error Handling
- Collector catches HTTP/fetch errors in `pollOnce()` (`src/lib/collector.ts:370-413`) and translates them via `explainAuthFailure()` before surfacing to the UI
- Auth failure translation: `src/lib/auth-diagnostics.ts` contains `getAuthPreflightError` (preflight validation) and `explainAuthFailure` (converts raw HTTP 401/403 bodies into plain-English guidance with restart instructions)
- Try/catch around filesystem credential reads returns empty string on failure rather than throwing (`src/lib/config.ts:39-49`)
- Swallowed errors with explanatory comments (`src/lib/db.ts:52-55` for idempotent migrations, `src/lib/collector-singleton.ts:59` for first-run file cleanup)
- Error state stored on collector: `state.lastError`, `state.consecutiveFailures` — surfaced in dashboard response
- Tiered error backoff: `ERROR_BACKOFF = [60_000, 120_000, 300_000, 600_000]` escalates on consecutive failures, capped at 10 min (`src/lib/collector.ts:37`)
- `Promise.allSettled` used for best-effort parallel fetches where partial failure is acceptable (`src/lib/collector.ts:294-300`)
- `JSON.parse` wrapped in try/catch returning null (`src/lib/collector.ts:117-123` `parseJson`)
- Errors on HTTP: thrown with truncated body in message (first 500 chars) — `src/lib/collector.ts:138-142`
- UI API calls use `.catch()` to degrade silently (`src/app/page.tsx:26-30`, `src/app/api/poll/route.ts:13`)
- Plain `Error` instances thrown; no custom error classes
- `err instanceof Error ? err.message : String(err)` idiom for unknown catch values (`src/lib/collector.ts:371`)
## Logging
- Bracketed module tag prefix: `[collector]`, `[demo]`, `[instrumentation]` (see `src/lib/collector.ts:408,500,508`, `src/lib/collector-singleton.ts:63,154`, `src/instrumentation.ts:8`)
- `console.warn` for recoverable failures (`src/lib/collector.ts:408`)
- `console.error` in UI for fetch failures (`src/app/page.tsx:27`)
- `console.log` for lifecycle events (startup, demo seeding, demo poll results)
## Comments
- Section dividers in larger modules use `// --- Section Name ---` (see `src/lib/collector.ts:7,39,152,169`)
- Explain non-obvious intent, not mechanics (`// Seed the in-memory baseline on first success without treating it as new usage.` — `src/lib/collector.ts:104`)
- Swallowed errors always annotated with why (`// Column already exists; safe to ignore.` — `src/lib/db.ts:54`)
- Pragma comments for Next.js turbopack behavior: `/*turbopackIgnore: true*/` in `src/lib/config.ts:79`
- Not used in the TypeScript codebase
- Python scripts use triple-quoted docstrings for modules and functions (`Claude Message Sender/claude_message_send_with_CC_CLI.py:2-6,41,68,79`)
## Function Design
- Library helpers are small and single-purpose (typically 10-30 lines — see `src/lib/usage-window.ts`, `src/lib/auth-diagnostics.ts`)
- `UsageCollector.pollOnce()` is the main exception at ~190 lines (`src/lib/collector.ts:221-414`), intentionally linear for readability
- Prefer object parameters for anything with 4+ fields (see `insertSnapshot(config, data)` in `src/lib/db.ts:110` and `querySnapshots(config, opts?)` at line 159)
- Positional params for 2-3 small values (`computeUsageDelta(prevUtil, currUtil, prevResetAt, currResetAt)` in `src/lib/usage-window.ts:19`)
- Optional options bag uses `opts?: { ... }` pattern (`src/lib/db.ts:161`)
- Functions return discriminated unions or status shapes: `{ status: "ok" | "error" | "skipped", error?: string }` (`src/lib/collector.ts:221`)
- Pure state-transition helpers return the new state plus computed extras: `computeNextDelay` returns `TierState & { delayMs: number }` (`src/lib/collector.ts:41-44`)
- Null over `undefined` for "no value yet" database/domain fields; `undefined` for optional params
- Pure functions separated from side-effectful ones, e.g., `computeNextDelay` and `computePollingDelta` in `src/lib/collector.ts` are pure and separately testable; `UsageCollector` class holds state and I/O
- Comment `// --- Pure function ---` used to mark the boundary (`src/lib/collector.ts:39`)
## Module Design
- Named exports only; no default exports in lib or API route files
- Route handlers use named `GET`/`POST` functions + `export const dynamic = "force-dynamic"` (`src/app/api/dashboard/route.ts:7-9`, `src/app/api/poll/route.ts:5-8`, `src/app/api/snapshots/route.ts:5`)
- React pages use `export default function PageName()` (`src/app/page.tsx:13`, `src/app/layout.tsx:9`)
- Components use named exports: `export function CollectorHealth({ data }: ...)` (`src/components/CollectorHealth.tsx:93`)
- Not used — each module imported directly from its file
- Module-level state cached via `globalThis` to survive Next.js re-imports (`src/lib/collector-singleton.ts:9-11`)
- Database handle cached in module scope (`src/lib/db.ts:5`)
## React/UI Conventions
- Explicit `"use client"` directive at top (`src/app/page.tsx:1`, all `src/components/*.tsx`)
- Hooks: `useState`, `useEffect`, `useCallback`, `useMemo` used conventionally
- Auto-refresh pattern via `setInterval` in `useEffect` with cleanup (`src/app/page.tsx:50-54`, `src/components/CollectorHealth.tsx:96-99`)
- Tailwind utility classes for layout and spacing
- Inline `style={{ ... }}` objects for theming using CSS custom properties: `var(--accent)`, `var(--text-primary)`, `var(--bg-surface)`, `var(--border-subtle)`, `var(--font-mono)`, `var(--font-display)`
- Color tokens by semantic role: `--good`, `--warn`, `--danger`, plus `-dim` variants (`src/components/UsageCards.tsx:6-16`, `src/app/page.tsx:239-241`)
- No styled-components or CSS modules; `src/app/globals.css` holds tokens
- Inline type annotations on destructured props (`{ data }: { data: DashboardData | null }`) rather than separate `Props` interface — see `src/components/UsageCards.tsx:18`, `CollectorHealth.tsx:93`
- Client-side `fetch` against `/api/*` routes with `cache: "no-store"` (`src/app/page.tsx:22`)
- No React Query or SWR; plain state + polling interval
## Next.js Conventions
- App Router (`src/app/**`)
- API routes via `route.ts` with named HTTP verb exports
- `export const dynamic = "force-dynamic"` on every API route to opt out of static caching
- `serverExternalPackages: ["better-sqlite3"]` in `Claude Usage Tracker/claude-usage-tracker/next.config.ts` to prevent bundling of the native module
- Server startup hook in `src/instrumentation.ts` (`register()` function) bootstraps the collector
## Python Conventions (Claude Message Sender)
- PEP 8 style, 4-space indentation
- Module docstrings and function docstrings (triple-quoted)
- Type hints used selectively on function signatures (`Claude Message Sender/claude_message_send_with_CC_CLI.py:41,68,79`)
- Module-level config constants (`CLAUDE_COMMAND`, `CLAUDE_MODEL`, `start_time`, `interval_hours`, `QUESTIONS`)
- Shebang `#!/usr/bin/env python3` on executable scripts
- `if __name__ == "__main__":` entry point pattern (`Claude Message Sender/test_send_now.py:68`)
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Pattern Overview
- **In-process collector** — the tracker spawns a singleton `UsageCollector` via Next.js `instrumentation.ts`, so the Next.js server itself is both the UI host and the background poller (no separate worker process).
- **Adaptive polling state machine** — four tiers (`idle` / `light` / `active` / `burst`) with deltas from the Claude usage endpoint driving tier transitions.
- **Pure-function core, side-effect shell** — tier logic (`computeNextDelay`, `computePollingDelta`, `computeUsageDelta`) is pure and independently tested; I/O (fetch, SQLite, timers) is isolated in the `UsageCollector` class.
- **Single-table SQLite persistence** — every poll result (success or error) becomes a row in `usage_snapshots`; all dashboard analytics are computed from that table at request time.
- **Demo mode** — the collector can run in a seeded, synthetic mode against a separate `demo.db` so the UI is demoable without Claude credentials.
- **No runtime coupling between subprojects** — sender scripts drive a browser / Claude CLI; tracker observes the `/api/oauth/usage` or `claude.ai/api/organizations/{orgId}/usage` endpoint. Integration is a future roadmap item.
## Layers
### Claude Usage Tracker (`Claude Usage Tracker/claude-usage-tracker/`)
- Purpose: Start the collector singleton and optionally open the browser when the Next.js server boots; wire SIGINT/SIGTERM shutdown.
- Location: `src/instrumentation.ts`
- Contains: `register()` hook (Next.js built-in), dynamic imports of `collector-singleton` and `config`.
- Depends on: `lib/collector-singleton`, `lib/config`.
- Used by: Next.js runtime (auto-invoked in Node.js runtime only).
- Purpose: Expose the collector state and SQLite-derived analytics over HTTP.
- Location: `src/app/api/`
- Contains:
- Depends on: `lib/config`, `lib/db`, `lib/analysis`, `lib/collector-singleton`.
- Used by: The dashboard page (client-side `fetch`), plus any external scripts that want raw snapshots.
- All routes export `dynamic = "force-dynamic"` to disable static caching.
- Purpose: Render the dashboard. All interaction uses client components because data is polled from the API.
- Location: `src/app/page.tsx`, `src/app/layout.tsx`, `src/components/`
- Contains: Seven client components listed in STRUCTURE.md; all declare `"use client"`.
- Depends on: `@/lib/analysis` (type-only imports for `DashboardData`), `recharts`, `date-fns`.
- Used by: The browser — it polls `/api/dashboard` every 15s and re-renders.
- Purpose: Pure logic + I/O adapters. This is the heart of the tracker.
- Location: `src/lib/`
- Contains:
- Depends on: `better-sqlite3`, `date-fns`, Node built-ins (`fs`, `path`, `node:child_process`).
- Used by: API routes, instrumentation, tests.
- Purpose: Append-only log of usage snapshots (every poll result, success or error).
- Location: `data/usage.db` (real) or `data/demo.db` (demo). Both gitignored.
- Schema: Single `usage_snapshots` table (see STRUCTURE.md for columns) + `app_meta` key-value table for migration flags.
- Access: Only via `src/lib/db.ts`. No other module touches `better-sqlite3` directly.
- Purpose: Install and manage a Windows Scheduled Task so the production server starts on login.
- Location: `scripts/install-startup.ps1`, `scripts/restart-startup.ps1`, `scripts/uninstall-startup.ps1`, `scripts/start-app.ps1`.
- Contains: PowerShell that registers `ClaudeUsageTracker` scheduled task bound to `powershell.exe -File start-app.ps1 -BindHost 127.0.0.1 -Port 3018`.
- Used by: The user at install time via `npm run startup:install` etc.
### Claude Message Sender (`Claude Message Sender/`)
- Purpose: Compute daily run slots from a start time + interval; register them with the `schedule` package; enter a tick loop.
- Location: `claude_message_send_with_browser.py` (`main`, `generate_daily_times`, `get_next_time_slot`), `claude_message_send_with_CC_CLI.py` (same plus `randomize_time_str`).
- Depends on: `schedule` (requirements.txt), `bisect`, `datetime`.
- Purpose: Actually send a message to Claude.
- Two variants:
- A third entry (`test_send_now.py`) imports `claude_message_send_with_CC_CLI` and bypasses the scheduler for manual testing.
## Data Flow
### Tracker: Collector → SQLite → Dashboard
### Sender: Scheduler → Action
- **Tracker server state** — a single in-memory `UsageCollector` holds `tierState`, `hasFiveHourBaseline`, `lastFiveHourUtil`, `lastFiveHourResetsAt`, and `CollectorState` (exposed via `getState()`). Persistent state lives in SQLite.
- **Tracker client state** — `useState` + `useEffect` in `src/app/page.tsx`; no global store, no server components. All components read from the `DashboardData` prop.
- **Sender state** — module-level globals (`scheduled_times`) plus the `schedule` library's own job registry.
## Key Abstractions
- Purpose: Owns the polling lifecycle, auth selection, and delta/tier bookkeeping.
- Examples: `src/lib/collector.ts` (constructor, `start`, `stop`, `pollOnce`, `pollDemo`, `scheduleNext`, `reschedule`, `getState`).
- Pattern: Stateful wrapper around pure helpers (`computeNextDelay`, `computePollingDelta`) plus `fetch` + SQLite writes.
- Purpose: Single resolved configuration object. Built once per request by `getConfig()`.
- Examples: `src/lib/config.ts`.
- Pattern: Plain data. Cookie vs. bearer is selected by whether `CLAUDE_SESSION_COOKIE` is set; the endpoint is derived from `orgId` (parsed out of `lastActiveOrg` in the cookie) or env overrides.
- Purpose: The canonical on-disk record of a single poll. Every other view is computed from this.
- Examples: `src/lib/db.ts` defines the TypeScript type; the SQL schema is in the `SCHEMA` constant in the same file.
- Purpose: The single JSON shape the client receives. Contains `health`, `current`, `timeline`, `activity`, `usageInsights`, `extraUsageInsights`, `runtime`, `storage`.
- Examples: `src/lib/analysis.ts`.
- Pattern: Server produces it, client consumes it, all chart components accept `{ data: DashboardData | null }`.
- Purpose: Decouples the Claude usage API shape from the rest of the code. `isUsageBucket` duck-type check makes the normalizer tolerant of unknown windows.
- Examples: `src/lib/normalize.ts`.
- Purpose: Adaptive polling state machine. Any positive delta at non-burst tier jumps straight to `burst` (captures spikes); three consecutive no-change polls step one tier down; failures use exponential backoff independent of tier.
- Examples: `src/lib/collector.ts` (`TIER_DELAYS`, `TIER_DOWN`, `ERROR_BACKOFF`, `computeNextDelay`).
- Purpose: Deterministic list of `HH:MM` slots for a single day, queried with `bisect.bisect_right` to pick the next slot.
- Examples: `Claude Message Sender/claude_message_send_with_browser.py` (`generate_daily_times`, `get_next_time_slot`).
## Entry Points
- Command: `npm run dev` → `next dev --hostname localhost --port 3017` with `AUTO_OPEN_BROWSER=true`, `APP_HOST=localhost`, `PORT=3017`.
- Bootstraps: `src/instrumentation.ts` → `getCollector()` → `UsageCollector.start()`.
- Command: `npm run start:prod` → `next start --hostname 127.0.0.1 --port 3018` with `AUTO_OPEN_BROWSER=false`.
- Alternative: `scripts/start-app.ps1` (used by the installed Windows Scheduled Task); requires an existing `.next/BUILD_ID`.
- `GET /api/dashboard` → `src/app/api/dashboard/route.ts` — aggregated dashboard JSON.
- `POST /api/poll` → `src/app/api/poll/route.ts` — force-poll with cooldown.
- `GET /api/snapshots` → `src/app/api/snapshots/route.ts` — raw snapshot list.
- `GET /` → `src/app/page.tsx` — dashboard SPA.
- Command: `npm test` → `tsx --test test/*.test.ts` (Node.js built-in test runner driven by `tsx`).
- Entry files: `test/*.test.ts` (9 files; see TESTING.md once written).
- `python claude_message_send_with_browser.py` — browser automation scheduler.
- `python claude_message_send_with_CC_CLI.py` — Claude CLI scheduler.
- `python test_send_now.py` — one-shot manual trigger.
## Error Handling
- **Preflight checks** — `getAuthPreflightError(config)` rejects known-bad combinations (bearer auth with a non-OAuth endpoint, cookie auth pointed at the OAuth endpoint) before the fetch happens.
- **Translated errors** — on `token_expired` / `authentication_error` / `account_session_invalid`, append guidance like "Refresh Claude Code or set a new CLAUDE_BEARER_TOKEN, then restart the app" before storing the message.
- **Error snapshots** — the `catch` block in `pollOnce()` always writes a `status="error"` row with the translated `errorMessage` and null metric columns, so the timeline keeps a complete audit trail.
- **Exponential backoff** — `ERROR_BACKOFF = [60s, 120s, 300s, 600s]`, indexed by `consecutiveFailures - 1` and clamped to the last slot.
- **Non-JSON bodies** — `fetchJson` throws with a sliced preview of the body (500 chars max).
- **Cooldown on manual poll** — `POST /api/poll` returns HTTP 429 with `retryInSeconds` if `lastAttemptAt` is less than 30s old.
- **Demo fallback** — when no auth is configured, the app prefers demo mode over hard-failing; `hasAuth` is `true` whenever `demoMode` is `true`.
- **Sender** — each Python action is wrapped in try/except with best-effort `print` of the error and then continues the scheduling loop.
## Cross-Cutting Concerns
- **cookie** — `CLAUDE_SESSION_COOKIE` header sent verbatim to `claude.ai/api/organizations/{orgId}/usage`; `orgId` is derived from `CLAUDE_ORG_ID` or the `lastActiveOrg` cookie value.
- **bearer** — `Authorization: Bearer <token>` + `anthropic-beta: oauth-2025-04-20` sent to `https://api.anthropic.com/api/oauth/usage`. Token is read from `CLAUDE_BEARER_TOKEN` or `~/.claude/.credentials.json` (`claudeAiOauth.accessToken`).
- Cookie auth wins when both are set.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, or `.github/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
