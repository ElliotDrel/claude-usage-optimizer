# External Integrations

**Analysis Date:** 2026-04-16

## APIs & External Services

**Claude.ai (Anthropic) — Usage API:**

The tracker polls Claude's usage endpoints on an adaptive schedule. Two auth modes with different endpoints. Logic lives in `Claude Usage Tracker/claude-usage-tracker/src/lib/collector.ts` and `src/lib/config.ts`.

- **Primary usage endpoint (cookie auth):** `https://claude.ai/api/organizations/{orgId}/usage`
  - Built in `src/lib/config.ts::buildClaudeCookieEndpoint` (line 34-37)
  - `{orgId}` derived from `CLAUDE_ORG_ID` env var OR from the `lastActiveOrg` value inside `CLAUDE_SESSION_COOKIE`
- **OAuth usage endpoint (bearer auth):** `https://api.anthropic.com/api/oauth/usage`
  - Constant `OAUTH_USAGE_ENDPOINT` in `src/lib/auth-diagnostics.ts` (line 3)
  - Sent with header `anthropic-beta: oauth-2025-04-20` (see `src/lib/collector.ts` line 281)
- **Additional org endpoints (cookie auth only — best-effort, via `Promise.allSettled`):** All under `https://claude.ai/api/organizations/{orgId}/...` (see `src/lib/collector.ts` lines 294-314):
  - `overage_spend_limit`
  - `prepaid/credits`
  - `prepaid/bundles`
  - `overage_credit_grant`
  - `payment_method`
  These are merged into the raw JSON snapshot as `{ usage, overage_spend_limit, prepaid_credits, prepaid_bundles, overage_credit_grant, payment_method }`.
- **Request headers sent** (`src/lib/collector.ts` lines 267-284): mimic a real Chrome browser session:
  - `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ... Chrome/137.0.0.0 Safari/537.36`
  - `Referer: https://claude.ai/settings/usage`
  - `Origin: https://claude.ai`
  - `Sec-Fetch-*`, `Sec-Ch-Ua-Platform: "Windows"`
  - `Authorization: Bearer …` (bearer mode) or `Cookie: …` (cookie mode)

**Claude.ai web UI:**
- `Claude Message Sender/claude_message_send_with_browser.py` opens `https://claude.ai` via `webbrowser.open_new_tab` and drives the UI with `pyautogui` keystrokes/clicks.

**Claude Code CLI (local binary):**
- `Claude Message Sender/claude_message_send_with_CC_CLI.py` shells out to `claude --model {model} -p {question}` via `subprocess.run`. Model defaults to `"haiku"`. Version-checked with `claude --version` at startup.
- Runs commands from an isolated temp dir (`{tempdir}/claude_isolated`) so they don't inherit project context (see `claude_message_send_with_CC_CLI.py` lines 100-110).

## Data Storage

**Databases:**
- **SQLite** via `better-sqlite3` (synchronous, embedded). All schema/queries in `Claude Usage Tracker/claude-usage-tracker/src/lib/db.ts`.
  - DB file path: `${DATA_DIR or cwd/data}/usage.db` (real mode) or `demo.db` (demo mode)
  - Journal mode: WAL (set in `getDb`, line 47)
  - Tables:
    - `usage_snapshots` — timestamped polling results with `status`, `endpoint`, `auth_mode`, `response_status`, `five_hour_utilization`, `five_hour_resets_at`, `seven_day_utilization`, `seven_day_resets_at`, `raw_json`, `error_message`, and extra-usage columns (`extra_usage_enabled`, `extra_usage_monthly_limit`, `extra_usage_used_credits`, `extra_usage_utilization`)
    - `app_meta` — key/value migration tracking (e.g. `extra_usage_money_unit = "dollars"`)
  - Indexes on `timestamp` and `status`
  - Migrations are idempotent `ALTER TABLE ADD COLUMN` statements wrapped in try/catch, plus one data-migration transaction (`migrateExtraUsageMoneyToDollars`, lines 62-89).

**File Storage:**
- Local filesystem only. `/data/` directory is `.gitignore`d (see `Claude Usage Tracker/claude-usage-tracker/.gitignore` line 38 and root `.gitignore` line 26).
- Demo mode wipes and reseeds the DB file (+ WAL/SHM companion files) on startup — see `src/lib/collector-singleton.ts::seedDemoData` (lines 53-59).

**Caching:**
- None external. In-process caches only: module-level `db` handle in `src/lib/db.ts` (line 5), and `globalThis._usageCollector` singleton in `src/lib/collector-singleton.ts` (lines 9-11).
- Next.js API routes use `export const dynamic = "force-dynamic"` to disable response caching.
- Client-side `fetch` calls use `cache: "no-store"` (`src/app/page.tsx` line 22).

## Authentication & Identity

**No user auth on the tracker itself.** The dashboard is local-only (binds to `localhost:3017` in dev, `127.0.0.1:3018` in prod) and has no login.

**Upstream auth against Claude (two modes, resolved in `src/lib/config.ts`):**
- **Cookie auth (preferred):** `CLAUDE_SESSION_COOKIE` env var — paste the full `Cookie` header from a logged-in claude.ai browser session.
- **Bearer auth (fallback):** `CLAUDE_BEARER_TOKEN` env var. If blank, the app reads `~/.claude/.credentials.json` and pulls `claudeAiOauth.accessToken` (see `tryReadClaudeCredentials` at `src/lib/config.ts` lines 39-49). This piggybacks on Claude Code CLI's stored OAuth token.
- Mode selection (`src/lib/config.ts` lines 72-76): cookie wins if present; otherwise bearer; otherwise `"none"` → polling is disabled and a synthetic error snapshot is written (`src/lib/collector.ts` lines 227-251).
- Preflight validation of endpoint/auth pairing is done in `src/lib/auth-diagnostics.ts::getAuthPreflightError`.

## Monitoring & Observability

**Error Tracking:**
- None external (no Sentry, Datadog, etc.). Errors are written into the SQLite snapshot rows as `status = "error"` with `error_message` (see `src/lib/collector.ts` lines 376-392) and surfaced via the `CollectorHealth` component.

**Logs:**
- `console.log` / `console.warn` only, prefixed with `[collector]`, `[instrumentation]`, `[demo]`.
- No log file, no log aggregation. Windows Scheduled Task runs with `-WindowStyle Hidden` so logs are not directly visible in prod mode.

## CI/CD & Deployment

**Hosting:**
- Local Windows machine. Autostart is provided by PowerShell scripts:
  - `Claude Usage Tracker/claude-usage-tracker/scripts/install-startup.ps1` — registers a `ClaudeUsageTracker` Windows Scheduled Task that runs at user logon
  - `scripts/start-app.ps1` — wrapper invoked by the task; runs `npm run start` bound to `127.0.0.1:3018`
  - `scripts/restart-startup.ps1`, `scripts/uninstall-startup.ps1`

**CI Pipeline:**
- None detected. No `.github/workflows/`, no `.gitlab-ci.yml`, no `vercel.json`, no `Dockerfile`.

**Vercel:** Not configured, though `.next/` and `.vercel/` are `.gitignore`d defensively.

## Environment Configuration

**Tracker required env vars:**
- At least one of `CLAUDE_SESSION_COOKIE` OR `CLAUDE_BEARER_TOKEN` (the latter can be auto-sourced from `~/.claude/.credentials.json`)

**Tracker optional env vars:**
- `CLAUDE_ORG_ID`
- `CLAUDE_USAGE_ENDPOINT` (legacy), `CLAUDE_BEARER_USAGE_ENDPOINT`, `CLAUDE_COOKIE_USAGE_ENDPOINT`
- `DEV_DEMO_MODE`, `PROD_DEMO_MODE`
- `APP_HOST`, `PORT`, `AUTO_OPEN_BROWSER`, `DATA_DIR`, `NODE_ENV`

**Secrets location:**
- `Claude Usage Tracker/claude-usage-tracker/.env.local` (gitignored via root `.gitignore` rule `.env.*` with `!.env.example` exception)
- `~/.claude/.credentials.json` (user home, managed by Claude Code CLI) — read-only consumption
- Example template committed at `Claude Usage Tracker/claude-usage-tracker/.env.example`

**Sender:** No env vars. All configuration is in-file (constants at the top of each `.py`).

## Webhooks & Callbacks

**Incoming HTTP endpoints** (Next.js App Router, in `Claude Usage Tracker/claude-usage-tracker/src/app/api/`):
- `GET /api/dashboard` (`src/app/api/dashboard/route.ts`) — returns aggregated analytics + collector state + demo-mode flag
- `POST /api/poll` (`src/app/api/poll/route.ts`) — triggers an ad-hoc poll; enforces a 30-second client cooldown with HTTP 429; accepts `{ force: true }` body to bypass
- `GET /api/snapshots` (`src/app/api/snapshots/route.ts`) — raw snapshots, filterable by `since`, `until`, `status`, `limit` query params

All three set `export const dynamic = "force-dynamic"`. No auth middleware — endpoints assume a loopback-only bind.

**Outgoing HTTP calls:**
- `fetch` to Claude.ai / api.anthropic.com (see "APIs & External Services" above). Pure client-side `fetch`, no webhooks.

**No incoming webhooks** from third parties. **No outgoing webhooks.**

## Scheduled / Background Work

**Tracker adaptive poller** (`src/lib/collector.ts` + started by `src/instrumentation.ts`):
- Runs in-process via `setTimeout` self-rescheduling. Tiers and delays:
  - `idle` → 5 min, `light` → 2.5 min, `active` → 1 min, `burst` → 30 s
- On error, uses exponential-ish backoff: 1 min → 2 min → 5 min → 10 min (`ERROR_BACKOFF`, line 37).
- No cron, no job queue. Lifecycle tied to the Next.js server process; `SIGTERM`/`SIGINT` stop the collector (`src/instrumentation.ts` lines 15-21).

**Sender scheduler** (`Claude Message Sender/claude_message_send_with_CC_CLI.py` and `..._with_browser.py`):
- Uses the `schedule` Python lib. Generates daily time slots starting at `start_time` (default `05:05`) spaced by `interval_hours` (default `5`).
- CLI variant randomizes each slot (except the first) by up to 4m59s earlier to avoid pattern detection.
- Main loop calls `schedule.run_pending()` every 30s (browser) or every 1s (CLI).

---

*Integration audit: 2026-04-16*
