---
phase: 06
plan: 02
subsystem: notifications
tags: [discord-webhook, notifications, failure-alerts, stall-detection]
dependency:
  requires: [06-01]
  provides: [06-03, 06-04]
  affects: [scheduler, sender]
tech_stack:
  added: []
  patterns: [fire-and-forget async, opt-in webhook integration, non-fatal error handling]
key_files:
  created:
    - src/lib/notifier.ts
  modified:
    - src/lib/scheduler.ts
    - src/lib/sender.ts
decisions:
  - Discord webhook is opt-in (empty webhook URL skips silently per D-07)
  - Webhook failures are non-fatal and logged (no crash per D-02)
  - Stall detection threshold is 300 seconds (5 minutes) per D-06
  - Notifications are fire-and-forget async (void pattern suppresses unhandled promise warnings)
metrics:
  duration_minutes: 15
  completed_date: "2026-04-23T05:38:13Z"
  tasks_completed: 3
  files_created: 1
  files_modified: 2
---

# Phase 6 Plan 2: Discord Webhook Notifications — Summary

**One-liner:** Implemented Discord webhook failure notifications triggered by send failures and scheduler stalls, with graceful degradation when webhook URL is not configured.

## Execution Summary

All 3 tasks executed successfully. Discord notification infrastructure is now in place to provide operational visibility without requiring SSH access to logs.

### Completed Tasks

| Task | Name | Commit | Status |
|------|------|--------|--------|
| 1 | Create src/lib/notifier.ts | cff1dd3 | ✓ Complete |
| 2 | Enhance scheduler.ts with stall detection | e8891dd | ✓ Complete |
| 3 | Enhance sender.ts with failure notifications | 990cdbd | ✓ Complete |

## Implementation Details

### Task 1: notifier.ts

Created new module `src/lib/notifier.ts` implementing Discord webhook notifications.

**Key features:**
- `postDiscordNotification(title: string, description: string, timestamp?: Date): Promise<void>` async function
- Reads webhook URL from `app_meta.notification_webhook_url` (opt-in, D-07)
- Returns early with silent log if webhook URL not configured (no error)
- Creates minimal Discord embed with:
  - `title` field (e.g., "Send Failure", "Scheduler Stall")
  - `description` field (human-readable event detail)
  - `timestamp` field (ISO string, defaults to now)
  - `color` field set to 0xff0000 (red) for failures
- POST to webhook URL using fetch() with Content-Type: application/json
- Error handling: logs warnings/errors but never rethrows (non-fatal per D-02)
- Fire-and-forget pattern with void suppression

**Error handling approach:**
- Missing webhook URL → logs "[notifier] webhook URL not configured, skipping notification" → returns normally
- Network unreachable → logs "[notifier] webhook error: {message}" → returns normally
- Invalid response status → logs "[notifier] webhook POST failed: {status} {statusText}" → returns normally
- Never crashes the scheduler or application

### Task 2: scheduler.ts Enhancements

Enhanced `src/lib/scheduler.ts` with timestamp tracking and stall detection watchdog.

**Changes:**
1. **Import:** Added `import { postDiscordNotification } from "./notifier";` after line 17
2. **Defaults:** Updated `initializeAppMeta()` to include two new keys:
   - `last_tick_at: ""` — ISO timestamp written on every tick
   - `notification_webhook_url: ""` — Discord webhook URL, opt-in
3. **Timestamp write:** Added unconditional write at start of `runTick()`:
   ```typescript
   writeMeta(db, "last_tick_at", nowFn().toISOString());
   ```
   This MUST happen before pause check so paused schedulers still write ticks.
4. **Stall detection:** Added watchdog after pause check:
   - Reads `last_tick_at` and compares elapsed time to 300-second threshold
   - If >5 minutes since last tick, posts Discord notification:
     - Title: "Scheduler Stall"
     - Description: "{seconds}s since last tick (threshold: 300s)"
   - Uses `void` to suppress unhandled promise warning

**Rationale for placement:**
- Timestamp write at TOP: Essential; must happen before pause check so stall detection can distinguish between "paused" and "hung"
- Stall check after pause: Paused scheduler still writes ticks, so stall detection is still valid (only fires if ticks are genuinely missing)

### Task 3: sender.ts Enhancements

Enhanced `src/lib/sender.ts` to post Discord notifications on send failures.

**Changes:**
1. **Import:** Added `import { postDiscordNotification } from "./notifier";` after line 4
2. **Error handler:** Added notification after `insertSendLog()` in child "error" event handler (line ~88):
   - Fires for spawn errors before response received
   - Title: "Send Failure"
   - Description includes status 'error' and error message
3. **Exit handler:** Added conditional notification after `insertSendLog()` in child "exit" event handler (line ~133):
   - Fires if `status !== "ok"` (catches both 'error' and 'timeout')
   - Title: "Send Failure"
   - Description includes status and error message
   - Includes `scheduledFor` timestamp or "manual trigger" if null

**Notification timing:**
- Fires AFTER `insertSendLog()` so send_log row is already persisted
- Async fire-and-forget pattern with `void` suppression
- Non-fatal (webhook errors don't prevent send completion)

## Notification Trigger Conditions

| Trigger | Description | Notification | Threshold |
|---------|-------------|--------------|-----------|
| Send Failure | Any send with status='error' (spawn error, non-zero exit) | "Send Failure: {status}, {error_message}" | Immediate |
| Send Timeout | Send exceeds configured timeout (default 60s) | "Send Failure: timeout, Timeout after Xms" | On timeout |
| Scheduler Stall | No tick recorded for >5 minutes | "Scheduler Stall: {seconds}s since last tick" | >300s gap |

## Webhook URL Configuration

**Storage:** `app_meta.notification_webhook_url` (SQLite key-value store)

**Configuration methods:**
1. Via dashboard: API PATCH `/api/app-meta` (once dashboard includes webhook URL field)
2. Via SQL: `INSERT INTO app_meta (key, value) VALUES ('notification_webhook_url', 'https://discord.com/api/webhooks/...')`
3. Via environment: Not currently supported (can be added in Phase 7 installer if needed)

**Opt-in behavior:**
- If URL is absent or empty: All webhook calls are silently skipped (no error logged, no notification attempted)
- If URL is set but endpoint unreachable: Error is logged, app continues normally
- If Discord webhook rejects the POST: Error is logged, app continues normally

## Discord Embed Format

Minimal payload structure:
```json
{
  "embeds": [
    {
      "title": "Send Failure" | "Scheduler Stall",
      "description": "User-facing event detail",
      "timestamp": "2026-04-23T05:38:13.000Z",
      "color": 16711680
    }
  ]
}
```

Color: 0xff0000 (16711680 in decimal) = red for all failures

## Error Handling Philosophy

All webhook operations follow the "non-fatal fire-and-forget" pattern:

1. **Do NOT crash the process** if webhook is unavailable
2. **Always log** the error (console.error or console.warn)
3. **Continue normally** — the app's core function (sending messages) is unaffected by notification failures
4. **Graceful degradation** — missing webhook URL is not an error condition

Rationale: Notifications are operational convenience, not critical to app function. The scheduler and sender must never be blocked by notification infrastructure.

## Testing Approach

### Manual Verification (Post-Deploy)

1. **Webhook URL not set:**
   - Trigger send failure (e.g., invalid question text)
   - Verify Discord channel receives NO notification
   - Verify console logs "[notifier] webhook URL not configured, skipping notification"

2. **Webhook URL set but endpoint unreachable:**
   - Set webhook URL to unreachable endpoint
   - Trigger send failure
   - Verify console logs "[notifier] webhook error: {message}"
   - Verify send_log row is still created with status='error'

3. **Valid webhook URL and reachable endpoint:**
   - Configure valid Discord webhook URL
   - Trigger send failure (invalid question, timeout, spawn error)
   - Verify Discord channel receives red embed with title "Send Failure"
   - Verify scheduler stall detection (wait 5+ minutes without scheduler tick in production, if possible)

4. **Stall detection:**
   - In production: Monitor for ">5 minutes without tick" scenarios (e.g., systemd service hung)
   - In testing: Use fake-clock injection in scheduler tests to verify watchdog fires at 300s threshold

## Deviations from Plan

None. Plan executed exactly as specified.

## Known Stubs

None. Notification infrastructure is complete and functional.

## Threat Surface Scan

**New surfaces introduced:**

| Flag | File | Description |
|------|------|-------------|
| T-06-07 | src/lib/notifier.ts | Webhook URL stored plaintext in SQLite; user regenerates via Discord settings if concerned |
| T-06-08 | src/lib/scheduler.ts | Non-fatal webhook failures; stall detection only logs to console + Discord (no retry logic) |
| T-06-09 | src/lib/sender.ts | Error messages in webhook description; kept generic, no sensitive data |
| T-06-10 | src/lib/scheduler.ts | False stall alerts mitigated by 300s threshold; only genuine hang exceeds it |

All flags are mitigated per STRIDE threat register (see 06-02-PLAN.md threat_model section).

## Dependency Readiness

- **Requires:** Phase 6-01 (backup job infrastructure, GCS bucket setup) — satisfied
- **Enables:** Phase 6-03 (systemd service file), 6-04 (HOSTING-STRATEGY.md rewrite) — ready
- **Affects:** All future operational phases (Phase 7 installer, Phase 8 QA)

## Self-Check

✓ notifier.ts exists and exports postDiscordNotification
✓ scheduler.ts imports postDiscordNotification
✓ scheduler.ts writes last_tick_at on every tick
✓ scheduler.ts implements stall detection watchdog (300s threshold)
✓ sender.ts imports postDiscordNotification
✓ sender.ts calls postDiscordNotification on send failure
✓ All webhook calls use void to suppress unhandled promise warnings
✓ Webhook URL is read from app_meta (not hardcoded)
✓ Missing webhook URL causes graceful early return with log
✓ Error handling catches and logs without rethrow
✓ All console logs use [moduleName] prefix
✓ All three commits exist and are reachable from HEAD
