# Codebase Concerns

**Analysis Date:** 2026-04-16

## Tech Debt

**Duplicate/confused repository layout (highest priority):**
- Issue: The umbrella repo contains THREE overlapping locations for the tracker code. The "real" source currently tracked in git lives at `Claude Usage Tracker/claude-usage-tracker/`. An untracked sibling `claude-usage-tracker/` (lowercase, at repo root) holds the user's live `.env.local`, `data/usage.db`, `data/demo.db`, `node_modules`, `.next`, etc. A third `Claude Usage Tracker/claude-usage-tracker/` contains only source files without node_modules/data. The two Message-Sender trees differ by a single deleted `Untitled-1.md`.
- Files: `Claude Usage Tracker/claude-usage-tracker/`, `claude-usage-tracker/` (untracked), `Claude Message Sender/`
- Impact: Developers/agents cannot tell which tree is authoritative. `npm run build`/`npm run dev` are run in the lowercase untracked tree, but commits land in the `Claude Usage Tracker/claude-usage-tracker/` tree. Any future `git mv` will fight path collisions. Documents like `README.md` say one thing while directories say another.
- Fix approach: Pick one canonical location (the README points at `Claude Usage Tracker/claude-usage-tracker/`), `git mv` it to a clean `tracker/` path, delete the untracked duplicate once `data/` and `.env.local` are preserved, and update all scripts/docs.

**Untracked WIP files at repo root:**
- Issue: `Untitled-1.md` at the repo root and at `Claude Usage Tracker/claude-usage-tracker/Untitled-1.md` are scratch planning notes checked in as if they were real artifacts. Current `git status` shows `D "Claude Message Sender/Untitled-1.md"` plus `?? Untitled-1.md` and `?? claude-usage-tracker/` - the tree is mid-move with no plan recorded.
- Files: `Untitled-1.md`, `Claude Usage Tracker/claude-usage-tracker/Untitled-1.md`
- Impact: Noise, unclear intent, risk of accidentally committing draft prose to repo history.
- Fix approach: Move to `.planning/quick/` with meaningful filenames or delete.

**Empty scaffold directories in lowercase tracker tree:**
- Issue: `claude-usage-tracker/src/app/api/{dashboard,poll,snapshots}/` exist as empty directories with no `route.ts` files. `src/components/` and `src/lib/` are also empty. Only `package-lock.json`, `next-env.d.ts`, `tsconfig.tsbuildinfo`, and `data/` have content.
- Files: `claude-usage-tracker/src/app/api/dashboard/`, `claude-usage-tracker/src/components/`, `claude-usage-tracker/src/lib/`
- Impact: Looks like a partially-initialized workspace; actually caused by `git mv` / copy where files were left behind.
- Fix approach: Either populate (mirror from the real tree) or delete alongside the main layout consolidation.

**Inline styles with repeated CSS variable lookups:**
- Issue: Every component uses `style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}` patterns inline instead of Tailwind classes or reusable presets. `page.tsx` has mouse-enter/leave handlers that imperatively rewrite `boxShadow` and `borderColor`.
- Files: `Claude Usage Tracker/claude-usage-tracker/src/app/page.tsx`, `Claude Usage Tracker/claude-usage-tracker/src/components/*.tsx`
- Impact: Huge visual duplication, fragile to theme changes, `page.tsx` is 297 lines mostly because of inline styling. Bundle size / hydration cost is higher than needed.
- Fix approach: Extract `Metric`, `Section`, `StatusPill` styling into Tailwind `@apply` utilities or a typed design-token object (`tokens.mono`, `tokens.tertiary`) and replace mouse handlers with CSS `:hover`.

**Singleton collector with side effects at import time:**
- Issue: `getCollector()` in `collector-singleton.ts:157-170` starts polling, seeds demo data (wiping the DB), and stores the collector on `globalThis._usageCollector`. It is called from both `instrumentation.ts` and inside `/api/dashboard/route.ts` GET handler. `seedDemoData` unconditionally deletes `demo.db`, `demo.db-shm`, `demo.db-wal` on first touch.
- Files: `Claude Usage Tracker/claude-usage-tracker/src/lib/collector-singleton.ts:53-61`, `Claude Usage Tracker/claude-usage-tracker/src/lib/collector-singleton.ts:157-170`, `Claude Usage Tracker/claude-usage-tracker/src/instrumentation.ts`
- Impact: Any stray import of the module (e.g. during a test, a type-only import that isn't erased, or a route pre-render) will wipe demo data. Not safe under Next.js RSC + route worker model.
- Fix approach: Separate `createCollector` (pure) from `startCollector` (side-effectful, called only by `instrumentation.ts`). Gate `seedDemoData` behind an explicit env flag rather than on collector boot.

**Two parallel demo-data generators that drift:**
- Issue: `collector-singleton.ts:22-51` (`generateSessions`) and `collector.ts:416-504` (`pollDemo`) both produce "realistic" demo usage, but with different distributions, different write schemas, and different reset-bucket math. They are ~90 lines of duplicated domain logic.
- Files: `Claude Usage Tracker/claude-usage-tracker/src/lib/collector-singleton.ts:53-155`, `Claude Usage Tracker/claude-usage-tracker/src/lib/collector.ts:416-504`
- Impact: Changes to the shape of `insertSnapshot` require two parallel edits. `collector-singleton`'s `INSERT` uses the legacy 11-column SQL and does not include extra-usage columns; the `pollDemo` path does.
- Fix approach: Extract a single `generateDemoSnapshot(now, state)` pure function. Call it from both the seeder and the runtime demo poll.

**Migrations run on every DB open with silent error-swallow:**
- Issue: `db.ts:50-56` runs `ALTER TABLE ... ADD COLUMN` inside a `try/catch{}` loop so existing-column errors are ignored. There is no migration version table - `migrateExtraUsageMoneyToDollars` lives in `app_meta`, but ordinary column migrations don't. New migrations will be hard to add safely.
- Files: `Claude Usage Tracker/claude-usage-tracker/src/lib/db.ts:35-60`
- Impact: Any unrelated SQL failure (disk full, typo) is silently swallowed. Ordering of future migrations relative to data-migrations like `migrateExtraUsageMoneyToDollars` is not guaranteed.
- Fix approach: Track a `schema_version` integer in `app_meta` and run migrations in order, stopping on any error that isn't "duplicate column name".

**Legacy raw-json duplicated with structured columns:**
- Issue: `usage_snapshots.raw_json` stores the full payload (plus 5 extra cookie-auth subendpoint responses as a concatenated JSON object in `collector.ts:293-317`). The structured columns `five_hour_utilization`, `extra_usage_*` etc. are derived from the same payload. Writing raw_json again on every poll bloats the DB and creates two sources of truth. The user's note in `Untitled-1.md` explicitly calls this out: wants to stop storing a broken-up version of the JSON and just parse what the UI needs.
- Files: `Claude Usage Tracker/claude-usage-tracker/src/lib/collector.ts:292-335`, `Claude Usage Tracker/claude-usage-tracker/src/lib/db.ts:8-33`
- Impact: DB grows linearly with raw JSON (several KB per minute in active mode). "Raw API Response" panel in UI already reads from the last snapshot's `raw_json` only, so historical raw_json is unreferenced.
- Fix approach: Stop writing raw_json on every snapshot; store only the latest payload in a separate `app_meta` row (or a 1-row `latest_payload` table). Keep structured columns for analytics.

**`process.exit(0)` on SIGTERM/SIGINT from instrumentation:**
- Issue: `instrumentation.ts:15-21` calls `process.exit(0)` inside SIGTERM/SIGINT handlers. This overrides Next.js's own shutdown sequencing (finishing in-flight requests, closing the HTTP server).
- Files: `Claude Usage Tracker/claude-usage-tracker/src/instrumentation.ts:15-21`
- Impact: Requests in flight during Ctrl-C can be cut off; graceful shutdown of any future long-running handler won't happen. On Windows Task Scheduler the `-MultipleInstances IgnoreNew` setting masks this, but manual shutdowns are messy.
- Fix approach: Only call `collector.stop()` in the handler; let Next.js handle process termination.

**Dashboard full-table scan on every request:**
- Issue: `GET /api/dashboard` calls `querySnapshots(config)` with no filters, which returns every row in `usage_snapshots`, then builds 7-day heatmap, timeline, and insights in memory. With 5-min adaptive polling, a month of data is ~8,640 rows; with burst-tier 30s it's ~86,400.
- Files: `Claude Usage Tracker/claude-usage-tracker/src/app/api/dashboard/route.ts:9-15`, `Claude Usage Tracker/claude-usage-tracker/src/lib/analysis.ts:301-377`
- Impact: Response latency scales with DB size; page auto-refreshes every 15s (`page.tsx:52`) which means the full scan runs 4x/min per open tab. Memory pressure when the DB grows.
- Fix approach: Partition queries: (a) current/latest = `LIMIT 1 DESC`, (b) timeline = filter by `since = now - 7d`, (c) heatmap = either precompute into a rollup table or bound the window. Add SQL-side aggregation for `hourlyBars` and `heatmap`.

**`/api/poll` cooldown keyed on `lastAttemptAt` for ANY attempt:**
- Issue: `poll/route.ts:16-25` checks cooldown against `state.lastAttemptAt`, which is updated on both successful and failed polls, including no-auth short-circuit writes. If the scheduler runs its own poll at second 28, the user's manual click at second 29 gets a 429.
- Files: `Claude Usage Tracker/claude-usage-tracker/src/app/api/poll/route.ts:16-25`, `Claude Usage Tracker/claude-usage-tracker/src/lib/collector.ts:228-252`
- Impact: Manual "Poll Now" button can appear broken moments after the auto-scheduler fires. Confusing UX.
- Fix approach: Track the last *manual* attempt separately, or short-circuit the cooldown when `state.currentTier === "burst"` (already polling fast).

## Known Bugs

**Extra-usage snapshot written with `raw_json: JSON.stringify({ demo: true })` loses cookie sub-endpoint data in demo mode:**
- Symptoms: In demo mode, `ExtraUsage.tsx` (the "Raw API Response" panel) shows `{ demo: true }` as the only payload, even if seeded data has extra_usage_* columns populated.
- Files: `Claude Usage Tracker/claude-usage-tracker/src/lib/collector.ts:484`
- Trigger: Run app with `DEV_DEMO_MODE=true` and inspect the Raw panel.
- Workaround: None; panel is informational.

**`scheduleNext` never nulls `this.timeout` before reassigning, but `stop()` clears it only if truthy:**
- Symptoms: If `stop()` is called between `clearTimeout` and assignment in `scheduleNext`, the timer reference can leak. Low-risk in practice because everything runs on the Node event loop, but tests that interleave `stop()` with scheduling will see flakes.
- Files: `Claude Usage Tracker/claude-usage-tracker/src/lib/collector.ts:207-214`, `Claude Usage Tracker/claude-usage-tracker/src/lib/collector.ts:514-520`
- Trigger: Rapid start/stop in test.
- Workaround: Call `stop()` then wait one tick before `start()`.

**Hour bucket math uses local time, not UTC:**
- Issue: `analysis.ts:buildActivity` uses `new Date(curr.timestamp).getHours()` / `.getDay()`, which is the server's local timezone. But reset math in `usage-window.ts:8` uses UTC.
- Symptoms: Heatmap and hourly bars shift after DST transitions; also wrong if the server and user are in different timezones (e.g. cloud host vs local user).
- Files: `Claude Usage Tracker/claude-usage-tracker/src/lib/analysis.ts:159-170`, `Claude Usage Tracker/claude-usage-tracker/src/lib/analysis.ts:193-202`, `Claude Usage Tracker/claude-usage-tracker/src/lib/usage-window.ts:6-9`
- Trigger: Deploy to any host whose `TZ` differs from the user's local.
- Workaround: Ship in the same timezone as use.

**Message Sender `requirements.txt` missing `pyautogui`:**
- Symptoms: `pip install -r requirements.txt` installs only `schedule`, but `claude_message_send_with_browser.py:11` imports `pyautogui` which won't be available. `ImportError` at first run.
- Files: `Claude Message Sender/requirements.txt`, `Claude Message Sender/claude_message_send_with_browser.py:11`
- Trigger: Fresh clone, `pip install -r`, run `python claude_message_send_with_browser.py`.
- Workaround: Manually `pip install pyautogui`.

**Message Sender browser script clicks fixed coordinates (150,150) / (150,250):**
- Symptoms: Deletes whatever is at those absolute screen positions. Breaks on any monitor with a different resolution, window arrangement, or scaling factor. Could click arbitrary UI elements (browser bookmarks, file manager, other windows).
- Files: `Claude Message Sender/claude_message_send_with_browser.py:17-18, 88-96`
- Trigger: Run on any monitor config that isn't the author's.
- Workaround: Use the `claude_message_send_with_CC_CLI.py` variant instead.

**Message Sender browser script "backup send" sends the message twice:**
- Issue: Line 82-84 explicitly types and sends the greeting a second time "optional backup send" with no conditional check.
- Symptoms: Every run creates two chats with identical greetings before the delete flow. If delete coords are wrong, both survive.
- Files: `Claude Message Sender/claude_message_send_with_browser.py:78-84`
- Trigger: Every run.
- Workaround: Comment out lines 80-84.

**Message Sender schedule loses track after 24h:**
- Issue: `generate_daily_times` is called once in `main()`; the `schedule.every().day.at(t)` calls use `HH:MM` or `HH:MM:SS` strings. The randomization in `claude_message_send_with_CC_CLI.py:68-77` uses `HH:MM:SS`, but `get_next_time_slot` (`claude_message_send_with_browser.py:55-61`) compares `"HH:MM"` strings against a `"HH:MM"` now, which is fine only for the first day. Nothing regenerates the day's schedule at midnight.
- Symptoms: After the first 24h, the "Next scheduled run" print stays the same; `schedule` library does re-fire daily, so actual sending still works - but status output is wrong.
- Files: `Claude Message Sender/claude_message_send_with_browser.py:104-148`, `Claude Message Sender/claude_message_send_with_CC_CLI.py:130-211`
- Trigger: Leave running for >24h.
- Workaround: Restart daily.

**Reset detection normalizes to the hour, not to the 5-hour boundary:**
- Issue: `usage-window.ts:7` resets the minutes/seconds to zero, producing an ISO string at the top of the hour. Two reset timestamps within the same hour are treated as the same window even if they represent different resets. In practice the API emits resets on an hour boundary, but this is an assumption without a test.
- Files: `Claude Usage Tracker/claude-usage-tracker/src/lib/usage-window.ts:1-10`
- Trigger: If the Claude API ever emits sub-hour reset offsets.
- Workaround: Inspect raw JSON first.

## Security Considerations

**Cookie/bearer tokens read from plaintext `.env.local` and `~/.claude/.credentials.json`:**
- Risk: Both auth modes let the collector make requests against claude.ai with full session privileges. A compromised dev machine exposes the Claude account.
- Files: `Claude Usage Tracker/claude-usage-tracker/src/lib/config.ts:39-70`, `claude-usage-tracker/.env.local` (untracked, on disk)
- Current mitigation: `.env` / `.env.*` are in both root `.gitignore` (line 21) and subproject `.gitignore` (line 34-35). `~/.claude/.credentials.json` read is wrapped in try/catch and only happens when `CLAUDE_SESSION_COOKIE` is empty.
- Recommendations: (a) Do not log the resolved bearer or cookie anywhere (currently safe - `config.ts` does not log tokens, but callers should keep that invariant). (b) Add a startup check that `.env.local` is not world-readable. (c) Consider encrypting at rest on Windows via DPAPI rather than reading plaintext.

**Error messages may echo sensitive headers into logs:**
- Risk: The collector's `console.warn(\`[collector] Poll failed: ${msg}\`)` (`collector.ts:408`) prints error messages that may embed API responses. HTTP 401 errors from claude.ai sometimes include the offending header echoed back.
- Files: `Claude Usage Tracker/claude-usage-tracker/src/lib/collector.ts:136-149`, `Claude Usage Tracker/claude-usage-tracker/src/lib/collector.ts:408`
- Current mitigation: `fetchJson` slices to 500 chars (line 141), which would typically truncate before reaching a cookie.
- Recommendations: Scrub known header-name patterns (`Cookie`, `Authorization`, `Bearer`) from any string that reaches `console.*`.

**`insertSnapshot` writes full raw JSON including all 5 cookie sub-endpoints to local DB:**
- Risk: `data/usage.db` contains plaintext copies of `payment_method`, `prepaid_credits`, `overage_credit_grant`, etc. If the file is accidentally shared (email, backup, Dropbox sync), it leaks billing data.
- Files: `Claude Usage Tracker/claude-usage-tracker/src/lib/collector.ts:292-317`
- Current mitigation: `/data/` is gitignored (subproject `.gitignore:38`, root `.gitignore:25`).
- Recommendations: Normalize out the financial fields we care about (already done) and stop storing the raw combined JSON. See "Legacy raw-json duplicated with structured columns" under tech debt.

**Shell-string interpolation in instrumentation browser-open:**
- Risk: `instrumentation.ts:10-13` builds a shell command by interpolating `config.appUrl` (derived from `APP_HOST` / `PORT` env vars) into a string passed to `child_process.exec`. If `APP_HOST` ever contains a shell metacharacter (quote, `&`, backtick), arbitrary commands run on launch.
- Files: `Claude Usage Tracker/claude-usage-tracker/src/instrumentation.ts:10-13`
- Current mitigation: `AUTO_OPEN_BROWSER` is `"false"` in production script (`start-app.ps1:19`). Dev npm script sets `APP_HOST=localhost` directly.
- Recommendations: Use `child_process.spawn` with an argv array (`spawn("cmd", ["/c", "start", "", url])`) or the `open` npm package. Never concatenate URL into a shell string.

**PowerShell installer uses `-ExecutionPolicy Bypass`:**
- Risk: The registered scheduled-task action runs PowerShell with `-ExecutionPolicy Bypass`. If an attacker can later modify `start-app.ps1`, the task runs the malicious script at every logon under the user's privileges.
- Files: `Claude Usage Tracker/claude-usage-tracker/scripts/install-startup.ps1:32-37`, `Claude Usage Tracker/claude-usage-tracker/scripts/start-app.ps1`
- Current mitigation: Scripts live inside the repo; no network download path.
- Recommendations: Sign the launcher scripts. Validate the file path hasn't changed before registering the task.

**`next.config.ts` has no security headers:**
- Risk: No `X-Frame-Options`, `Content-Security-Policy`, `X-Content-Type-Options`. Next.js defaults are permissive.
- Files: `Claude Usage Tracker/claude-usage-tracker/next.config.ts`
- Current mitigation: Server binds to `127.0.0.1` / `localhost` only (`start-app.ps1:17`, `package.json:6,9`).
- Recommendations: Once the user's goal of "tunneling the dashboard for laptop access" (per `Untitled-1.md` ideas) is pursued, add CSP and framebust headers before exposing externally.

## Performance Bottlenecks

**`/api/dashboard` rebuilds heatmap + hourly-bars + timeline from raw SQL every poll:**
- Problem: O(N) scans over all snapshots for every `GET /api/dashboard` request. Page auto-refreshes every 15 seconds.
- Files: `Claude Usage Tracker/claude-usage-tracker/src/lib/analysis.ts:131-299`, `Claude Usage Tracker/claude-usage-tracker/src/app/api/dashboard/route.ts:9-15`
- Cause: No caching, no aggregation tables, no HTTP cache headers (`export const dynamic = "force-dynamic"`).
- Improvement path: (a) SQL-side aggregation for heatmap/hourly bars via `GROUP BY strftime('%H', timestamp), strftime('%w', timestamp)`. (b) In-memory memoization keyed by "highest snapshot id seen" - rebuild only when new rows land. (c) SWR/ETag so the browser can short-circuit when nothing has changed.

**5 sequential(-ish) HTTP requests to claude.ai per cookie-auth poll:**
- Problem: `collector.ts:293-300` fires 5 additional requests per poll: `overage_spend_limit`, `prepaid/credits`, `prepaid/bundles`, `overage_credit_grant`, `payment_method`. They run in parallel via `Promise.allSettled`, but cookie-auth polls now do 6x the network work of bearer polls.
- Files: `Claude Usage Tracker/claude-usage-tracker/src/lib/collector.ts:292-317`
- Cause: Feature creep - billing data is only displayed for the latest poll, yet we fetch/store it on every poll.
- Improvement path: Fetch these 5 endpoints only when (a) latest extra-usage values have changed, or (b) on a separate low-frequency schedule (e.g. once per 10 min regardless of poll tier).

**`UsageTimeline` renders up to 2016 points (7 days @ 5min) client-side with Recharts `AreaChart`:**
- Problem: Recharts has poor performance above ~1000 points, especially with gradients + 4 series.
- Files: `Claude Usage Tracker/claude-usage-tracker/src/components/UsageTimeline.tsx:36-52`, `Claude Usage Tracker/claude-usage-tracker/src/components/UsageTimeline.tsx:84-244`
- Cause: Timeline data comes down unbinned from the server.
- Improvement path: Downsample on the server per selected range: "1d" = 5-min buckets (288 points), "7d" = hourly buckets (168 points), "all" = daily buckets.

**`computeNextDelay` produces same-tier stickiness only after 3 "no change" polls:**
- Problem: In the `burst` tier, 3 consecutive 30-second polls = 90 seconds minimum before falling back to `active`. That's ~3x the poll count needed when a user's session is actually over. Fine for accuracy, but wasteful API-wise.
- Files: `Claude Usage Tracker/claude-usage-tracker/src/lib/collector.ts:62-87`
- Cause: Hardcoded threshold of 3.
- Improvement path: Tune based on observed FN/FP rates, or make it config-driven.

**`buildDashboardData` scans the snapshot array 4+ times:**
- Problem: `.filter(s => s.status === "ok")` runs inside `buildActivity`, `buildUsageInsights`, `buildExtraUsageInsights`, plus top-level in `buildDashboardData`. Each filter allocates a new array.
- Files: `Claude Usage Tracker/claude-usage-tracker/src/lib/analysis.ts:145, 178, 237, 306`
- Cause: Minor but adds up when snapshots exceed 10k rows.
- Improvement path: Filter once at the top of `buildDashboardData` and pass the result.

## Fragile Areas

**`collector-singleton.ts` demo-mode DB wipe on every boot:**
- Files: `Claude Usage Tracker/claude-usage-tracker/src/lib/collector-singleton.ts:55-60`
- Why fragile: Comment says "first run, nothing to delete" but actually deletes on every subsequent boot too. A process restart while `DEV_DEMO_MODE=true` destroys demo state permanently.
- Safe modification: Add a query-string or meta-row check for "is the seeded data still fresh" before wiping.
- Test coverage: No test covers `seedDemoData` (it's skipped by the existing tests because they use their own `Config` with unique `dbPath`).

**`config.ts` demo-mode default flipping between dev and prod:**
- Files: `Claude Usage Tracker/claude-usage-tracker/src/lib/config.ts:100-103`
- Why fragile: `demoMode` defaults to `true` in development. That means running `npm run dev` against a real account will NOT collect real data unless the user sets `DEV_DEMO_MODE=false`. And `hasAuth: demoMode || authMode !== "none"` (line 117) means demo mode masks missing credentials even in prod if `PROD_DEMO_MODE=true`.
- Safe modification: Flip defaults: dev demo-mode should be opt-in via env var, not opt-out. Or log a loud banner every start-up so the user always knows which mode is active.
- Test coverage: `test/config.test.ts` exists (213 lines) but this demo-mode flip was introduced in commit `8047c35 fix: split dev and startup runtime configuration` - check that branch coverage exists.

**Windows `npm run dev` / `npm run start:prod` scripts use `set X=Y&&` chaining:**
- Files: `Claude Usage Tracker/claude-usage-tracker/package.json:6, 9`
- Why fragile: `set A=1&& set B=2&& command` only works in Windows `cmd.exe`. Running `npm run dev` from Git Bash, WSL, or PowerShell on macOS/Linux silently sets no env vars. Developers on other platforms will see demo-mode defaults or a server on the wrong port.
- Safe modification: Replace with `cross-env` or a Node prelude script (`scripts/dev.mjs` that sets `process.env.*` and calls `next`).
- Test coverage: None.

**`instrumentation.ts` opens the browser via shell interpolation:**
- Files: `Claude Usage Tracker/claude-usage-tracker/src/instrumentation.ts:10-13`
- Why fragile: Works only on Windows (`start ""`). On Linux/macOS the process exits without opening anything. Also shell-injection-prone as noted above.
- Safe modification: Use a cross-platform opener (`open`, `opn`, or check `process.platform`).

**Every React component uses imperative mouse handlers for hover:**
- Files: e.g. `Claude Usage Tracker/claude-usage-tracker/src/components/Heatmap.tsx:75-84`, `Claude Usage Tracker/claude-usage-tracker/src/app/page.tsx:133-138`
- Why fragile: `onMouseEnter`/`onMouseLeave` set inline styles directly; any React re-render during hover resets them. No keyboard-accessible focus state. Accessibility concern.
- Safe modification: Move hover into CSS (`hover:border-accent`, etc.).

## Scaling Limits

**SQLite database grows unbounded:**
- Current capacity: At active-tier (1 min) polling, ~1440 rows/day. With raw_json cookie payload averaging ~4KB, that's ~5-6MB/day, ~40MB/week, ~170MB/month.
- Limit: Single-user on a laptop is fine for years. But the user's stated plan is (per `Untitled-1.md`) "host dashboard through a tunnel" and "move database to supabase and improve analytics to get exact data form claude code usage on both laptop and pc".
- Scaling path: (a) Implement retention (drop snapshots older than 30 days after rollup). (b) Migrate to Postgres/Supabase as per user goal; structured columns transfer trivially.

**No multi-user / multi-account support:**
- Current capacity: 1 Claude account per running instance. `Config.orgId` is a single string.
- Limit: Running two accounts (user mentions "laptop and pc") requires two separate data dirs and two separate processes.
- Scaling path: Add an `accounts` table; key every snapshot row by `account_id`. Read auth per-account rather than per-process.

**Dashboard never paginates:**
- Current capacity: Up to ~3000 rows scan comfortably at ~50ms.
- Limit: By ~50k rows, `GET /api/dashboard` exceeds 250ms on first fetch; auto-refresh starts to overlap.
- Scaling path: Roll up into `hourly_stats`, `daily_stats` tables; read from those instead of raw snapshots.

## Dependencies at Risk

**`better-sqlite3` is a native dependency:**
- Risk: Requires rebuild when Node ABI changes (major Node upgrades). Prebuilt binaries are not always available for Windows ARM64, Linux musl, etc.
- Impact: `npm install` can fail on CI or developer machines with non-default toolchains.
- Migration plan: Acceptable for local-only. If moving to Supabase (per roadmap), replace with `pg` + Supabase client.

**`pyautogui` (implicit dep in Python sender):**
- Risk: Not in `requirements.txt` at all (see bug above). Also, `pyautogui` is fragile - breaks with HiDPI scaling, multi-monitor, Wayland on Linux.
- Impact: Any change to monitor setup breaks the hardcoded click coordinates.
- Migration plan: Deprecate the browser-automation sender; the CLI variant (`claude_message_send_with_CC_CLI.py`) is more robust.

**`next@16.2.2` + `react@19.2.4`:**
- Risk: Next 16 is recent; React 19 moved several APIs (`useFormState`, server actions). Ecosystem packages (`recharts@3.8.1`, `eslint-config-next@16.2.2`) may lag.
- Impact: Upgrading any peer could cause build breakage.
- Migration plan: Pin exact versions until feature set stabilizes; defer upgrades.

**`schedule` Python library:**
- Risk: Unmaintained-adjacent; last release cadence is slow. Not timezone-aware.
- Impact: DST transitions will shift scheduled times by 1 hour.
- Migration plan: Swap for `APScheduler` with an explicit timezone.

## Missing Critical Features

**No integration between the two subprojects:**
- Problem: Per `README.md`, the whole point of the umbrella repo is to merge tracker + sender so the tracker detects window boundaries and the sender adjusts start times automatically. Today they are completely independent.
- Blocks: The stated roadmap goal. Also blocks any user-facing "when does my next window start" UX.

**No settings UI for window times:**
- Problem: User's `Untitled-1.md` captures the desired feature: per-day overrides ("Tuesdays 8am"), one-off overrides ("just tomorrow start at 8am"), default 5am start. Nothing in the tracker exposes this.
- Blocks: Any self-service scheduling.

**No alerting:**
- Problem: No notification when 5-hour utilization crosses 80%, when extra-usage spend jumps, or when the collector's `consecutiveFailures` climbs.
- Blocks: Noticing quota exhaustion before it hits. The `CollectorHealth` panel only shows "Needs Attention" passively.

**No authentication on the dashboard itself:**
- Problem: `/api/dashboard`, `/api/poll`, `/api/snapshots` are unauthenticated. Fine while bound to `127.0.0.1`, unacceptable if tunneled (per user's goal).
- Blocks: Remote access.

**No log persistence:**
- Problem: `console.log` / `console.warn` go to stdout only. The PowerShell startup task has no redirect. Per user's `Untitled-1.md`: "make sure all errors are logged to troubleshoot (with full error messages from both running node process + API calls we make)".
- Blocks: Post-mortem debugging of collector failures.

**No ability to reset baseline after a manual window-start:**
- Problem: The singleton collector's in-memory `hasFiveHourBaseline` / `lastFiveHourUtil` / `lastFiveHourResetsAt` state is lost on restart. No API to clear it.
- Blocks: If the collector misses the actual window reset, baselines drift until the next restart.

## Test Coverage Gaps

**No integration test for the collector's HTTP path:**
- What's not tested: `UsageCollector.pollOnce` full round-trip - fetch, normalize, insertSnapshot, tier update. Only `computeNextDelay` and `computePollingDelta` (pure functions) are tested.
- Files: `Claude Usage Tracker/claude-usage-tracker/src/lib/collector.ts:221-414`
- Risk: A schema change in normalize.ts + collector.ts (as happened in the "extra usage" series of commits) passes each unit test in isolation but breaks the wiring. Multiple `fix:` commits in git history (`f6a1701 fix: add extra usage fields to no-auth error insertSnapshot call`, `a31eaa7 fix: update test helpers with extra_usage fields`) confirm this.
- Priority: HIGH.

**No test for `seedDemoData` or the demo poll path:**
- What's not tested: `collector-singleton.ts:53-155`, `collector.ts:416-504`.
- Files: `Claude Usage Tracker/claude-usage-tracker/src/lib/collector-singleton.ts`, `Claude Usage Tracker/claude-usage-tracker/src/lib/collector.ts:416-504`
- Risk: Demo mode is what new users see first. Silent failure = first-run UX broken.
- Priority: MEDIUM.

**No test for `config.ts` cookie-vs-bearer endpoint resolution:**
- What's not tested: The recent `8bbf987 fix: simplify env configuration and derive cookie endpoint` logic (`config.ts:82-98`) - cookie-auth endpoint selection, `lastActiveOrg` parsing, `CLAUDE_USAGE_ENDPOINT` legacy fallback. `test/config.test.ts` exists but predates these additions in scope.
- Files: `Claude Usage Tracker/claude-usage-tracker/src/lib/config.ts:82-98`, `Claude Usage Tracker/claude-usage-tracker/test/config.test.ts`
- Risk: Misconfigured endpoint silently polls wrong URL, returns 404/401.
- Priority: MEDIUM-HIGH - root cause of multiple recent fix commits (`18b9461 feat: split cookie/bearer endpoints and improve auth diagnostics`).

**No test for `/api/dashboard`, `/api/poll`, `/api/snapshots` routes:**
- What's not tested: HTTP handlers. Only their logic dependencies (`buildDashboardData`, `querySnapshots`) are tested indirectly.
- Files: `Claude Usage Tracker/claude-usage-tracker/src/app/api/dashboard/route.ts`, `Claude Usage Tracker/claude-usage-tracker/src/app/api/poll/route.ts`, `Claude Usage Tracker/claude-usage-tracker/src/app/api/snapshots/route.ts`
- Risk: Cooldown logic in `/api/poll` has no direct coverage - `a9f0855 fix: no-auth cooldown bypass` suggests this area has regressed before.
- Priority: MEDIUM.

**No frontend tests at all:**
- What's not tested: Every React component under `src/components/`, `src/app/page.tsx`.
- Files: `Claude Usage Tracker/claude-usage-tracker/src/components/*.tsx`, `Claude Usage Tracker/claude-usage-tracker/src/app/page.tsx`
- Risk: Visual regressions, missing null-guards (`data.current?.fiveHour?.utilization!` non-null assertions are common), hover-state bugs.
- Priority: LOW-MEDIUM (local-only tool; easier to eyeball than test).

**Message Sender Python has zero tests:**
- What's not tested: All of `claude_message_send_with_browser.py`, `claude_message_send_with_CC_CLI.py`. `test_send_now.py` is a manual trigger, not a test (no assertions).
- Files: `Claude Message Sender/*.py`
- Risk: Scheduling math, time-randomization, next-slot calculation have edge cases (first slot of day, wrap-around). None are verified.
- Priority: LOW (small surface) but any future merge with the tracker will exercise this code.

**No test for timezone handling:**
- What's not tested: `analysis.ts` local-time hour/day bucketing vs. `usage-window.ts` UTC reset normalization.
- Files: `Claude Usage Tracker/claude-usage-tracker/src/lib/analysis.ts:159-170`, `Claude Usage Tracker/claude-usage-tracker/src/lib/usage-window.ts`
- Risk: DST bugs, cross-timezone deploy bugs - silently wrong heatmaps.
- Priority: MEDIUM.

---

*Concerns audit: 2026-04-16*
