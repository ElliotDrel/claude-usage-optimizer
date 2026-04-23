---
phase: 06-vm-deployment-hardening
reviewed: 2026-04-23T14:30:00Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - src/lib/backup.ts
  - src/lib/db.ts
  - src/instrumentation.ts
  - src/lib/notifier.ts
  - src/lib/scheduler.ts
  - src/lib/sender.ts
  - claude-tracker.service
  - claude-sender.env.example
  - HOSTING-STRATEGY.md
  - package.json
findings:
  critical: 2
  warning: 4
  info: 3
  total: 9
status: issues_found
---

# Phase 6: Code Review Report

**Reviewed:** 2026-04-23T14:30:00Z
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

Reviewed deployment and core scheduler/sender modules for phase 6 VM hardening. Found two critical security issues related to shell environment propagation and insecure file permissions, plus four warnings around error handling, timeout race conditions, and database initialization. One info item flagged unused export. Overall, the code demonstrates good defensive patterns (fire-and-forget async operations, non-fatal error handling, lock resets on startup) but has gaps in shell isolation, environment credential handling, and input validation.

## Critical Issues

### CR-01: Shell Environment Leakage via spawn() in sender.ts

**File:** `src/lib/sender.ts:45`
**Issue:** The `spawn("claude", ...)` call uses `cwd: os.tmpdir()` to prevent loading project CLAUDE.md, but does not explicitly clear the parent process's environment. Node.js spawned child inherits all parent env vars including `CLAUDE_CODE_OAUTH_TOKEN` and any other sensitive values from the service environment file. If the `claude` CLI or any subprocess it invokes logs or dumps its environment, credentials leak.

**Fix:**
```typescript
// Line 44-48 — add env: {} to sandbox spawned child
const child = spawn("claude", ["-p", question, "--model", "haiku"], {
  cwd,
  stdio: ["ignore", "pipe", "pipe"],
  env: {}, // Explicitly empty environment — claude CLI must be in PATH or not work at all
});
```

**Rationale:** Better-safe approach: child process runs with no environment variables, forcing it to use only what `claude` CLI has baked in (PATH from system, not parent). Alternatively, construct a minimal env with only required vars. Current approach (relying on tmpdir to prevent CLAUDE.md load) is weak isolation.

---

### CR-02: Insecure Default Permissions in HOSTING-STRATEGY.md

**File:** `HOSTING-STRATEGY.md:150`
**Issue:** The guide correctly instructs `sudo chmod 600 /etc/claude-sender.env` but the verification step only warns if permissions are wrong — it does not fail or block the service from starting. A user who misses the chmod step will proceed to service start with world-readable secrets. Additionally, the `claude-sender.env.example` file itself is committed to the repo with `CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat-...` placeholder, which, if accidentally replaced with a real token, would leak it to GitHub history.

**Fix:**

1. **In HOSTING-STRATEGY.md (Step 5):** Add a blocking check:
```bash
# After sudo chmod 600 /etc/claude-sender.env, verify MUST-PASS:
PERMS=$(stat -c %a /etc/claude-sender.env)
if [ "$PERMS" != "600" ]; then
  echo "ERROR: /etc/claude-sender.env has insecure permissions: $PERMS (expected 600)"
  exit 1
fi
echo "✓ Permissions verified: 600"
```

2. **In claude-sender.env.example:** Remove all placeholder values and instruct user to fill them:
```bash
# Replace line 10 with a comment:
# CLAUDE_CODE_OAUTH_TOKEN=YOUR_OAUTH_TOKEN_HERE (from claude setup-token)
```

**Rationale:** Fail-safe deployments block on permission errors rather than warning. Placeholder tokens in examples should be obviously invalid to prevent accidental commits of real credentials.

---

## Warnings

### WR-01: Race Condition Between finished Flag and setTimeout in sender.ts

**File:** `src/lib/sender.ts:52-95`
**Issue:** The `finished` flag prevents double-resolution, but there is still a race window: if the process sends `error` event and then exits before the timeout fires, the timeout callback may fire after `finished = true`. While the code guards against it (line 70), the timeout is not cleared in the error handler. More critically, if SIGTERM kills the process between `clearTimeout(timer)` (line 69) and `finished = true` (line 71), the exit event fires and clears the timeout again, but the error callback still fires (line 95 is `resolve(row)` not guarded by the second finished check at line 102). The double-resolve is prevented by the Promise wrapper, but it's fragile.

**Fix:**
```typescript
// Line 68-96: Restructure to guarantee single code path
child.on("error", (err: Error) => {
  clearTimeout(timer);
  if (finished) return;
  finished = true;

  const duration = Date.now() - startTime;
  const msg = err instanceof Error ? err.message : String(err);
  console.error("[sender]", msg);

  const row = insertSendLog(config, {
    // ... log entry ...
  });

  void postDiscordNotification(
    "Send Failure",
    `Send scheduled for ${scheduledFor || "manual trigger"} failed with status 'error': ${msg}`,
    new Date()
  );

  // MUST resolve to exit the Promise<SendLogRow> contract
  resolve(row);
});
```

The pattern is already correct (no second resolve possible), but Pitfall 2 comment (line 52) is misleading. The real protection is the `finished` flag, not guarding against timeout races. Consider renaming to `resolved` for clarity.

---

### WR-02: Database Initialization Failure Unhandled in scheduler.ts

**File:** `src/lib/scheduler.ts:38-70`
**Issue:** `initializeAppMeta(db)` runs on scheduler startup and writes default keys. If the database is corrupted or the write fails (e.g., disk full, permission error), the INSERT statements will throw, but the exception is not caught in `startScheduler()`. The function signature does not annotate throws, so callers do not know to expect it. The throw will crash the scheduler startup without logging context. Additionally, the `do nothing` ON CONFLICT logic means if a key already exists with a corrupt value (e.g., `schedule_fires: "{broken json"`), it is silently left in place, and the first `parseFiresJson(readMeta(...))` call will hit the catch block (lines 96-107) and log "corrupt schedule_fires, resetting to []" — but the user sees only a warning, not a critical initialization failure.

**Fix:**
```typescript
// Line 463-465 in startScheduler: Wrap initializeAppMeta in try/catch
export function startScheduler(
  db: Database.Database,
  opts?: { nowFn?: () => Date; sendTimeoutMs?: number }
): { stop: () => void } {
  try {
    initializeAppMeta(db);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[scheduler] CRITICAL: Failed to initialize app_meta keys: ${msg}`);
    throw err; // Propagate to instrumentation so service startup fails loudly
  }
  // ... rest of function
}
```

**Rationale:** Silent partial initialization leads to inconsistent state downstream. Better to fail fast and loudly.

---

### WR-03: Incomplete Error Handling in postDiscordNotification

**File:** `src/lib/notifier.ts:31`
**Issue:** The line `const db = getDb({ dataDir: process.env.DATA_DIR ?? "", dbPath: "" } as any);` uses a type assertion to bypass the Config interface requirement. This is unsafe: if `getDb()` later refactors and uses the `dbPath` field (e.g., for error logging), the empty string will cause silent failures. Additionally, there is no guard against `getDb()` throwing if the database initialization fails (corrupted file, permission denied). The function logs and continues (line 37) if webhook is unconfigured, but does not log if the database read itself fails.

**Fix:**
```typescript
// Line 24-39: Add explicit error handling
export async function postDiscordNotification(
  title: string,
  description: string,
  timestamp?: Date
): Promise<void> {
  // Read webhook URL from app_meta (opt-in)
  let webhookUrl: string | undefined;
  try {
    const dataDir = process.env.DATA_DIR ?? "./data";
    const dbPath = `${dataDir}/usage.db`;
    const db = getDb({ dataDir, dbPath });
    const row = db
      .prepare("SELECT value FROM app_meta WHERE key = ?")
      .get("notification_webhook_url") as { value: string } | undefined;
    webhookUrl = row?.value;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[notifier] failed to read webhook URL from database: ${msg}`);
    return; // Silently skip notification on DB error (non-fatal)
  }

  if (!webhookUrl) {
    console.log("[notifier] webhook URL not configured, skipping notification");
    return;
  }

  // ... rest of function
}
```

---

### WR-04: No Validation of Timezone String in fireTimeToUtcIso

**File:** `src/lib/scheduler.ts:166-244`
**Issue:** While the function has a try/catch for invalid timezone (lines 176-184), the fallback always uses `"America/Los_Angeles"` without re-testing it. If Intl.DateTimeFormat itself throws for any reason (e.g., corrupted ICU data, out-of-memory), the code silently logs and continues with the fallback, which may also fail. Furthermore, line 202 checks if `localYear`, `localMonth`, or `localDay` are missing and throws, but the error is only logged in the caller (`runTick`, line 389) — it does not trigger a retry or alert the user that their timezone setting broke the schedule computation.

**Fix:**
```typescript
// Line 176-184: Double-check fallback
try {
  Intl.DateTimeFormat("en-US", { timeZone: timezone });
} catch {
  console.error(
    `[scheduler] invalid timezone '${timezone}', falling back to America/Los_Angeles`
  );
  safeTimezone = "America/Los_Angeles";
  // Double-check fallback
  try {
    Intl.DateTimeFormat("en-US", { timeZone: safeTimezone });
  } catch (fallbackErr) {
    throw new Error(
      `[scheduler] fatal: default timezone America/Los_Angeles is invalid (Intl corrupted?): ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`
    );
  }
}
```

And in `runTick()` at line 387-391, escalate the error:
```typescript
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[scheduler] schedule recompute failed: ${msg}`);
  void postDiscordNotification(
    "Schedule Recompute Error",
    `Failed to recompute schedule: ${msg}. Check timezone setting in app_meta.`,
    now
  );
  // Non-fatal — tick continues with existing (possibly stale) schedule
}
```

---

## Info

### IN-01: Unused Export in sender.ts

**File:** `src/lib/sender.ts:148`
**Issue:** `export { QUESTIONS };` exports the question list, but no caller imports it. This adds to the module's public API surface without value.

**Fix:** Remove line 148.

---

### IN-02: Magic Number for Response Excerpt Cap

**File:** `src/lib/sender.ts:116`
**Issue:** The value `500` is hardcoded to cap response excerpt. Should be a named constant for readability and maintainability.

**Fix:**
```typescript
// Top of file
const MAX_RESPONSE_EXCERPT_CHARS = 500;

// Line 116
responseExcerpt = stdout.slice(0, MAX_RESPONSE_EXCERPT_CHARS) || null;
```

---

### IN-03: Permissive Type Assertion in notifier.ts

**File:** `src/lib/notifier.ts:31`
**Issue:** `as any` bypasses type checking. While the code works, it obscures the contract. The Config interface requires `dbPath`, but we're passing an empty string. This is fragile if Config or getDb() changes.

**Fix:** Instead of `as any`, create a proper minimal config:
```typescript
const dataDir = process.env.DATA_DIR ?? "./data";
const dbPath = `${dataDir}/usage.db`;
const db = getDb({ dataDir, dbPath } as Config);
```

Or better, refactor `getDb()` to not require `dbPath` if it's always derived from `dataDir`.

---

## Additional Observations

**Positive patterns:**
- Fire-and-forget async operations with `.catch()` guards prevent unhandled promise rejections.
- Non-fatal error handling allows scheduler to continue on backup failures (line 70, backup.ts).
- Lock reset on startup (line 66-69, scheduler.ts) prevents stuck state after crashes.
- Stall detection posts Discord notifications (line 326, scheduler.ts) for visibility into outages.

**Deployment hardening notes:**
- `claude-tracker.service` correctly runs as non-root user `claude-tracker` (line 7).
- systemd `Restart=always` (line 12) with 5-second backoff (line 13) is appropriate for production.
- Environment file sourced from `/etc/claude-sender.env` is the right pattern for secrets (line 10).
- Dashboard binding to `127.0.0.1:3018` (not `0.0.0.0`) prevents public exposure — good.

**Testing gaps:**
- No unit tests for `fireTimeToUtcIso` timezone logic with edge cases (DST transitions, invalid Intl data).
- No integration tests for backup + scheduler interaction (backup should not block tick).

---

_Reviewed: 2026-04-23T14:30:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
