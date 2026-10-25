# Claude Usage Optimizer — Consolidated Code Review

**Date:** 2026-05-06
**Sources:** Direct inspection (Claude Opus 4.7) + dispatched `gsd-code-reviewer` agent + Gemini review + Codex review
**Files covered:** 21 source files + 2 shell scripts + install/test surface
**Status:** issues_found

Each finding is tagged with provenance: `[direct]` (Claude Opus), `[agent]` (gsd-code-reviewer), `[gemini]` (Gemini), `[codex]` (Codex), or combinations like `[both]` / `[all]`. Overlapping findings are merged.

**Test/build state (per Codex):** `npm run lint` passes, `npm run build` passes with warnings, `npm test` **fails 1/129** (`scheduler: tick fires due slot`).

---

## Executive Summary

The architecture is clean and the recent local-midnight recompute fix is correct. However the project has multiple **CRITICAL** issues that violate hard constraints in CLAUDE.md, plus several **HIGH** correctness bugs in the core scheduling/sender path. Most serious:

1. **Schedule fires that wrap past local midnight are placed on today's date** — directly breaks the core "two consecutive 5-hour windows span peak" promise.
2. **127.0.0.1 binding is not enforced in code** — only by the systemd unit, with no defense-in-depth. `npm run start` (without `:prod`) defaults to `0.0.0.0`.
3. **Sender does not defensively assert `CLAUDE_CODE_OAUTH_TOKEN`** — silent auth failure path on the project's auth hard-constraint.
4. **SIGTERM exits the process while sends are in flight** — orphan `claude` children, missing send-log rows, possible duplicate fires after restart.
5. **POST `/api/setup` is reachable post-setup** — combined with no CSRF protection, any local browser tab can rewrite credentials on the privileged sudo helper.
6. **`computeUsageDelta` double-counts the first sample** in `peakDetector` (collector workaround doesn't apply).
7. **`setInterval(runTick)` does not gate on previous tick completion** — a tick that takes >60s (slow `claude` send) lets the next tick start, see un-updated `firesDone`, and re-send the same slot.
8. **Linux installer is broken end-to-end** — `claude-tracker.service` is referenced but absent; installer and setup helper write to *different* env paths (`/etc/claude-usage-optimizer.env` vs `/etc/claude-sender.env`). Non-technical install will fail.
9. **Test suite is red on main** — `scheduler: tick fires due slot` fails because recompute overwrites the seeded schedule before the assertion runs.
10. **User-supplied timezone is silently dropped** — setup collects it, writes lowercase `user_timezone` to the env file, but runtime never reads that env key; scheduler defaults to LA.

Recommended fix order is at the bottom.

---

## CRITICAL

### C1. Schedule fires that wrap past local midnight are placed on today's date instead of tomorrow's `[direct, gemini, codex]`
**Files:** `src/lib/scheduler.ts:371-379`, `:567-575`, `:171-249`; corroborated by `analysis.ts:268-273` (LO-09 below)

`fireTimeToUtcIso` always builds a UTC timestamp using *today's* local date. The 5 fire slots are spaced 5h apart (`schedule.ts:48-57`), so when `anchor + 5n` exceeds 24h it wraps via `% 24` and is silently placed on today (in the past) instead of tomorrow. Those fires are then marked stale (>15 min late) and skipped at `scheduler.ts:412-421`. The `shiftFireTimesTomorrow` helper in `analysis.ts:268-273` is independently a no-op (`(ft.hour + 24) % 24 === ft.hour`), suggesting the day-rollover concept exists in the design but was never implemented correctly.

**Impact:** Any peak with anchor ≥ 04:00 local loses one or more downstream slots. With an evening peak the user can lose 2–3 of the 5 slots — directly violating the project's core value proposition.

**Fix:** Track a day offset in `generateSchedule` and pass it into `fireTimeToUtcIso`; fix `shiftFireTimesTomorrow` to advance the date.

---

### C2. First-of-day startup with peak earlier than "now" loses the anchor entirely `[direct]`
**Files:** `src/lib/scheduler.ts:138-157`, `:406-421`

Recompute always builds for "today" starting at hour 0. If the server starts (or recompute is forced) at e.g. 18:00 local with peak midpoint at 12:00, today's 12:05 anchor is in the past → flagged stale → skipped. There is no fallback to schedule for tomorrow.

**Fix:** If the anchor for today is already past the late-threshold at recompute time, generate the schedule for tomorrow instead.

---

### C3. Sender does not defensively propagate / preflight `CLAUDE_CODE_OAUTH_TOKEN` `[agent]`
**File:** `src/lib/sender.ts:48-52`

The `claude` CLI authenticates via `CLAUDE_CODE_OAUTH_TOKEN` (CLAUDE.md hard constraint). The spawn passes `{ ...process.env, HOME: claudeHome }` where `HOME=/tmp/claude-home` is empty/freshly-created, so the CLI cannot find `~/.claude/.credentials.json`. Auth therefore depends entirely on `process.env.CLAUDE_CODE_OAUTH_TOKEN` being in the systemd EnvironmentFile and propagating. There is no preflight assertion or defensive explicit-pass. If absent, the CLI prompts/fails with cryptic stderr stored as `error_message`. No test covers this.

**Fix:** In `sender.ts`, add an explicit preflight: if `process.env.CLAUDE_CODE_OAUTH_TOKEN` is empty/missing, log + insertSendLog with status='error' and return early. Also pass it explicitly in the `env` option.

---

### C4. Dashboard 127.0.0.1 binding is not enforced in code; `npm run start` uses default `0.0.0.0` `[agent]`
**File:** `package.json:24-25`, `src/middleware.ts`

`start:prod` binds `127.0.0.1:3018`, but plain `start` does not — and the systemd unit is the only thing forcing that. CLAUDE.md hard constraint: "Dashboard bound to `127.0.0.1:3018`. Never exposed publicly." There is no defense-in-depth: no Host header check in middleware, no installer-level firewall rule. If a user runs `npm run start`, or the systemd unit is misconfigured, the dashboard is wide-open with the OAuth token visible via `/api/dashboard` raw_json.

**Fix:** Add a Host check in `middleware.ts` that rejects requests where `Host` header is not `127.0.0.1` / `localhost`. Remove `npm run start` or alias it to `start:prod`.

---

### C5. POST `/api/setup` is not blocked once setup is complete `[direct]`
**Files:** `src/middleware.ts:13-18`, `src/app/api/setup/route.ts`

Middleware bypasses everything under `/api/setup`. After initial setup, any local origin (including a malicious page in the user's browser, since the dashboard is on 127.0.0.1) can re-POST to `/api/setup` and rewrite the OAuth token + usage auth via the privileged sudo helper.

**Fix:** Reject POST `/api/setup` when `setup_complete === "true"`, or require an explicit re-setup flag.

---

### C6. `setup_complete` is written before the sudo helper succeeds; rollback is non-atomic `[agent]`
**File:** `src/app/api/setup/route.ts:108-140`

The comment claims this avoids a SIGTERM race during `systemctl restart`. But the rollback only runs when `result.status !== 0`. If the helper writes the env file, restarts the service, and Node dies mid-restart, the flag persists as `true` while the env may be corrupt or partially written. If `systemctl restart` SIGTERMs the API process before `result` is awaited, the API returns 500 even though setup actually completed. The catch-block `unlinkSync(stagingPath)` is racy with the helper's own deletion.

**Fix:** Two-phase commit — write `setup_complete='pending'`, run helper, on success write `'true'`, on failure write `'false'`. Middleware treats `'pending'` like `'false'`.

---

### C7. SIGTERM/SIGINT calls `process.exit(0)` without awaiting in-flight sends `[both]`
**File:** `src/instrumentation.ts:40-48`

Shutdown is synchronous. An in-flight `send()` is a Promise resolved later via `child.on("exit")`. `clearInterval` does not abort the awaited send. The process exits while the `claude` child is still running, the send-log row is never written, and `schedule_fires_done` is never updated — the next tick after restart fires the same scheduled timestamp again. Effectively breaks the duplicate-send-prevention guarantee. SQLite WAL may also be mid-fsync.

**Fix:** Track in-flight sends in a Set; `Promise.allSettled(pending)` with a 30s ceiling before `process.exit`. Alternatively, persist `firesDone` BEFORE issuing send (idempotency-first) and dedupe via send_log.

---

### C8. `getAuthPreflightError` does not handle `authMode === "none"` `[agent]`
**Files:** `src/lib/auth-diagnostics.ts:9-35`, `src/lib/collector.ts:249-252`

When `authMode === "none"`, preflight returns `null` (no error), so the collector proceeds to `fetchJson` with no `Authorization` or `Cookie` header. The earlier `!this.config.hasAuth` guard at `collector.ts:223` does fire in non-demo prod with no auth — but during a partial setup state where `setup_complete='true'` but env wasn't written, the collector silently makes unauthenticated requests every tick and pollutes the DB with error rows.

**Fix:** Add explicit `if (config.authMode === 'none') return 'No auth configured';` at top of `getAuthPreflightError`.

---

### C9. Overlapping `setInterval` ticks can fire the same slot twice `[gemini]`
**File:** `src/lib/scheduler.ts:500-505`

`setInterval(() => { void runTick(...).catch(...) }, 60_000)` does not gate on the previous tick. If a `runTick` takes longer than 60s — entirely possible because `await send(...)` invokes the `claude` CLI with a 60s default timeout, and writes to `schedule_fires_done` happen *after* the await — the next tick fires while the first is still mid-send. The second tick reads `schedule_fires_done` from disk before the first has persisted its update, sees the slot as still pending and due, and triggers a second send for the same timestamp.

**Impact:** Duplicate sends for the same scheduled slot — burns the user's quota and breaks the duplicate-send-prevention contract independent of C7.

**Fix:** Replace `setInterval` with a recursive `setTimeout` that schedules the next tick *after* `runTick` resolves; or guard with an in-memory `isTicking` boolean that `return`s early if a previous tick is still in flight; or persist the `firesDone` update *before* the await (idempotency-first, also addresses C7).

---

### C10. Linux installer references a missing `claude-tracker.service` file `[codex]`
**File:** `scripts/install.sh:197`

`install.sh` copies `claude-tracker.service` to `/etc/systemd/system/`, but no service file exists in the repo (`rg --files -g '*service*'` finds nothing). The VM installer cannot complete — the `cp` fails and systemd has nothing to enable. Directly violates CLAUDE.md's "non-technical user must install end-to-end" hard constraint.

**Fix:** Add the missing `claude-tracker.service` unit file (or rename references to whatever the actual unit is called). Verify the install path on a clean VM.

---

### C11. Installer and setup-helper write to different env-file paths `[codex]`
**Files:** `scripts/install.sh:25` (writes `/etc/claude-usage-optimizer.env`), `scripts/write-env.sh:31` (writes `/etc/claude-sender.env`)

The installer creates one env path; the privileged setup-helper writes to a different path; docs reference yet another. `EnvironmentFile=` in systemd points at one — runtime never reads what setup wrote, or vice versa. Combined with C10, the deployment is broken before it starts. Token/credential changes from the setup wizard never take effect.

**Fix:** Pick one canonical path (recommend `/etc/claude-usage-optimizer.env`), update installer + write-env helper + systemd unit + docs. Quote/escape values per `systemd.exec(5)` EnvironmentFile rules.

---

### C12. Test suite is red on main `[codex]`
**File:** `test/scheduler.test.ts:290`

`npm test` fails `scheduler: tick fires due slot` 1/129. The assertion expects the seeded due-fire to be marked done, but `runTick` calls `recomputeSchedule` which overwrites the seeded `schedule_fires` rows before the tick reaches the fire-execution branch. Either the test's premise is now wrong, or the production behavior regressed when local-midnight recompute was added. Either way: shipping with a red gate hides regressions in the most safety-critical path.

**Fix:** Reproduce, decide whether the production behavior or the test is wrong, fix accordingly. Treat green tests as a release gate (CI required-check).

---

## HIGH

### H1. POST/PATCH endpoints have no CSRF / origin protection `[both, codex]`
**Files:** `src/app/api/send-now/route.ts`, `src/app/api/app-meta/route.ts`, `src/app/api/setup/route.ts`

Any browser tab can POST to localhost:3018 and trigger `claude` CLI invocations or rewrite the schedule. 127.0.0.1 binding does not stop same-browser CSRF.

**Fix:** Validate `Origin`/`Referer` against the configured host, or require a per-session SameSite=strict CSRF token.

---

### H2. PATCH-vs-tick recompute race + non-atomic 4-key write `[agent]`
**Files:** `src/lib/scheduler.ts:341-401` vs `:535-539`

The `schedule_recomputing` lock at lines 535-539 protects PATCH-vs-PATCH overlap. But `runTick`'s recompute branch reads/writes `schedule_fires` without checking it. A PATCH near local midnight can race with the tick's automatic recompute, producing torn writes between `schedule_fires`, `peak_block`, `schedule_generated_at`, and `schedule_fires_done` (separate UPSERTs, not a transaction).

**Fix:** Wrap all four writes in a `db.transaction(() => { ... })` and have both paths honor the lock — or eliminate the flag and rely on a single SQL transaction.

---

### H3. Schedule jitter is recomputed on every recompute, breaking idempotency `[both]`
**Files:** `src/lib/scheduler.ts:371-379`, `src/lib/schedule.ts:54`

`generateSchedule` calls `Math.random()` for jitterMinutes. Every PATCH recomputes and reshuffles jitter for non-anchor slots. The `retainedDone` filter compares exact ISO timestamps, but the new timestamp differs from the old one (jitter changed) — so already-fired slots may not appear in `retainedDone` while they DO appear in `schedule_fires`. A slot that already fired today can re-fire after a recompute if the jittered timestamp drifts to before `now` (within 15-min stale threshold).

**Fix:** Seed the RNG by date (`now.toISOString().slice(0,10) + slot index`) so jitter is deterministic per day. Or persist jitter alongside fires.

---

### H4. `computeUsageDelta` returns `currUtil` when `prevUtil == null`, double-counting first sample `[agent]`
**File:** `src/lib/usage-window.ts:25-26`

`if (prevUtil == null) return currUtil`. `collector.ts` works around this with `hasFiveHourBaseline`, but `peakDetector` does NOT (iterates pairwise treating `prev` as always valid). The first snapshot after a fresh DB always adds full utilization to a single hour bucket, biasing the peak.

**Fix:** Return 0 when `prevUtil == null`. Update `collector.ts` accordingly.

---

### H5. `peakDetector` attributes delta entirely to the *current* hour bucket `[both]`
**File:** `src/lib/peak-detector.ts:62-77`

If prev=14:55 and curr=15:05, the delta from 10 minutes (mostly hour 14) is bucketed entirely into hour 15. In idle tier (5-min cadence) deltas often span the hour boundary. The first snapshot after a long idle gap (10+ min) attributes everything to one hour. Reported peak may be off by one hour.

**Fix:** Distribute delta proportionally across `[prev.timestamp, curr.timestamp]` based on minutes per hour bucket.

---

### H6. `fireTimeToUtcIso` produces wrong timestamps on DST transition days `[agent]`
**File:** `src/lib/scheduler.ts:171-249`

The probe-and-correct algorithm assumes UTC offset is the same throughout the day. On DST spring-forward (2:00 → 3:00), if the user's anchor is 2:30, that wall-clock time *does not exist*. On fall-back, 1:30 occurs twice; the probe picks one ambiguously. No tests cover this. Edge case but real (PT springs forward at 2am once a year).

**Fix:** Detect DST transition days; skip or adjust the anchor. Consider `date-fns-tz` (already in deps).

---

### H7. Stall detection is bypassed when the tick body itself fails `[direct]`
**File:** `src/lib/scheduler.ts:312-329`

`writeMeta(last_tick_at)` is at the top of `runTick` before any work. If subsequent ticks throw inside the body, `last_tick_at` keeps refreshing → no stall ever reported. Stall detection only fires if ticks themselves stop firing.

**Fix:** Write `last_tick_at` only after the tick completes successfully (or track tick-start vs. last-successful-completion separately).

---

### H8. `endpoint` silently falls back to OAuth URL when cookie auth has no `orgId` `[direct]`
**File:** `src/lib/config.ts:90-98`

`buildClaudeCookieEndpoint("")` returns `""`, then `cookieEndpoint || bearerEndpoint` quietly hands the cookie-mode user the bearer/OAuth endpoint, which 401s with a confusing error.

**Fix:** Surface the misconfiguration explicitly in setup validation; don't silently fall back across auth modes.

---

### H9. `tryReadClaudeCredentials` is dead in production; setup wizard conflates two distinct credentials `[agent]`
**Files:** `src/lib/config.ts:39-49`, `scripts/install.sh:102`

Installer creates `useradd --home /nonexistent`, so `tryReadClaudeCredentials` always returns `""` in prod. The fallback works only in dev. Setup writes `CLAUDE_CODE_OAUTH_TOKEN` to /etc/claude-sender.env (used by `claude` CLI), but `bearerToken` resolution in `getConfig` does NOT read `CLAUDE_CODE_OAUTH_TOKEN` — only `CLAUDE_BEARER_TOKEN` or `~/.claude/.credentials.json`. The OAuth token feeds the `claude` CLI; the *usage poller* uses a separate token. Setup wizard presents the OAuth token as the primary credential — confusing for non-technical users.

**Fix:** Setup page should explicitly explain there are two distinct auth paths, or unify them.

---

### H10. `send()` never rejects — `try/catch` blocks around it are dead code `[direct]`
**File:** `src/lib/sender.ts:41-149`

By design (D-03) `send` always resolves with a `SendLogRow`. The `try/catch` blocks in `runTick` and `catchUpOnStartup` wrap an `await` that never throws. Misleading.

**Fix:** Remove the misleading try/catch, or have `send` reject on infrastructure errors so the scheduler can react.

---

### H11. `/api/send-now` has no idempotency or in-flight guard `[direct]`
**File:** `src/app/api/send-now/route.ts`

Rapid clicks spawn parallel `claude` processes. On a 1GB e2-micro with 2GB swap, two concurrent invocations thrash; three+ can OOM.

**Fix:** Module-level `inFlight` flag; reject 429 if a send is active.

---

### H12. Daily backup can be silently missed for a whole day `[both]`
**File:** `src/lib/backup.ts:82-99`

`scheduleDaily` checks `now.getUTCHours()/Minutes() === target` once per ~60s tick. If the event loop is busy at 04:15 UTC the minute window can be skipped entirely. No `last_backup_at` persisted, no catch-up. CLAUDE.md states max 24h data loss is acceptable — a missed day is at the edge. Conversely, on fast restart the same 04:15 minute can fire multiple times.

**Fix:** Persist `last_backup_at`; fire only if `today > last_backup_at` AND now ≥ 04:15.

---

### H13. Demo mode reset bucket / workhour check uses local time while production uses UTC `[both]`
**File:** `src/lib/collector.ts:391-413, 419-420`

Demo only, but produces inconsistent reset boundaries vs. real Anthropic windows. Tests built against demo data may pass under one timezone and fail under another.

---

### H14. `is_anchor` is typed `number` but used as boolean `[agent]`
**Files:** `src/lib/sender.ts:37`, `src/lib/scheduler.ts:277, 427`

Type accepts arbitrary number; call sites pass `fire.isAnchor ? 1 : 0`. A future refactor passing `true/false` directly will silently insert `1`/`0` via better-sqlite3 boolean coercion. Bug-magnet.

**Fix:** Type as `0 | 1` or `boolean`; convert at the SQL boundary.

---

### H16. Setup-collected user timezone is silently ignored at runtime `[codex]`
**Files:** `src/app/api/setup/route.ts:85`, `src/lib/scheduler.ts:48`, `src/app/api/app-meta/route.ts:11`

Setup wizard collects `userTimezone` and writes lowercase `user_timezone` only to the env file. Runtime config never reads that env key, so `app_meta.user_timezone` defaults to `America/Los_Angeles` in `scheduler.ts`. Every non-LA user gets a peak detection / midpoint calculation aligned to the wrong wall clock — directly degrades the core value proposition for everyone outside Pacific time.

**Fix:** In setup, write the timezone into `app_meta.user_timezone` via `setAppMeta` (DB) — not (only) the env file. Validate the IANA name before persisting (see H17).

---

### H17. Invalid `user_timezone` can stall the scheduler tick `[codex]`
**Files:** `src/lib/scheduler.ts:152` (`shouldRecomputeSchedule`), `src/app/api/app-meta/route.ts:11` (PATCH validation)

`new Intl.DateTimeFormat(undefined, { timeZone: tz })` throws `RangeError` on an invalid IANA identifier. The PATCH endpoint accepts arbitrary strings without validation. A user typo (e.g., `America/New York` with a space) silently breaks every scheduler tick from then on — `runTick` aborts, `last_tick_at` may even still be written, and stall detection hides the failure (see H7).

**Fix:** Validate `user_timezone` in the PATCH route via a try/catch on `Intl.DateTimeFormat` before persisting. Wrap the scheduler's call in a try/catch that falls back to UTC and emits a notifier alert.

---

### H15. `catchUpOnStartup` runs concurrently with the first interval tick `[gemini]`
**File:** `src/lib/scheduler.ts:493-505`

`startScheduler` does `void catchUpOnStartup(...)` (fire-and-forget) then immediately schedules `setInterval(runTick, 60_000)`. If catch-up takes >60s (e.g., several missed sends, each up to a 60s CLI timeout), the first interval tick fires while catch-up is still iterating. Both paths read the same `schedule_fires_done` from disk, neither sees the other's pending update, and the same backlogged slot can be sent twice. Compounds with C9.

**Fix:** `await catchUpOnStartup(...)` before scheduling the interval. Persist `firesDone` updates synchronously per slot (already done at scheduler.ts:282 / 432) but make sure the in-memory list passed to the next tick is the post-write state.

---

## MEDIUM

### M1. Empty-history first 3 days fire 5 messages/day at predictable times `[agent]`
**File:** `src/lib/peak-detector.ts:56`, `src/lib/schedule.ts:38-44`

Until 3 days of data accumulate, schedule = 5 fires anchored at 05:05. Wastes daily quota for up to 3 days. No UI warning.

**Fix:** Defer scheduled sends until peak detection is meaningful, or surface a "warming up" badge.

---

### M2. `peakDetector` tiebreak prefers midpoint closest to noon `[direct]`
**File:** `src/lib/peak-detector.ts:92-104, 37-40`

Noon-bias tiebreak penalizes night-shift / late-evening users. Consider earliest-start or recency-weighted tiebreak.

---

### M3. Peak `peak_block` "" vs null conflates "not generated" with "no peak data" `[agent]`
**Files:** `src/lib/scheduler.ts:388, 584`, `src/lib/analysis.ts:401-415`

UI affordances ("warming up" vs "no peak detectable") are indistinguishable.

**Fix:** Standardize on JSON `"null"` literal or a separate flag.

---

### M4. SQLite single-writer guarantee not enforced `[agent, codex]`
**Codex addition:** `getDb()` returns the *first* opened handle regardless of the `config.dbPath` passed on later calls (`src/lib/db.ts:106`). Tests that switch between `usage.db` and `demo.db` end up writing to whichever was opened first → test contamination, and any in-process `dbPath` change (e.g., demo-mode toggle without restart) silently no-ops.
**Files:** `src/lib/db.ts`, `src/lib/collector-singleton.ts`

`getDb` is a module-level singleton, but Next.js dev/HMR can blow this away. `collector-singleton` uses `globalThis._usageCollector` to dodge this; `getDb` doesn't. Running `npm run start` and `npm run dev` simultaneously opens the same DB twice.

**Fix:** File lock (e.g. `proper-lockfile`) on `dbPath`.

---

### M5. Disk-full handling absent `[agent]`

No quota check, no rotation of `usage_snapshots` (grows forever at 5min intervals). Over a year ~100K rows with raw_json — could fill the e2-micro 30GB disk.

**Fix:** Daily DELETE of snapshots older than 90d + VACUUM. Or compact raw_json after extraction.

---

### M6. `analysis.ts buildActivity` uses server-local time, not user_timezone `[agent]`
**File:** `src/lib/analysis.ts:191-193`

Dashboard's hourly bars and heatmap use the *server's* local time (UTC on GCP), while `peakDetector` uses user_timezone. Heatmap shows peaks shifted by the UTC offset.

**Fix:** Pass `user_timezone` to `buildActivity` and use `Intl.DateTimeFormat`.

---

### M7. Setup rollback unlinks staging file *after* rollback DB write `[direct]`
**File:** `src/app/api/setup/route.ts:121-134`

If `setAppMeta(setup_complete=false)` throws, the staging file (containing the OAuth token) is never unlinked.

**Fix:** Unlink in `finally` regardless of rollback outcome.

---

### M8. `getConfig` re-parses env and reads `.credentials.json` on every call `[direct]`
**File:** `src/lib/config.ts:39-49, 58-120`

Called per request and per scheduler tick. Tiny on a healthy box; non-trivial under swap pressure on e2-micro.

**Fix:** Memoize; invalidate on setup completion.

---

### M9. `notifier.ts` does a fresh DB SELECT per notification `[agent]`
**File:** `src/lib/notifier.ts:29`

Each Discord post does a fresh SELECT for the webhook URL. On a stall storm this could spike.

**Fix:** Cache in module scope.

---

### M10. `setup/route.ts` newline guard misses `\t`, `\v`, other control chars `[both]`
**File:** `src/app/api/setup/route.ts:56`

`/[\r\n\0]/` only — a token with tabs or vertical tabs is accepted, likely a paste error.

**Fix:** Stricter charset regex.

---

### M11. Middleware reads DB on every request — no caching, stale-handle risk `[agent]`
**File:** `src/middleware.ts:22`

If DB file is rotated/restored from backup, the singleton handle becomes stale.

---

### M12. `LATE_THRESHOLD_MS` boundary is fragile `[agent]`
**File:** `src/lib/scheduler.ts:406, 412`

Tick interval is 60s, so a slot scheduled at +14:01 and missed by one tick is at +15:01 → silently dropped. Clock jitter near the boundary drops fires.

**Fix:** Make threshold configurable; consider firing late + flagging rather than dropping.

---

### M13. `dbPath` swaps between `usage.db` and `demo.db` per `demoMode` `[agent]`
**File:** `src/lib/config.ts:111`

`setup_complete` written in one DB is invisible in the other. Switching modes re-triggers setup wizard. Probably intentional but undocumented.

---

### M14. `recomputeSchedule` is skipped while `paused === "true"` `[direct]`
**File:** `src/lib/scheduler.ts:331-401`

When user pauses across a date boundary, the schedule isn't refreshed. On unpause mid-day, the recompute runs but inherits C2 (anchor in the past → skipped).

---

### M15. `schedule_recomputing` lock is decorative for synchronous callers `[direct, gemini]`
**File:** `src/lib/scheduler.ts:535-540`

Node's single thread already serializes the synchronous `recomputeSchedule` body — there are zero `await`s inside. The lock turns on and off in the same stack frame and provides no protection while adding two unnecessary disk writes. The flag matters only for the cross-path race in H2; on its own it's misleading and wasteful.

**Fix:** Remove the flag from `recomputeSchedule`; rely on a real DB transaction (see H2) for the cross-path case.

---

### M16. Next.js dev hot-reload leaks scheduler and backup intervals `[gemini]`
**File:** `src/instrumentation.ts:1-50`

`collector-singleton.ts` uses `globalThis._usageCollector` to survive HMR, but the scheduler and backup intervals are local to `register()`. Every hot-reload during `npm run dev` re-runs `register()`, spawning fresh `setInterval`s and orphaning the previous ones. After several reloads, multiple schedulers and backup jobs are all polling the DB and (when ENABLE_SCHEDULER=true in dev) potentially firing sends concurrently.

**Fix:** Cache `schedulerStop` and `backupStop` on `globalThis`; in `register()`, call any existing stop fn before spawning the new interval.

---

### M17. `better-sqlite3` lacks `busy_timeout`, risking `SQLITE_BUSY` under contention `[gemini]`
**File:** `src/lib/db.ts:111`

`db.pragma("journal_mode = WAL")` is set, but `busy_timeout` is not. Under concurrent access (middleware, API routes, scheduler tick, collector poll, backup) a writer waiting on the write lock fails immediately with `SQLITE_BUSY` instead of waiting briefly. With WAL the risk is small but real during the daily backup or schema migrations.

**Fix:** Add `db.pragma("busy_timeout = 5000")` after the WAL pragma.

---

### M18. Override validators accept malformed input `[codex]`
**File:** `src/app/api/app-meta/route.ts:13`

`HH:MM` regex accepts `99:99`; numeric fields use `parseInt` so `"3abc"` parses as `3`. Out-of-range or partially-numeric values get persisted to `app_meta` and silently corrupt scheduling.

**Fix:** Tighten the time regex to `^([01]\d|2[0-3]):[0-5]\d$`; use `Number()` + `Number.isFinite` + range checks (and reject `NaN`).

---

### M19. Notification config is disconnected from setup/env `[codex]`
**Files:** `src/lib/notifier.ts:29`, docs/env

Docs and `.env.example` mention `DISCORD_WEBHOOK_URL`, but `notifier.ts` only reads `app_meta.notification_webhook_url`. No setup field writes that key. Discord notifications never fire unless the user manually PATCHes `app_meta`.

**Fix:** Either wire `DISCORD_WEBHOOK_URL` env into `notifier.ts` as a fallback, or add a setup-wizard field that writes `notification_webhook_url`. Pick one and align the docs.

---

## LOW

### L1. `pickQuestion` uses non-cryptographic `Math.random()` `[agent]`
`src/lib/sender.ts:22-25` — predictable but not security-relevant today.

### L2. `instrumentation.ts:36-38` interpolates `config.appUrl` into a shell `start` command `[agent]`
`APP_HOST` is operator-controlled; if it ever contains shell metachars, command injection. Use `execFileNoThrow` and validate `APP_HOST`.

### L3. `db.ts` `querySnapshots` builds `LIMIT ${limit}` via interpolation `[agent]`
`src/lib/db.ts:216-218` — typed `number` but not enforced at runtime. Prefer `LIMIT ?`.

### L4. `retainedDone` filtering relies on exact ISO timestamp string equality `[agent]`
`src/lib/scheduler.ts:383-384, 579-580` — fragile against future ms-precision changes.

### L5. Setup wizard does not validate GCS bucket name format `[agent]`
`src/app/setup/page.tsx`, `src/app/api/setup/route.ts:74-90` — invalid name fails silently at backup time hours later. Validate `^[a-z0-9._-]{3,63}$`.

### L6. `normalize.ts` `unknownKeys` populated but unused `[agent]`
`src/lib/normalize.ts:54-83` — dead state.

### L7. `auth-diagnostics.ts` returns multi-sentence English errors stored in DB `[agent]`
Endpoint URLs leak today. If future errors include token fragments, redact.

### L8. `parseHHMM` has no range validation `[agent]`
`src/lib/schedule.ts:16-19` — `hour > 23` or `minute > 59` silently accepted. Server validators cover the persisted path; corrupt `defaultSeedTime` from app_meta is unchecked.

### L9. `analysis.ts:268-273` `shiftFireTimesTomorrow` is a no-op `[agent]` (related to C1)
`(ft.hour + 24) % 24 === ft.hour`. Today's and tomorrow's fires are identical. Either remove or implement correctly (advance dates).

### L10. `parseInt` accepts out-of-range stored values at scheduler read time `[direct]`
`src/lib/scheduler.ts:356-357, 553-555` — PATCH validates `peak_window_hours` to [3,6] but the read path accepts any positive integer.

### L11. `notifier` always uses red embed color `[direct]`
`src/lib/notifier.ts:48` — cosmetic.

### L12. `hasFiveHourBaseline` is in-memory only `[direct]`
`src/lib/collector.ts:172-180` — every server restart, first poll returns delta=0. Acceptable normally; bad if process is restart-flapping.

### L13. `backup.ts` hardcodes `/tmp/` paths `[agent]`
`src/lib/backup.ts:31` — project supports Windows for dev. Use `os.tmpdir()`.

### L14. Stray `/*turbopackIgnore: true*/` comment inside `path.resolve` arguments `[agent]`
`src/lib/config.ts:79` — looks like a misplaced pragma.

### L15. Burst-tier polling drops origin tier on transient error `[gemini]`
`src/lib/collector.ts` — On a network blip mid-burst, `computeNextDelay` jumps directly into `ERROR_BACKOFF` (1m, 2m, 5m, 10m). When the error clears, the collector restarts in `idle` rather than returning to the burst it was in. Brief network interruptions cost the user a full burst cycle of resolution.

**Fix:** Stash `tierBeforeError` when transitioning into an error state; restore it on recovery instead of letting the next success rebuild from `idle`.

---

### L16. `npm run build` packaging warnings (deprecated middleware + NFT trace) `[codex]`
Build passes but Next.js warns about deprecated `middleware` runtime usage and an NFT trace warning from dynamic filesystem/config imports. Not a runtime failure today, but it's release-risk debt — a future Next minor could turn either into a hard error.

**Fix:** Switch middleware to the supported config shape; replace dynamic FS/config imports with static ones where possible.

---

### L17. Repo surface has stale/stray artifacts `[codex]`
- Untracked `Unititled.md` (typo of "Untitled") sitting in the project root with a stray resume command.
- `README.md:30` clone URL still uses `your-username` placeholder.

**Fix:** Delete `Unititled.md`; update README clone URL to the real repo path.

---

## Logic Gaps & Edge Cases (not directly in current code)

1. **NTP skew / clock jumps** `[agent]` — backward jump → `firesDone.includes(fire.timestamp)` blocks re-fire (safe). Forward jumps past 15min cause silent drops (H7, M12).
2. **First-day with override set** `[agent]` — a user who configures `schedule_override_start_time` on day 1 gets reliable scheduling immediately. Surface this in setup wizard.
3. **Pause toggled mid-day** `[agent]` — fires scheduled for 16:00 are NOT removed from `schedule_fires` when paused at 14:00. Unpausing at 17:00, the 16:00 fire is stale (>15min) and dropped silently. Document.
4. **OAuth token rotation** `[agent]` — running process keeps using old token until restart. No watcher on /etc/claude-sender.env. Manual env-edit not handled.
5. **GCS credentials** `[agent]` — `Storage()` uses ADC. On e2-micro with no service account attached, backup silently fails forever. No surfaced error in dashboard.
6. **systemd OOMKill on e2-micro** `[agent]` — 1 GB RAM + 2 GB swap. better-sqlite3 + Next.js + Node easily peaks at 600 MB. No memory limit in systemd unit, no swappiness tuning documented.
7. **Schema migration** `[agent]` — `migrateToSimplifiedSchema` only handles `auth_mode` removal. Future migrations need a real version table and forward/back compat strategy.
8. **Backup restore** `[agent]` — `backupDatabase` to GCS exists, but no documented restore procedure or script.
9. **Concurrent recompute** `[agent]` — PATCH at 00:00:30 local midnight can race with the tick's automatic recompute (H2).
10. **Anchor + slot collision** `[agent]` — if `anchor_offset_minutes=0` and an override matches a non-anchor slot's natural minute, anchor and a later slot could collide on same wall-clock time after wraparound. Improbable.
11. **3rd-day peak switch** `[agent]` — at local midnight on day 3, schedule abruptly switches from seed-time to detected-midpoint. Add "warming up" badge and smooth transition.
12. **Peak block shifting daily** `[agent]` — once peak detection is live, midpoint can drift hour-by-hour. No hysteresis. Add minimum-delta threshold before regenerating.
13. **Demo DB swap erases setup state** `[agent]` — switching `demoMode` env var moves between `usage.db` and `demo.db` — `setup_complete` is per-DB.

---

## Recommended Fix Order

### Wave 0 — Deployment blockers (cannot ship at all)
0a. **C10 + C11** — add the missing `claude-tracker.service` unit, standardize on a single env-file path across installer + setup helper + systemd unit + docs. Without these, the Linux install does not complete.
0b. **C12** — fix the failing scheduler test (or the underlying production behavior). Establish green tests as a release gate.
0c. **H16** — make setup actually persist `user_timezone` to `app_meta`; otherwise everyone outside LA gets a wrong-timezone schedule.
0d. **Deploy pipeline** — `npm run build` OOMs on the e2-micro (Bus error, core dumped). Replace the current server-side build in `deploy.sh` with a local-build + rsync artifact deploy: build on local machine, rsync `.next/` + `node_modules/` over SSH, then `systemctl restart`. This is the correct pattern (build on powerful machine, ship artifact to server) and unblocks all future deployments. **NEXT UP.**

### Wave 1 — Core send functionality ⚠️ HIGH PRIORITY — observed failures in production
> These are confirmed broken in the live send_log, not just theoretical. Core functionality is not working as intended.

1. **Timing bug [FIXED locally, not deployed]** — all 5 daily fires burst at 3am UTC (8pm PDT) instead of firing at scheduled times throughout the day. Fix committed (`202a848`) but blocked on deploy pipeline (0d).
2. **Duplicate sends [C9 + H15]** — same scheduled slot fired 2-3x on May 1 due to overlapping ticks + catch-up running concurrently with first interval tick. IDs 7&8 (same slot), 9&10 (same slot), 11&12&13 (same slot fired 3x). Gate ticks on previous completion; await catch-up before first interval.
3. **Sub-second sends with no response [C9 / silent failure]** — sends 1-4 completed in 481-503ms with no response_excerpt and logged status "ok". Real `claude` CLI calls take several seconds minimum. These appear to be silent failures or empty responses masquerading as success. Investigate sender error handling.
4. **Mystery sends with no scheduled_for [unknown origin]** — IDs 5, 14-18 have no `scheduled_for` timestamp. 7 sends of unknown origin fired during initial setup chaos, possibly manual triggers or scheduler state corruption. Add origin tracking to send_log.
5. **No response captured on first 17 sends** — sends 1-17 have no `response_excerpt`. Either response logging was wired after initial deployment or these sends were silently failing. Confirm response capture works end-to-end.
6. **C1 + C2 + L9** — schedule day-wrap: fires past local midnight placed on today instead of tomorrow, losing 1-3 slots on evening peaks. Missed-anchor fallback missing. Dead `shiftFireTimesTomorrow` helper. Fix together; all stem from "today only" date assumption.
7. **C3** — sender has no preflight for `CLAUDE_CODE_OAUTH_TOKEN`; silent auth failure logs as cryptic stderr.
8. **C7** — SIGTERM exits while sends are in flight; send-log row never written, `schedule_fires_done` not updated, causes duplicate fire on next restart.
9. **H17** — invalid `user_timezone` string breaks every scheduler tick silently. Validate on PATCH; wrap `Intl.DateTimeFormat` in try/catch with UTC fallback.

### Wave 2 — Security & integrity
1. **C4** — enforce 127.0.0.1 in code (Host check + fix `npm run start`).
2. **C5 + C6 + H1** — close setup-rewrite path; two-phase commit on setup; CSRF/origin checks on all POST/PATCH.
3. **C8 + H8 + H9** — auth-mode handling, cookie endpoint fallback, OAuth-vs-bearer wizard clarity.
4. **H2 + M15** — atomic 4-key write + cross-path lock for recompute (and remove the placebo lock inside `recomputeSchedule`).

### Wave 2 — Security & integrity
5. **C5 + C6 + H1** — close setup-rewrite path; two-phase commit on setup; CSRF/origin checks on all POST/PATCH.
6. **C8 + H8 + H9** — auth-mode handling, cookie endpoint fallback, OAuth-vs-bearer wizard clarity.
7. **H2 + M15** — atomic 4-key write + cross-path lock for recompute (and remove the placebo lock inside `recomputeSchedule`).

### Wave 3 — Correctness improvements
8. **H3** — deterministic per-day jitter.
9. **H4** — `computeUsageDelta` on null prev → 0.
10. **H5** — distribute deltas across hour buckets.
11. **H6** — DST-day handling.
12. **H7** — fix stall detection ordering.
13. **H11** — send-now in-flight guard.
14. **H12** — backup last-run tracking + idempotency.
15. **M17** — add `busy_timeout = 5000` pragma.
16. **M18** — tighten override validators (HH:MM regex, numeric range checks).
17. **M19** — wire notification webhook env/setup field to match `notifier.ts`.

### Wave 4 — UX / robustness
16. **H10, H13, H14** — dead try/catch, demo timezone, is_anchor type.
17. **M16** — fix dev hot-reload interval leak (cache stop fns on globalThis).
18. **M1–M15** — as bandwidth allows. Prioritize M5 (disk fill), M6 (heatmap timezone), M14 (paused recompute), M4 (single-writer enforcement).

### Wave 5 — Lows
19. L1–L17 — opportunistic. Pick up L17 (stale repo artifacts) while doing release prep, and L16 (build warnings) before the next Next.js upgrade.

---

_Reviewers: Claude Opus 4.7 (direct) + gsd-code-reviewer agent + Gemini + Codex_
_Date: 2026-05-06_
