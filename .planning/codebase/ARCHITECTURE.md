# Architecture

**Analysis Date:** 2026-04-16

## Pattern Overview

**Overall:** Monorepo umbrella with two independent subprojects that share a common domain (Claude usage optimization) but have no runtime coupling today. Roadmap is to merge them so the tracker can auto-trigger the sender.

**Subprojects:**
1. **Claude Usage Tracker** — Next.js 16 App Router dashboard with an in-process background collector, SQLite storage, and server-rendered REST endpoints that feed a React client dashboard.
2. **Claude Message Sender** — Standalone Python scripts (scheduler + automation) that intentionally start/shift the Claude.ai 5-hour rolling window.

**Key Characteristics:**
- **In-process collector** — the tracker spawns a singleton `UsageCollector` via Next.js `instrumentation.ts`, so the Next.js server itself is both the UI host and the background poller (no separate worker process).
- **Adaptive polling state machine** — four tiers (`idle` / `light` / `active` / `burst`) with deltas from the Claude usage endpoint driving tier transitions.
- **Pure-function core, side-effect shell** — tier logic (`computeNextDelay`, `computePollingDelta`, `computeUsageDelta`) is pure and independently tested; I/O (fetch, SQLite, timers) is isolated in the `UsageCollector` class.
- **Single-table SQLite persistence** — every poll result (success or error) becomes a row in `usage_snapshots`; all dashboard analytics are computed from that table at request time.
- **Demo mode** — the collector can run in a seeded, synthetic mode against a separate `demo.db` so the UI is demoable without Claude credentials.
- **No runtime coupling between subprojects** — sender scripts drive a browser / Claude CLI; tracker observes the `/api/oauth/usage` or `claude.ai/api/organizations/{orgId}/usage` endpoint. Integration is a future roadmap item.

## Layers

### Claude Usage Tracker (`Claude Usage Tracker/claude-usage-tracker/`)

**Instrumentation / Bootstrap Layer:**
- Purpose: Start the collector singleton and optionally open the browser when the Next.js server boots; wire SIGINT/SIGTERM shutdown.
- Location: `src/instrumentation.ts`
- Contains: `register()` hook (Next.js built-in), dynamic imports of `collector-singleton` and `config`.
- Depends on: `lib/collector-singleton`, `lib/config`.
- Used by: Next.js runtime (auto-invoked in Node.js runtime only).

**Routing / API Layer (Next.js Route Handlers):**
- Purpose: Expose the collector state and SQLite-derived analytics over HTTP.
- Location: `src/app/api/`
- Contains:
  - `api/dashboard/route.ts` — GET aggregates all snapshots + collector state via `buildDashboardData()`.
  - `api/poll/route.ts` — POST forces an immediate poll with a 30s cooldown (returns HTTP 429 on cooldown).
  - `api/snapshots/route.ts` — GET raw snapshots with `since` / `until` / `status` / `limit` query filters.
- Depends on: `lib/config`, `lib/db`, `lib/analysis`, `lib/collector-singleton`.
- Used by: The dashboard page (client-side `fetch`), plus any external scripts that want raw snapshots.
- All routes export `dynamic = "force-dynamic"` to disable static caching.

**Presentation Layer (React client components):**
- Purpose: Render the dashboard. All interaction uses client components because data is polled from the API.
- Location: `src/app/page.tsx`, `src/app/layout.tsx`, `src/components/`
- Contains: Seven client components listed in STRUCTURE.md; all declare `"use client"`.
- Depends on: `@/lib/analysis` (type-only imports for `DashboardData`), `recharts`, `date-fns`.
- Used by: The browser — it polls `/api/dashboard` every 15s and re-renders.

**Domain / Core Library Layer (`src/lib/`):**
- Purpose: Pure logic + I/O adapters. This is the heart of the tracker.
- Location: `src/lib/`
- Contains:
  - **Configuration** — `config.ts` (`getConfig()` resolves env vars, cookie parsing, `~/.claude/.credentials.json` fallback, demo-mode resolution).
  - **Collector state machine** — `collector.ts` (`UsageCollector` class + pure `computeNextDelay` / `computePollingDelta` functions and tier constants).
  - **Collector singleton** — `collector-singleton.ts` (`getCollector()` stashes a single `UsageCollector` on `globalThis` to survive Next.js hot reloads; seeds demo data when `demoMode` is true).
  - **Persistence** — `db.ts` (better-sqlite3, schema creation, column migrations, cents→dollars migration, `insertSnapshot` / `querySnapshots` / `getDbMeta`).
  - **Payload normalization** — `normalize.ts` (`normalizeUsagePayload` converts the raw Claude usage JSON into `NormalizedPayload` with windows + extras + extra-usage fields).
  - **Window math** — `usage-window.ts` (`normalizeResetHour`, `isSameUsageWindow`, `computeUsageDelta` — treats usage as increasing within a window, resetting when `resets_at` crosses an hour boundary).
  - **Analytics** — `analysis.ts` (`buildDashboardData` assembles `DashboardData` with health counts, current snapshot, timeline, hourly bars, heatmap, usage insights, extra-usage insights).
  - **Auth diagnostics** — `auth-diagnostics.ts` (`getAuthPreflightError`, `explainAuthFailure`, `OAUTH_USAGE_ENDPOINT` constant; translates cryptic fetch errors into actionable messages).
- Depends on: `better-sqlite3`, `date-fns`, Node built-ins (`fs`, `path`, `node:child_process`).
- Used by: API routes, instrumentation, tests.

**Persistence Layer (SQLite on disk):**
- Purpose: Append-only log of usage snapshots (every poll result, success or error).
- Location: `data/usage.db` (real) or `data/demo.db` (demo). Both gitignored.
- Schema: Single `usage_snapshots` table (see STRUCTURE.md for columns) + `app_meta` key-value table for migration flags.
- Access: Only via `src/lib/db.ts`. No other module touches `better-sqlite3` directly.

**Deployment / Startup Layer:**
- Purpose: Install and manage a Windows Scheduled Task so the production server starts on login.
- Location: `scripts/install-startup.ps1`, `scripts/restart-startup.ps1`, `scripts/uninstall-startup.ps1`, `scripts/start-app.ps1`.
- Contains: PowerShell that registers `ClaudeUsageTracker` scheduled task bound to `powershell.exe -File start-app.ps1 -BindHost 127.0.0.1 -Port 3018`.
- Used by: The user at install time via `npm run startup:install` etc.

### Claude Message Sender (`Claude Message Sender/`)

**Scheduling Layer:**
- Purpose: Compute daily run slots from a start time + interval; register them with the `schedule` package; enter a tick loop.
- Location: `claude_message_send_with_browser.py` (`main`, `generate_daily_times`, `get_next_time_slot`), `claude_message_send_with_CC_CLI.py` (same plus `randomize_time_str`).
- Depends on: `schedule` (requirements.txt), `bisect`, `datetime`.

**Action Layer:**
- Purpose: Actually send a message to Claude.
- Two variants:
  - `send_claude_message()` in `claude_message_send_with_browser.py` — `webbrowser.open_new_tab("https://claude.ai")`, then `pyautogui` keyboard/mouse automation to type, send, and delete the chat.
  - `ask_claude()` in `claude_message_send_with_CC_CLI.py` — spawns `claude --model haiku -p "<question>"` via `subprocess.run`, `cwd=%TEMP%/claude_isolated` so project CLAUDE.md files don't leak into the prompt.
- A third entry (`test_send_now.py`) imports `claude_message_send_with_CC_CLI` and bypasses the scheduler for manual testing.

## Data Flow

### Tracker: Collector → SQLite → Dashboard

1. **Boot.** Next.js calls `register()` in `src/instrumentation.ts`. It imports `getCollector()`, which resolves `getConfig()` and (if not in demo mode) opens SQLite via `getDb(config)`; demo mode wipes `demo.db` and re-seeds 7 days of synthetic 5-minute snapshots via `seedDemoData()`. The collector is cached on `globalThis._usageCollector`.
2. **Poll loop.** `UsageCollector.start()` calls `pollOnce()` immediately. `pollOnce()` either routes to `pollDemo()` (synthetic) or performs a real HTTP fetch.
3. **Real poll.** `pollOnce()` runs `getAuthPreflightError(config)` to sanity-check endpoint vs. auth mode, sets Claude.ai-shaped headers, and calls `fetchJson(config.endpoint, headers)`. In cookie mode with an `orgId`, it fans out to five additional `claude.ai/api/organizations/{orgId}/{overage_spend_limit|prepaid/credits|prepaid/bundles|overage_credit_grant|payment_method}` endpoints in parallel via `Promise.allSettled`. All payloads are bundled into a single `rawJson` string.
4. **Normalization.** `normalizeUsagePayload(payload)` extracts `five_hour`, `seven_day`, and `extra_usage` fields.
5. **Persistence.** `insertSnapshot(config, {...})` writes one row with status `ok` (or `error`), utilization/resets columns, normalized extra-usage fields, and the bundled raw JSON.
6. **Delta + tier.** `computePollingDelta(hasBaseline, prevUtil, currUtil, prevReset, currReset)` returns a non-negative delta (or zero while seeding the in-memory baseline on the first success). `computeNextDelay(tierState, {delta, success})` returns the next tier and `delayMs`.
7. **Schedule next.** `scheduleNext(delayMs)` sets a `setTimeout` for the next `pollOnce()`. Failures use the `ERROR_BACKOFF = [1m, 2m, 5m, 10m]` escalation indexed by `consecutiveFailures`.
8. **Dashboard read.** Browser calls `GET /api/dashboard`. The handler calls `querySnapshots(config)` (all rows), `getDbMeta(config)`, `getCollector().getState()`, then `buildDashboardData(snapshots, meta, runtime)`.
9. **Analytics.** `buildDashboardData` filters OK snapshots, walks them pairwise computing 5-hour and 7-day deltas (via `computeUsageDelta`) and extra-usage spend deltas, bins them into `hourlyBars[24]` and `heatmap[7*24]`, and emits `timeline`, `usageInsights`, `extraUsageInsights`, and a `current` snapshot.
10. **Render.** The client page updates state and renders cards, timeline (recharts), peak-hours bar chart, heatmap, and raw JSON viewer. The page also refetches every 15s via `setInterval`.
11. **Manual poll.** `POST /api/poll` reads `collector.getState()`; if `lastAttemptAt` is within 30s it returns HTTP 429 `{status:"cooldown", retryInSeconds}`; otherwise it awaits `collector.pollOnce()` and returns the result.

### Sender: Scheduler → Action

1. `main()` builds `scheduled_times` from `start_time` + `interval_hours`.
2. Each slot is registered with `schedule.every().day.at(time_str).do(job)`. The CLI variant randomizes all slots after the first within a 5-minute window using `randomize_time_str`.
3. The main loop calls `schedule.run_pending()` every 30s (browser) or every 1s (CLI), printing the next slot to stderr on a `\r` line.
4. When a job fires it calls `send_claude_message()` or `ask_claude()`, which performs the side effect and returns.

**State Management:**
- **Tracker server state** — a single in-memory `UsageCollector` holds `tierState`, `hasFiveHourBaseline`, `lastFiveHourUtil`, `lastFiveHourResetsAt`, and `CollectorState` (exposed via `getState()`). Persistent state lives in SQLite.
- **Tracker client state** — `useState` + `useEffect` in `src/app/page.tsx`; no global store, no server components. All components read from the `DashboardData` prop.
- **Sender state** — module-level globals (`scheduled_times`) plus the `schedule` library's own job registry.

## Key Abstractions

**`UsageCollector` (class):**
- Purpose: Owns the polling lifecycle, auth selection, and delta/tier bookkeeping.
- Examples: `src/lib/collector.ts` (constructor, `start`, `stop`, `pollOnce`, `pollDemo`, `scheduleNext`, `reschedule`, `getState`).
- Pattern: Stateful wrapper around pure helpers (`computeNextDelay`, `computePollingDelta`) plus `fetch` + SQLite writes.

**`Config` (interface):**
- Purpose: Single resolved configuration object. Built once per request by `getConfig()`.
- Examples: `src/lib/config.ts`.
- Pattern: Plain data. Cookie vs. bearer is selected by whether `CLAUDE_SESSION_COOKIE` is set; the endpoint is derived from `orgId` (parsed out of `lastActiveOrg` in the cookie) or env overrides.

**`SnapshotRow` (interface) + `usage_snapshots` table:**
- Purpose: The canonical on-disk record of a single poll. Every other view is computed from this.
- Examples: `src/lib/db.ts` defines the TypeScript type; the SQL schema is in the `SCHEMA` constant in the same file.

**`DashboardData` (interface):**
- Purpose: The single JSON shape the client receives. Contains `health`, `current`, `timeline`, `activity`, `usageInsights`, `extraUsageInsights`, `runtime`, `storage`.
- Examples: `src/lib/analysis.ts`.
- Pattern: Server produces it, client consumes it, all chart components accept `{ data: DashboardData | null }`.

**`NormalizedPayload` (interface):**
- Purpose: Decouples the Claude usage API shape from the rest of the code. `isUsageBucket` duck-type check makes the normalizer tolerant of unknown windows.
- Examples: `src/lib/normalize.ts`.

**`Tier` + `TierState` (types):**
- Purpose: Adaptive polling state machine. Any positive delta at non-burst tier jumps straight to `burst` (captures spikes); three consecutive no-change polls step one tier down; failures use exponential backoff independent of tier.
- Examples: `src/lib/collector.ts` (`TIER_DELAYS`, `TIER_DOWN`, `ERROR_BACKOFF`, `computeNextDelay`).

**Scheduled-time list (Python):**
- Purpose: Deterministic list of `HH:MM` slots for a single day, queried with `bisect.bisect_right` to pick the next slot.
- Examples: `Claude Message Sender/claude_message_send_with_browser.py` (`generate_daily_times`, `get_next_time_slot`).

## Entry Points

**Next.js dev server:**
- Command: `npm run dev` → `next dev --hostname localhost --port 3017` with `AUTO_OPEN_BROWSER=true`, `APP_HOST=localhost`, `PORT=3017`.
- Bootstraps: `src/instrumentation.ts` → `getCollector()` → `UsageCollector.start()`.

**Next.js production server:**
- Command: `npm run start:prod` → `next start --hostname 127.0.0.1 --port 3018` with `AUTO_OPEN_BROWSER=false`.
- Alternative: `scripts/start-app.ps1` (used by the installed Windows Scheduled Task); requires an existing `.next/BUILD_ID`.

**HTTP entry points:**
- `GET /api/dashboard` → `src/app/api/dashboard/route.ts` — aggregated dashboard JSON.
- `POST /api/poll` → `src/app/api/poll/route.ts` — force-poll with cooldown.
- `GET /api/snapshots` → `src/app/api/snapshots/route.ts` — raw snapshot list.
- `GET /` → `src/app/page.tsx` — dashboard SPA.

**Test runner:**
- Command: `npm test` → `tsx --test test/*.test.ts` (Node.js built-in test runner driven by `tsx`).
- Entry files: `test/*.test.ts` (9 files; see TESTING.md once written).

**Sender entry points:**
- `python claude_message_send_with_browser.py` — browser automation scheduler.
- `python claude_message_send_with_CC_CLI.py` — Claude CLI scheduler.
- `python test_send_now.py` — one-shot manual trigger.

## Error Handling

**Strategy:** Capture every failure as an `error` row in `usage_snapshots` so the dashboard's `recentErrors` list surfaces it, translate fetch errors into actionable messages via `explainAuthFailure`, and back off exponentially instead of failing hard.

**Patterns:**
- **Preflight checks** — `getAuthPreflightError(config)` rejects known-bad combinations (bearer auth with a non-OAuth endpoint, cookie auth pointed at the OAuth endpoint) before the fetch happens.
- **Translated errors** — on `token_expired` / `authentication_error` / `account_session_invalid`, append guidance like "Refresh Claude Code or set a new CLAUDE_BEARER_TOKEN, then restart the app" before storing the message.
- **Error snapshots** — the `catch` block in `pollOnce()` always writes a `status="error"` row with the translated `errorMessage` and null metric columns, so the timeline keeps a complete audit trail.
- **Exponential backoff** — `ERROR_BACKOFF = [60s, 120s, 300s, 600s]`, indexed by `consecutiveFailures - 1` and clamped to the last slot.
- **Non-JSON bodies** — `fetchJson` throws with a sliced preview of the body (500 chars max).
- **Cooldown on manual poll** — `POST /api/poll` returns HTTP 429 with `retryInSeconds` if `lastAttemptAt` is less than 30s old.
- **Demo fallback** — when no auth is configured, the app prefers demo mode over hard-failing; `hasAuth` is `true` whenever `demoMode` is `true`.
- **Sender** — each Python action is wrapped in try/except with best-effort `print` of the error and then continues the scheduling loop.

## Cross-Cutting Concerns

**Logging:** `console.log` / `console.warn` with `[instrumentation]`, `[collector]`, `[demo]` prefixes. No logging framework. Python uses `print` with `[HH:MM:SS]` / `[Status]` prefixes.

**Validation:** Duck-typed (`isUsageBucket` in `normalize.ts`). `parseJson` swallows `JSON.parse` errors and returns `null`. No Zod / Valibot / similar schema library.

**Authentication:** Two modes resolved by `getConfig()`:
- **cookie** — `CLAUDE_SESSION_COOKIE` header sent verbatim to `claude.ai/api/organizations/{orgId}/usage`; `orgId` is derived from `CLAUDE_ORG_ID` or the `lastActiveOrg` cookie value.
- **bearer** — `Authorization: Bearer <token>` + `anthropic-beta: oauth-2025-04-20` sent to `https://api.anthropic.com/api/oauth/usage`. Token is read from `CLAUDE_BEARER_TOKEN` or `~/.claude/.credentials.json` (`claudeAiOauth.accessToken`).
- Cookie auth wins when both are set.

**Concurrency control:** A single `polling` boolean on `UsageCollector` prevents overlapping polls. `Promise.allSettled` is used for the cookie-mode org endpoint fan-out so one failure doesn't tank the primary usage fetch.

**Configuration:** `.env.local` (gitignored) at `Claude Usage Tracker/claude-usage-tracker/.env.local` with the documented keys from `.env.example`. Note: environment resolution happens in `getConfig()` at request time, not at module load.

**Singleton safety:** `collector-singleton.ts` stashes the `UsageCollector` on `globalThis` so Next.js route-module re-evaluation (in dev / HMR) does not spawn multiple poll loops.

**Database migrations:** `db.ts` runs `CREATE TABLE IF NOT EXISTS`, a block of `ALTER TABLE ... ADD COLUMN` statements each wrapped in try/catch (idempotent), then a cents-to-dollars migration gated by an `app_meta` key (`extra_usage_money_unit = "dollars"`). No migration-tool dependency.

---

*Architecture analysis: 2026-04-16*
