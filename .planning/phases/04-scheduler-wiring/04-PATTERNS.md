# Phase 4: Scheduler Wiring - Pattern Map

**Mapped:** 2026-04-20  
**Files analyzed:** 4 (1 new, 1 modified, 1 extended, 1 test)  
**Analogs found:** 4 / 4 with exact or role-match analogs

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/scheduler.ts` | service | event-driven (tick loop + fire execution) | `src/lib/collector.ts` | role+flow match |
| `src/instrumentation.ts` | controller (registration) | request-response (startup registration + shutdown) | `src/instrumentation.ts` (existing) | exact |
| `initializeAppMeta()` (in scheduler.ts or db.ts) | utility | CRUD (write defaults) | `src/lib/db.ts` | exact pattern match |
| `test/scheduler.test.ts` | test | unit tests with fake-clock injection | `test/sender.test.ts` | role+framework match |

---

## Pattern Assignments

### `src/lib/scheduler.ts` (service, event-driven tick loop)

**Primary Analog:** `src/lib/collector.ts`

This file implements a 60-second tick loop that fires scheduled sends, recomputes the schedule nightly at 03:00 UTC, catches up on restart, and honors a pause toggle. The pattern mirrors `UsageCollector` class design: a service that manages a recurring timed action with internal state, error isolation, and graceful shutdown.

**Import structure** (lines 1–8 of collector.ts):
```typescript
import type { Config } from "./config";
import { explainAuthFailure, getAuthPreflightError } from "./auth-diagnostics";
import { insertSnapshot } from "./db";
import { normalizeUsagePayload } from "./normalize";
import { parseSnapshot } from "./queries";
import { computeUsageDelta } from "./usage-window";
```

**Pattern recommendation for scheduler.ts:** Import `getDb` (instead of `Config`), `getConfig`, `send`, `peakDetector`, `generateSchedule`, `parseSnapshots`, `querySnapshots`.

```typescript
import type Database from "better-sqlite3";
import type { Config } from "./config";
import { getDb, querySnapshots } from "./db";
import { getConfig } from "./config";
import { send } from "./sender";
import { peakDetector } from "./peak-detector";
import { generateSchedule } from "./schedule";
import { parseSnapshots } from "./queries";
```

**Tick loop structure** (collector.ts, lines 208–220, 475–489):
```typescript
// Pattern: setTimeout-driven loop with graceful stop
private timeout: ReturnType<typeof setTimeout> | null = null;

private scheduleNext(delayMs: number) {
  if (this.timeout) {
    clearTimeout(this.timeout);
    this.timeout = null;
  }
  this.state.nextPollAt = new Date(Date.now() + delayMs).toISOString();
  this.timeout = setTimeout(() => void this.pollOnce(), delayMs);
}

start() {
  if (this.timeout) return;
  console.log("[collector] Starting ...");
  void this.pollOnce();
}

stop() {
  if (this.timeout) {
    clearTimeout(this.timeout);
    this.timeout = null;
  }
}
```

**Recommendation for scheduler.ts:** Use a single exported function `startScheduler(db, opts?)` that returns `{ stop: () => void }` (simpler than a class for this scope), or a class with `start()`/`stop()` methods. Either way, follow the `scheduleNext()` pattern for setting up the 60-second interval.

**Clock injection pattern** (collector.ts, line 213, and RESEARCH.md Pattern 1):

The collector doesn't inject time, but the scheduler MUST (CONTEXT.md D-02). Use this pattern:

```typescript
function startScheduler(
  db: Database.Database,
  opts?: { nowFn?: () => Date }
): { stop: () => void } {
  const nowFn = opts?.nowFn ?? (() => new Date());

  // All time comparisons use nowFn()
  const now = nowFn();
  const utcHour = now.getUTCHours();
  
  // ... rest of tick logic
}
```

**Error isolation in tick loop** (collector.ts, lines 352–388):
```typescript
// Pattern: try/catch wraps the entire async operation; errors are logged but don't halt the loop
try {
  // Poll operation
  const result = await fetchJson(...);
  // ... process result
  this.scheduleNext(nextTier.delayMs);
  return { status: "ok" };
} catch (err) {
  const rawMsg = err instanceof Error ? err.message : String(err);
  const msg = explainAuthFailure(this.config, rawMsg);
  this.state.lastError = msg;
  // ... error handling
  this.scheduleNext(nextTier.delayMs);
  console.warn(`[collector] Poll failed: ${msg}`);
  return { status: "error", error: msg };
} finally {
  this.polling = false;
  this.state.isPolling = false;
}
```

**Recommendation for scheduler.ts:** Each fire attempt inside the tick must be wrapped in its own try/catch (CONTEXT.md D-03). Errors are logged as `[scheduler] send failed for fire at {time}: {error}` and the loop continues. The overall `setInterval` is never cleared by a per-fire error.

```typescript
// Inside tick loop, for each fire:
try {
  const isAnchor = /* determine from schedule */;
  const result = await send(config, {
    scheduledFor: fireTimestamp,
    isAnchor: isAnchor ? 1 : 0,
  });
  console.log(`[scheduler] fire at ${fireTimestamp} completed with status ${result.status}`);
  firesDone.push(fireTimestamp);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[scheduler] send failed for fire at ${fireTimestamp}: ${msg}`);
  // Continue to next fire
}
```

**Log prefix convention** (collector.ts, lines 382, 478):
```typescript
console.warn(`[collector] Poll failed: ...`);
console.log(`[collector] Starting ...`);
```

**Recommendation:** Use `[scheduler]` prefix for all scheduler logs (not `[Scheduler]` or `scheduler:`).

---

### `src/instrumentation.ts` (controller, registration)

**Analog:** `src/instrumentation.ts` (existing file)

The existing file already shows the pattern for registering a service at startup and handling shutdown. The scheduler registration will follow the same structure.

**Current pattern** (lines 1–23 of existing instrumentation.ts):
```typescript
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Start the collector when the Next.js server boots
    const { getCollector } = await import("./lib/collector-singleton");
    const { getConfig } = await import("./lib/config");
    const collector = getCollector();
    const config = getConfig();
    console.log("[instrumentation] Collector started");

    if (config.autoOpenBrowser) {
      const { exec } = await import("node:child_process");
      exec(`start "" "${config.appUrl}"`);
    }

    const shutdown = () => {
      collector.stop();
      process.exit(0);
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  }
}
```

**Recommendation for scheduler registration:** Add scheduler start/stop logic after the collector. The scheduler starts only when `(NODE_ENV=production || ENABLE_SCHEDULER=true) && !config.demoMode` (CONTEXT.md D-01). The shutdown handler must call both `collector.stop()` and `schedulerStop()`.

**Code example** (from RESEARCH.md Code Examples / Integration in instrumentation.ts):
```typescript
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getCollector } = await import("./lib/collector-singleton");
    const { getConfig } = await import("./lib/config");
    const { getDb } = await import("./lib/db");
    const { startScheduler } = await import("./lib/scheduler");

    const collector = getCollector();
    const config = getConfig();
    const db = getDb(config);

    console.log("[instrumentation] Collector started");

    // Scheduler: start only in production OR with explicit opt-in, and not in demo mode
    const shouldStartScheduler =
      (process.env.NODE_ENV === "production" || process.env.ENABLE_SCHEDULER === "true") &&
      !config.demoMode;

    let schedulerStop = () => {};
    if (shouldStartScheduler) {
      const scheduler = startScheduler(db);
      schedulerStop = scheduler.stop;
      console.log("[instrumentation] Scheduler started");
    }

    if (config.autoOpenBrowser) {
      const { exec } = await import("node:child_process");
      exec(`start "" "${config.appUrl}"`);
    }

    const shutdown = () => {
      collector.stop();
      schedulerStop();
      process.exit(0);
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  }
}
```

---

### `initializeAppMeta()` (utility, CRUD write defaults)

**Analog:** `src/lib/db.ts` lines 90–103 (migration pattern with INSERT ON CONFLICT DO UPDATE)

This function writes all 10 required `app_meta` keys with their defaults on scheduler startup, using `INSERT OR IGNORE` so existing values are never overwritten.

**Pattern from db.ts** (lines 90–104):
```typescript
db.prepare(`
  INSERT INTO app_meta (key, value)
  VALUES ('schema_version', 'simplified-v1')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`).run();
```

**Recommendation for initializeAppMeta():** Use `INSERT INTO ... VALUES ... ON CONFLICT(key) DO NOTHING` (not `DO UPDATE`) so user-set values are never clobbered. Loop over all 10 defaults and insert each one idempotently.

**Code example** (from RESEARCH.md Pattern 2 / app_meta Initialization):
```typescript
function initializeAppMeta(db: Database.Database): void {
  const defaults: Record<string, string> = {
    schedule_fires: "[]",
    schedule_fires_done: "[]",
    schedule_generated_at: "",
    peak_block: "",
    schedule_override_start_time: "",
    peak_window_hours: "4",
    anchor_offset_minutes: "5",
    default_seed_time: "05:05",
    user_timezone: "America/Los_Angeles",
    paused: "false",
  };

  for (const [key, value] of Object.entries(defaults)) {
    db.prepare(
      "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING"
    ).run(key, value);
  }
}
```

**Integration in scheduler startup:** Call `initializeAppMeta(db)` before the first tick (CONTEXT.md D-04).

```typescript
export function startScheduler(
  db: Database.Database,
  opts?: { nowFn?: () => Date }
): { stop: () => void } {
  // Initialize app_meta defaults before first tick
  initializeAppMeta(db);

  const nowFn = opts?.nowFn ?? (() => new Date());
  // ... rest of scheduler logic
}
```

**Location decision:** `initializeAppMeta()` can live in `scheduler.ts` (scope-specific) or be exported from `db.ts` (shared utility). Recommendation: **Put it in `scheduler.ts`** as a private function called during startup, since it's specific to scheduler initialization and keeps scheduler.ts self-contained.

---

### `test/scheduler.test.ts` (test, unit tests with fake-clock injection)

**Analog:** `test/sender.test.ts` (lines 1–46)

The test file uses Node.js built-in `node:test` and `node:assert/strict`, with `describe()` / `it()` test structure and an `after()` cleanup hook.

**Test setup pattern** (sender.test.ts, lines 1–26):
```typescript
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { getDb, insertSendLog } from "../src/lib/db";
import { send, QUESTIONS } from "../src/lib/sender";
import type { Config } from "../src/lib/config";

const dbPath = path.join(os.tmpdir(), `test-send-${Date.now()}.db`);

const config: Config = {
  host: "localhost",
  port: 3017,
  appUrl: "http://localhost:3017",
  autoOpenBrowser: false,
  dataDir: os.tmpdir(),
  dbPath,
  orgId: "",
  endpoint: "https://api.anthropic.com/api/oauth/usage",
  bearerToken: "",
  sessionCookie: "",
  authMode: "none",
  hasAuth: false,
  demoMode: false,
};

describe("send_log write logic", () => {
  after(() => {
    if (fs.existsSync(dbPath)) {
      getDb(config).close();
    }

    for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      if (fs.existsSync(file)) {
        fs.rmSync(file, { force: true });
      }
    }
  });

  it("description", () => {
    assert.strictEqual(actual, expected);
  });
});
```

**Recommendation for scheduler.test.ts:** Create a temporary test database in `os.tmpdir()`, import `getDb()` and `scheduler` module. Use the `after()` hook to clean up database files (including WAL shards).

**Fake-clock pattern for scheduler tests** (from RESEARCH.md Pattern 1 and D-02):
```typescript
it("should recompute at 03:00 UTC", () => {
  const testDb = getDb(testConfig);
  
  // Freeze time at 2026-04-20T02:59:00Z (before 03:00)
  const earlyHour = () => new Date("2026-04-20T02:59:00Z");
  const scheduler = startScheduler(testDb, { nowFn: earlyHour });
  
  // Manually trigger one tick by calling the tick function
  // (depends on whether scheduler exposes tickOnce() for testing)
  // Verify: schedule_generated_at is empty (no recompute yet)
  
  // Freeze time at 2026-04-20T03:00:00Z (at 03:00)
  const lateHour = () => new Date("2026-04-20T03:00:00Z");
  // (This requires re-creating the scheduler or injecting time into the tick)
  
  // Verify: schedule_generated_at is now set
  scheduler.stop();
});
```

**Key test requirements** (from RESEARCH.md Validation Architecture):

| Requirement | Test Name | Coverage |
|-------------|-----------|----------|
| SCHED-01 | "scheduler recomputes at 03:00 UTC" | At 03:00 UTC, reads status=ok snapshots, calls peakDetector() + generateSchedule(), persists to app_meta |
| SCHED-10 | "scheduler catches up on restart" | On startup, fires missed by <15 min fire immediately; >=15 min skipped |
| SCHED-11 | "scheduler 60s tick fires due sends" | Tick loop fires any scheduled time <= now not in done list |
| SCHED-12 | "scheduler respects pause toggle" | When app_meta.paused=true, all fires skipped until toggled off |
| DATA-04 | "scheduler initializes app_meta keys" | All 10 app_meta keys initialized on startup with documented defaults |

**Example test structure** (derived from sender.test.ts pattern):
```typescript
describe("scheduler", () => {
  after(() => {
    // Clean up temp database
  });

  it("initializes app_meta keys on startup", () => {
    const db = getDb(testConfig);
    startScheduler(db);
    
    const schedule_fires = db
      .prepare("SELECT value FROM app_meta WHERE key = 'schedule_fires'")
      .get();
    assert.strictEqual(schedule_fires?.value, "[]");
    
    const paused = db
      .prepare("SELECT value FROM app_meta WHERE key = 'paused'")
      .get();
    assert.strictEqual(paused?.value, "false");
  });

  it("skips fires when paused is true", () => {
    const db = getDb(testConfig);
    db.prepare("INSERT INTO app_meta (key, value) VALUES ('paused', 'true')").run();
    
    // Seed a fire at current time
    db.prepare("INSERT INTO app_meta (key, value) VALUES ('schedule_fires', ?)").run(
      JSON.stringify([new Date().toISOString()])
    );
    
    const scheduler = startScheduler(db);
    // Trigger one tick (implementation detail: expose tickOnce() or call internal tick)
    
    // Verify: fire was NOT executed (send_log is empty)
    const logs = db.prepare("SELECT COUNT(*) as cnt FROM send_log").get();
    assert.strictEqual(logs.cnt, 0);
    
    scheduler.stop();
  });

  it("catches up fires missed by less than 15 minutes on restart", () => {
    const db = getDb(testConfig);
    const now = new Date();
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
    
    // Seed a fire that was scheduled 10 minutes ago
    db.prepare("INSERT INTO app_meta (key, value) VALUES ('schedule_fires', ?)").run(
      JSON.stringify([tenMinutesAgo])
    );
    
    const scheduler = startScheduler(db, { nowFn: () => now });
    // Give catch-up logic a moment to run
    
    // Verify: fire was executed (send_log has a row)
    const logs = db.prepare("SELECT COUNT(*) as cnt FROM send_log").get();
    assert.ok(logs.cnt >= 1, "Catch-up should have fired the stale send");
    
    scheduler.stop();
  });
});
```

---

## Shared Patterns

### Error Handling with Bracketed Logging

**Source:** `src/lib/sender.ts` (lines 74–75, 382) and `src/lib/collector.ts`  
**Apply to:** All scheduler logs

Pattern: Always use a bracketed prefix like `[scheduler]` for consistency with existing codebase.

```typescript
console.log("[scheduler] fire at 14:05:00Z completed");
console.error("[scheduler] send failed for fire at 14:05:00Z: timeout");
```

### Options Bag Pattern for Testability

**Source:** `src/lib/sender.ts` (lines 25–31)  
**Apply to:** Scheduler initialization

Pattern: Accept an optional second parameter `opts?: { ... }` to inject dependencies for testing (like `nowFn` for clock injection).

```typescript
export function startScheduler(
  db: Database.Database,
  opts?: { nowFn?: () => Date }
): { stop: () => void } {
  const nowFn = opts?.nowFn ?? (() => new Date());
  // ...
}
```

### Database Transaction and Idempotent Writes

**Source:** `src/lib/db.ts` (lines 90–104)  
**Apply to:** `initializeAppMeta()` and any app_meta updates

Pattern: Use `ON CONFLICT(key) DO NOTHING` for idempotent inserts, or `ON CONFLICT(key) DO UPDATE` if you need to update existing rows. For app_meta defaults, use `DO NOTHING` to preserve user-set values.

```typescript
db.prepare(
  "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING"
).run(key, value);
```

### Named Exports (No Default Exports)

**Source:** All lib files (peak-detector.ts, schedule.ts, sender.ts, queries.ts, db.ts)  
**Apply to:** `scheduler.ts`

Pattern: Export a single named function `startScheduler()` or a class, never a default export. Follow camelCase verb-first naming.

```typescript
// Correct
export function startScheduler(db, opts?) { ... }

// Wrong
export default function startScheduler(...) { ... }
```

---

## No Analog Found

No files lack a close match. All scheduler functionality is covered by existing patterns in the codebase:
- Tick loop pattern from `collector.ts`
- Database patterns from `db.ts`
- Service initialization from `instrumentation.ts`
- Test patterns from `test/sender.test.ts`

---

## Metadata

**Analog search scope:** `src/lib/`, `src/instrumentation.ts`, `test/`  
**Files scanned:** 12 lib files, 13 test files, 1 instrumentation file  
**Pattern extraction date:** 2026-04-20  
**Confidence:** HIGH — All analogs verified by reading actual implementation files from Phase 1–3

---

*Phase: 04-scheduler-wiring*  
*Pattern mapping complete: 2026-04-20*
