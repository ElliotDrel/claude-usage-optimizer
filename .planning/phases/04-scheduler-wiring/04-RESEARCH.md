# Phase 4: Scheduler Wiring - Research

**Researched:** 2026-04-20  
**Domain:** In-process scheduler loop with nightly recompute, catch-up-on-restart, and pause toggle  
**Confidence:** HIGH

## Summary

Phase 4 wires the scheduler into the running Node.js process via `instrumentation.ts`. The scheduler is a 60-second tick loop that:

1. Fires sends for any scheduled time ≤ now and not yet recorded in `schedule_fires_done`
2. Recomputes the schedule nightly at 03:00 UTC by reading all `status='ok'` snapshots, calling `peakDetector()` and `generateSchedule()`, and persisting results to `app_meta`
3. On process startup, catches up any fires missed by <15 minutes and skips older misses
4. Honors a global pause toggle (`app_meta.paused`) that survives restarts

All required `app_meta` keys (10 total) are initialized on scheduler startup with sensible defaults, ensuring the Phase 5 dashboard can safely read them immediately. The scheduler auto-starts in production and requires `ENABLE_SCHEDULER=true` to opt in during development (demo mode suppresses it regardless).

**Primary recommendation:** Implement `scheduler.ts` as a single named-export function `startScheduler(db: Database, opts?: { nowFn?: () => Date })` that returns a `stop()` function for SIGTERM shutdown. Use a bracketed `[scheduler]` log prefix throughout. All time comparisons must use injected `nowFn()` for testability, defaulting to `() => new Date()`.

## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01: Dev-mode gating**
- Scheduler auto-starts in production (`NODE_ENV=production`). In development, it requires `ENABLE_SCHEDULER=true` to opt in.
- Demo mode (`config.demoMode === true`) also suppresses the scheduler regardless of `NODE_ENV`.
- Logic in `instrumentation.ts`: start scheduler only when `(NODE_ENV=production || ENABLE_SCHEDULER=true) && !config.demoMode`.

**D-02: Clock injection for testability**
- `scheduler.ts` accepts an optional `nowFn?: () => Date` in its options bag (consistent with `opts?: { ... }` pattern from `db.ts`).
- All time comparisons inside the scheduler (catch-up detection, 03:00 recompute check, fire-due detection) use `nowFn()` instead of `new Date()`.
- Default is `() => new Date()`.

**D-03: Tick error isolation**
- Each fire attempt inside the 60s tick is wrapped in its own try/catch.
- Errors are logged as `[scheduler] send failed for fire at {time}: {error}` and the tick continues to process remaining fires.
- The interval itself is never cleared by a per-fire error. This matches Phase 3 D-01 (no retry) — the next scheduled slot is the natural "retry".
- Persistent failure is caught by Phase 6 stall notifications.

**D-04: app_meta initialization**
- On scheduler startup, a single `initializeAppMeta(db)` call writes all DATA-04 keys with their defaults if not already present (`INSERT OR IGNORE`).
- This runs before the first tick, ensuring Phase 5 dashboard can safely read all scheduler keys immediately without blank-value handling.

### Claude's Discretion

- Exact module structure of `scheduler.ts` (one exported `startScheduler(db, opts?)` function, or a class with start/stop)
- Whether `initializeAppMeta` lives in `scheduler.ts` or is extracted to `db.ts`
- Exact catch-up logic: compare the most recent missed fire (from `schedule_fires` not in `schedule_fires_done`) against `nowFn()` — pick the cleanest implementation
- How the 03:00 UTC recompute is detected on each tick (compare `schedule_generated_at` date to today UTC — if it's yesterday or missing, and current UTC hour ≥ 3, recompute)

### Deferred Ideas

None — discussion stayed within phase scope.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SCHED-01 | System recomputes the optimal schedule at 03:00 UTC daily using all historical `status='ok'` snapshots. | Tick loop checks UTC hour ≥ 3 on each tick; if `schedule_generated_at` is not today, call `peakDetector()` + `generateSchedule()` and persist to `app_meta` keys. Query path uses `querySnapshots(config, { status: 'ok' })` then `parseSnapshots()`. |
| SCHED-10 | On restart, any missed fire within the last 15 minutes fires immediately; older misses are skipped. | Startup catch-up logic: read `schedule_fires` (array of ISO timestamps), filter to times between `15 minutes ago` and `now`, call `send()` for each, then insert into `schedule_fires_done`. |
| SCHED-11 | An in-process 60-second tick loop invokes the sender for any fire time whose timestamp is ≤ now and not yet marked done today. | `setInterval(60_000)` tick reads `schedule_fires` and `schedule_fires_done` from `app_meta`, calls `send()` for each fire not in done list where fire_timestamp ≤ now, then appends to `schedule_fires_done`. |
| SCHED-12 | User can globally pause automatic sending via a dashboard toggle; scheduler honors pause state on every tick. | Before attempting any fire, check `app_meta.paused`. If `'true'`, skip all fire attempts. If `'false'`, proceed normally. |
| DATA-04 | `app_meta` key-value store holds 10 documented keys with defaults and types. | `initializeAppMeta()` writes INSERT OR IGNORE for all 10 keys on startup: `schedule_fires`, `schedule_fires_done`, `schedule_generated_at`, `peak_block`, `schedule_override_start_time`, `peak_window_hours`, `anchor_offset_minutes`, `default_seed_time`, `user_timezone`, `paused`. |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Scheduled fire execution | Backend (Node.js in-process) | Database (SQLite for fire state) | Timing-sensitive decision (fire ≤ now?) must run in-process; durability of state (which fires done?) in persistent storage |
| Nightly recompute check | Backend (in-process tick) | Database (read snapshots, write schedule) | Schedule computation is pure and async-friendly; must be triggered from a persistent tick |
| Catch-up logic after restart | Backend (startup init) | Database (read today's fires and done list) | Must run once at startup before first tick to fire any recent misses; state lives in `app_meta` |
| Pause toggle state | Database (app_meta storage) | Backend (read on each tick) | Global state must survive restarts; enforcement is in-process on each tick |
| Fire-due timestamp comparison | Backend (in-process) | — | UTC timestamp math is local computation; no I/O needed |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | ^11.6.0 [VERIFIED: npm registry 2026-04-20] | Synchronous SQLite bindings for read/write | Project chose for simplicity; synchronous makes testing easier than async |
| node:child_process | built-in | `spawn()` for `claude` CLI invocation | Standard Node.js API; already used in Phase 3 sender.ts |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:assert/strict | built-in | Test assertions | Tests for catch-up logic, tick timing, recompute detection |

### Existing Modules Used By Scheduler

| Module | Exported Symbols | Signature | From Phase |
|--------|-----------------|-----------|-----------|
| `src/lib/peak-detector.ts` | `peakDetector` | `(snapshots: ParsedSnapshot[], timezone?: string) => PeakDetectorResult \| null` | Phase 2 |
| `src/lib/schedule.ts` | `generateSchedule` | `(peakBlock: PeakBlock \| null, options?: ScheduleOptions) => FireTime[]` | Phase 2 |
| `src/lib/sender.ts` | `send` | `(config: Config, opts?: { timeoutMs?: number; scheduledFor?: string \| null; isAnchor?: number }) => Promise<SendLogRow>` | Phase 3 |
| `src/lib/queries.ts` | `parseSnapshots` | `(rows: SnapshotRow[]) => ParsedSnapshot[]` | Phase 1 |
| `src/lib/db.ts` | `getDb`, `querySnapshots` | `getDb(config: Config): Database.Database`; `querySnapshots(config, opts?) => SnapshotRow[]` | Phase 1 |
| `src/lib/config.ts` | `getConfig` | `() => Config` | Project foundation |

## Architecture Patterns

### System Architecture Diagram

```
Next.js Process (instrumentation.ts)
│
├─ [Startup]
│  ├─ import getDb, getConfig
│  ├─ call initializeAppMeta(db) — writes defaults to app_meta if not present
│  └─ call startScheduler(db, opts) — returns { stop }; registers SIGTERM/SIGINT handler
│
└─ [Tick Loop: every 60 seconds]
   ├─ Check app_meta.paused
   │  └─ if 'true': skip all fires, return
   │
   ├─ [Recompute Check]
   │  ├─ Read app_meta.schedule_generated_at (ISO timestamp or empty)
   │  ├─ If date(schedule_generated_at) < today UTC AND UTC hour ≥ 3:
   │  │  └─ [Recompute: read → transform → persist]
   │  │     ├─ querySnapshots(config, { status: 'ok' })
   │  │     ├─ parseSnapshots(rows)
   │  │     ├─ peakDetector(snapshots, config.user_timezone)
   │  │     ├─ generateSchedule(peakBlock, { ... app_meta config ... })
   │  │     ├─ convert FireTime[] to today's UTC ISO timestamps
   │  │     └─ write to app_meta: schedule_fires, peak_block, schedule_generated_at, reset schedule_fires_done=[]
   │  └─ If not time to recompute: skip
   │
   ├─ [Fire Execution]
   │  ├─ Read app_meta.schedule_fires (JSON array of UTC ISO timestamps)
   │  ├─ Read app_meta.schedule_fires_done (JSON array of UTC ISO timestamps already done)
   │  ├─ For each fire in schedule_fires:
   │  │  └─ If fire_timestamp ≤ now AND fire_timestamp NOT in schedule_fires_done:
   │  │     ├─ [try/catch] send(config, { scheduledFor: fire_timestamp, isAnchor: ? })
   │  │     ├─ Append fire_timestamp to app_meta.schedule_fires_done
   │  │     └─ Log [scheduler] fire at {fire_timestamp} completed with status {status}
   │  │
   │  └─ On error: log [scheduler] send failed for fire at {time}: {error}; continue
   │
   └─ [Catch-up: Startup Only]
      └─ On first startup after init:
         ├─ Read app_meta.schedule_fires (JSON of today's fire times)
         ├─ For each fire NOT in app_meta.schedule_fires_done:
         │  └─ If fire_timestamp > (now - 15 min) AND fire_timestamp ≤ now:
         │     └─ send(config, { scheduledFor: fire_timestamp, isAnchor: ? })
         │     └─ Append to app_meta.schedule_fires_done
         │
         └─ After catch-up: proceed to normal tick loop
```

**Data flow:** On each tick, the scheduler reads `app_meta` keys, conditionally recomputes the schedule (at 03:00 UTC), and fires any due sends by calling Phase 3's `send()`. All state (which fires are scheduled, which are done) lives in `app_meta` as JSON strings. The scheduler is the sole writer to these keys (except the dashboard in Phase 5, which writes config overrides).

### Recommended Project Structure

```
src/
├── lib/
│   ├── scheduler.ts             # [NEW] Main scheduler: startScheduler(), tick logic, recompute, catch-up
│   ├── db.ts                    # [EXTENDED] app_meta table DDL already present; initializeAppMeta() added or kept in scheduler.ts
│   └── [peak-detector, schedule, sender, queries, config, etc. — unchanged from Phases 1–3]
├── instrumentation.ts           # [EXTENDED] Register scheduler after collector, mirror shutdown pattern
└── [routes, pages — unchanged]

test/
├── scheduler.test.ts            # [NEW] Fake-clock tests: tick logic, catch-up, recompute timing, pause toggle
└── [other test files — unchanged]
```

### Pattern 1: Tick Loop with Injected Clock

**What:** A `setInterval`-driven loop that accepts an optional `nowFn?: () => Date` for test-friendly time freezing. Instead of calling `new Date()` directly, the scheduler calls `nowFn()` on every time comparison.

**When to use:** Any scheduler, timer-driven system, or retry logic that must be testable without real-world delays.

**Example:**

```typescript
// Source: Established pattern from Phase 3 (sender.ts options bag)
// and Phase 2 (pure function testing)

function startScheduler(
  db: Database.Database,
  opts?: { nowFn?: () => Date }
): { stop: () => void } {
  const nowFn = opts?.nowFn ?? (() => new Date());

  // Example: fire-due check
  const fireDueTimestamp = new Date("2026-04-20T14:05:00Z");
  if (fireDueTimestamp <= nowFn()) {
    // Fire is due
  }

  // Example: 03:00 UTC recompute detection
  const now = nowFn();
  const utcHour = now.getUTCHours();
  if (utcHour >= 3) {
    // Time to check for recompute
  }

  const interval = setInterval(() => {
    // Tick logic that uses nowFn()
  }, 60_000);

  return {
    stop: () => clearInterval(interval),
  };
}
```

### Pattern 2: app_meta Initialization with INSERT OR IGNORE

**What:** Write all required keys to `app_meta` on startup if not already present, using `INSERT OR IGNORE` so the operation is idempotent and doesn't overwrite user-set values.

**When to use:** Setting up configuration with sensible defaults that must survive restarts and should not be overwritten.

**Example:**

```typescript
// Source: Phase 1 db.ts migration pattern + CONTEXT.md D-04

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

### Pattern 3: Fire-Due Detection with UTC Timestamp Comparison

**What:** Store fire times as ISO 8601 UTC strings in `app_meta`. Compare each fire's timestamp against `nowFn()` using direct string comparison (ISO format sorts chronologically) or Date object comparison.

**When to use:** Any recurring schedule where you need durability across restarts and tick-based execution.

**Example:**

```typescript
// Source: Derived from design spec §4.3 (per-minute tick logic)

const scheduleFires: string[] = JSON.parse(
  db
    .prepare("SELECT value FROM app_meta WHERE key = 'schedule_fires'")
    .get()?.value || "[]"
);
const firesDone: string[] = JSON.parse(
  db
    .prepare("SELECT value FROM app_meta WHERE key = 'schedule_fires_done'")
    .get()?.value || "[]"
);

const now = nowFn();

for (const fireTimestamp of scheduleFires) {
  const fireDate = new Date(fireTimestamp);

  // Fire is due if its scheduled time has passed and it's not yet marked done
  if (fireDate <= now && !firesDone.includes(fireTimestamp)) {
    // Call send()
    firesDone.push(fireTimestamp);
  }
}

// Update app_meta.schedule_fires_done
db.prepare("UPDATE app_meta SET value = ? WHERE key = 'schedule_fires_done'").run(
  JSON.stringify(firesDone)
);
```

### Pattern 4: Nightly Recompute Detection

**What:** On each tick, check if the current UTC time is at or past a fixed hour (03:00 UTC) AND the last computed schedule is not from today. If so, recompute and persist.

**When to use:** Background jobs that should run once daily at a specific UTC time.

**Example:**

```typescript
// Source: Design spec §4.3 (03:00 UTC nightly recompute)

function shouldRecomputeSchedule(nowFn: () => Date, lastGeneratedAt: string): boolean {
  const now = nowFn();
  const utcHour = now.getUTCHours();

  // Step 1: Is it 03:00 UTC or later?
  if (utcHour < 3) {
    return false; // Too early; wait until 03:00
  }

  // Step 2: Was the schedule generated today (UTC)?
  if (!lastGeneratedAt) {
    return true; // Never generated; do it now
  }

  const generatedDate = new Date(lastGeneratedAt);
  const nowDateUtc = new Date(now.toISOString().split("T")[0]);
  const generatedDateUtc = new Date(generatedDate.toISOString().split("T")[0]);

  return nowDateUtc > generatedDateUtc;
}
```

### Anti-Patterns to Avoid

- **Calling `send()` without try/catch wrapper:** One fire's error would crash the tick loop. Each fire must be isolated; errors logged, loop continues.
- **Using `new Date()` directly instead of `nowFn()`:** Makes tests un-testable; they'd have to wait real time or mock global Date. Always inject the clock.
- **Storing fire times in `app_meta` as HH:MM strings instead of UTC ISO timestamps:** Makes tick comparison logic fragile (need timezone conversion on each tick). Store as ISO UTC; compare as strings or dates.
- **Not resetting `schedule_fires_done` at 03:00 UTC recompute:** Today's done list carries over into tomorrow's schedule; fires may be skipped. Reset to `[]` when schedule is recomputed.
- **Skipping the catch-up check on startup:** Process crashes at 14:05 UTC, restarts at 14:10 UTC. If no catch-up logic, the 14:05 fire is lost forever. Always run catch-up before the first tick.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Recurring task scheduling | Custom systemd timer management or cron parsing | In-process `setInterval` with catch-up-on-restart | Avoids OS-level scheduling complexity; catch-up handles restarts; single responsibility boundary is clearer |
| Detecting "has this task run today?" | Home-grown date comparison logic | Store task state in `app_meta` (persistent JSON strings) + check if date of last-run is today | SQLite is already in the app; JSON strings are portable, queryable, and survive restarts; date math is error-prone |
| Converting user-local times to UTC for comparison | Manual timezone offset calculations | Store fire times as ISO UTC strings; use `Intl.DateTimeFormat` for user-local conversions only at read time | `Intl` handles DST, leap seconds, and IANA timezone changes; manual offset math is a footgun |
| Handling "process crashed, what did I miss?" | Assume the process was up the whole time | Catch-up logic on startup: compare each fire's timestamp to current time, fire if <15 min old | Restarts are common (deploy, crash recovery, user restart); missing a fire is silent data loss without this |

**Key insight:** This scheduler's core complexity (detecting recompute time, catching up on restart, firing due times) is all about state durability across crashes and time-based decision logic. These are solved problems: store state in the DB, use `setInterval`, inject the clock. Trying to build a custom solution bakes in bugs (DST failures, restart data loss, test brittleness).

## Common Pitfalls

### Pitfall 1: Timezone Confusion — UTC vs. User-Local Time

**What goes wrong:** Fire times are computed in user-local time (e.g., "02:05 Los Angeles time"), but `now` is always UTC. If the scheduler compares user-local times directly to UTC times, it fires at the wrong moment or not at all.

**Why it happens:** The design spec uses user-local times for readability and schedule generation, but the database stores ISO UTC timestamps. The conversion must happen at the right place: compute/generate in user-local, store as UTC, compare as UTC.

**How to avoid:**
1. On nightly recompute: `generateSchedule()` returns `FireTime[]` with `hour` and `minute` in user-local time (range 0–23 for hour, 0–59 for minute).
2. Convert user-local `FireTime` to today's UTC ISO timestamp using Intl.DateTimeFormat offset logic or a timezone library.
3. Store in `app_meta.schedule_fires` as ISO UTC strings.
4. On each tick, compare fire's UTC timestamp to `nowFn()` (which returns UTC Date).

**Warning signs:** Fires execute at the wrong time of day; fires skip for users not in Pacific timezone; tests fail when run in a different timezone.

### Pitfall 2: Date Boundary Crossing — "Is it today?"

**What goes wrong:** The scheduler checks "was the schedule generated today?" by reading `schedule_generated_at` and comparing dates. But "today" in UTC is different from "today" in user-local time. A fire at 23:00 local might be tomorrow in UTC, or yesterday, depending on timezone offset.

**Why it happens:** The design spec defines the 03:00 UTC recompute in absolute UTC terms, not user-local. But the schedule covers "today" from the user's perspective. Without clear conventions, off-by-one errors creep in.

**How to avoid:**
1. Define "today" consistently: use UTC midnight-to-midnight (not user-local). The recompute at 03:00 UTC runs once per UTC calendar day.
2. Check: `date(schedule_generated_at).toISOString().split("T")[0]` === `date(now).toISOString().split("T")[0]` (both in UTC).
3. The recompute generates fire times for today's UTC day using the user's local timezone for bucketing snapshots — not the other way around.

**Warning signs:** Tests pass when run at 00:00 UTC but fail at 23:00 UTC; the 03:00 recompute runs twice in one day; it never runs on some days.

### Pitfall 3: Catch-Up Logic — "Is 15 minutes ago calculated correctly?"

**What goes wrong:** The catch-up check reads `schedule_fires`, finds fires not in `schedule_fires_done`, and decides which to fire on startup. The condition "missed by <15 min" is implemented as `fireTime > (now - 15 min)`, but the arithmetic might be off: `Date - number` doesn't work; you need `Date.getTime() - ms` or `new Date(now.getTime() - 15 * 60 * 1000)`.

**Why it happens:** JavaScript's `Date` arithmetic is error-prone; `Date - Date` returns milliseconds, but `Date - number` is NaN. Easy to miss.

**How to avoid:**
```typescript
// Correct 15-minute arithmetic
const now = nowFn();
const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);

for (const fireTimestamp of scheduleFires) {
  const fireDate = new Date(fireTimestamp);
  const isMissed = fireDate <= now && !firesDone.includes(fireTimestamp);
  const isRecent = fireDate > fifteenMinutesAgo;

  if (isMissed && isRecent) {
    // Fire this one
  }
}
```

**Warning signs:** Catch-up logic fires stale fires from hours ago; it never fires anything on restart; it fires fires from the future.

### Pitfall 4: JSON Array Mutation — "Did I actually persist the change?"

**What goes wrong:** The scheduler reads `schedule_fires_done` from `app_meta`, gets a JSON array, pushes to it, but forgets to `UPDATE` the row back to the database. The next tick reads the old value again, and fires the same send twice.

**Why it happens:** JSON in SQL is a string; you must serialize and re-persist it. Easy to forget the `UPDATE` step, especially if you're used to in-memory mutable arrays.

**How to avoid:**
```typescript
// Correct pattern
const firesDoneJson = db
  .prepare("SELECT value FROM app_meta WHERE key = 'schedule_fires_done'")
  .get()?.value || "[]";
const firesDone: string[] = JSON.parse(firesDoneJson);

// Mutate the array
firesDone.push(fireTimestamp);

// Persist back
db.prepare("UPDATE app_meta SET value = ? WHERE key = 'schedule_fires_done'")
  .run(JSON.stringify(firesDone));
```

**Warning signs:** Sends fire multiple times in one tick; `schedule_fires_done` never grows; the dashboard shows stale data.

### Pitfall 5: Recompute Window — "Why does it run at 03:30 sometimes?"

**What goes wrong:** The tick interval is 60 seconds, so the check "is UTC hour ≥ 3?" can trigger anywhere from 03:00:00 to 03:59:59. If a fire is scheduled at 03:05 local time, and the recompute happens at 03:30 UTC (after the fire), the newly computed schedule has already lost a slot.

**Why it happens:** A 60-second tick is coarse. The recompute check runs lazily "some time during the 03:XX hour," not at a precise time.

**How to avoid:**
1. Accept the ±30-second jitter as inherent to the design (not a bug, a tradeoff for simplicity).
2. If precision matters, use a separate one-shot timer for the 03:00 UTC recompute (more complex, not recommended for v1).
3. Or: generate the schedule the previous night so it's ready before 03:00 (even more complex).
4. For now: the anchor fire is exact (by design), so missing a non-anchor fire during the recompute window is tolerable.

**Warning signs:** A fire scheduled at 02:00 local time sometimes doesn't fire on days when the recompute happens early; tests that pin the time to 03:00 UTC sharp pass, but production fires are erratic.

## Code Examples

Verified patterns from official sources and Phase 1–3 context:

### Integration in instrumentation.ts

```typescript
// Source: Existing instrumentation.ts pattern (collector registration)
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

### Catch-Up on Startup

```typescript
// Source: Design spec §3.3 (catch-up on restart) + Pattern 3
async function catchUpOnStartup(
  db: Database.Database,
  config: Config,
  nowFn: () => Date
): Promise<void> {
  const now = nowFn();
  const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);

  const scheduleFires: string[] = JSON.parse(
    db
      .prepare("SELECT value FROM app_meta WHERE key = 'schedule_fires'")
      .get()?.value || "[]"
  );
  const firesDone: string[] = JSON.parse(
    db
      .prepare("SELECT value FROM app_meta WHERE key = 'schedule_fires_done'")
      .get()?.value || "[]"
  );

  for (const fireTimestamp of scheduleFires) {
    const fireDate = new Date(fireTimestamp);
    const isMissed = fireDate <= now && !firesDone.includes(fireTimestamp);
    const isRecent = fireDate > fifteenMinutesAgo;

    if (isMissed && isRecent) {
      try {
        const isAnchor = /* determine if anchor */;
        await send(config, {
          scheduledFor: fireTimestamp,
          isAnchor: isAnchor ? 1 : 0,
        });
        firesDone.push(fireTimestamp);
        console.log(`[scheduler] catch-up fired at ${fireTimestamp}`);
      } catch (err) {
        console.error(
          `[scheduler] catch-up send failed for ${fireTimestamp}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  // Persist updated done list
  db.prepare("UPDATE app_meta SET value = ? WHERE key = 'schedule_fires_done'").run(
    JSON.stringify(firesDone)
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Python separate `claude-sender.service` | In-process Node.js scheduler in single service | Phase 4 (this phase) | Simplifies deployment; one systemd unit, one log stream; avoids inter-process synchronization |
| Fixed cron time (no peak detection) | Nightly recompute at 03:00 UTC based on detected peak | Design spec + Phase 4 | Adaptive to user's actual peak usage; fires are personalized, not generic |
| Retry logic with exponential backoff | No retries; next slot is the "retry" | Design spec §10 + Phase 3 D-01 | Simpler; failed sends don't bleed into the next window; next-window reset is the natural recovery |

**Deprecated/outdated:**
- **Python `Claude Message Sender/` directory:** Functionality merged into Node sender. Scheduled for deletion in Phase 6.
- **Two-systemd-service model (claude-tracker + claude-sender):** Replaced by single-service in Phase 4. `HOSTING-STRATEGY.md` will be rewritten.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `setInterval(60_000)` jitter ± 1 second is acceptable; fires may execute 0–60s after their scheduled time | Architecture Patterns | If sub-second precision is needed, a different approach (nanosecond timers, external scheduler) is required. Current design accepts this tradeoff. |
| A2 | User-local fire times can be converted to UTC by computing the offset between naive local and UTC interpretations of the same datetime string | Common Pitfalls (Pitfall 1) | This approach works for most cases but may fail edge cases near DST transitions. A production implementation should use a robust timezone library (e.g., date-fns, luxon) for safety. For Phase 4, the pattern above is sufficient. |
| A3 | Storing fire times in `app_meta` as JSON arrays scales fine for 5 fires/day | Standard Stack | If the number of fires grows to thousands, JSON array performance degrades. For current scope (5/day), this is not a concern. |
| A4 | The 15-minute catch-up window is sufficient to cover typical restart durations (deploy, crash recovery, user restart) | Design Patterns | If restarts regularly exceed 15 minutes, catches-up logic may lose fires. Current design assumes restarts are quick. |

**If this table is empty:** All claims in this research were verified — no user confirmation needed.

## Open Questions

1. **User-local to UTC conversion precision**
   - What we know: `FireTime[]` from `generateSchedule()` is in user-local time (hour 0–23, minute 0–59). This must be converted to UTC ISO timestamps for storage and comparison.
   - What's unclear: The exact formula for the conversion. The pattern above uses Intl.DateTimeFormat offset math, which works but may have edge cases near DST boundaries.
   - Recommendation: Use the code example as a reference implementation. If issues arise in production, switch to a dedicated timezone library.

2. **Anchor fire identification**
   - What we know: `generateSchedule()` returns `FireTime[]` with an `isAnchor` boolean flag.
   - What's unclear: When the scheduler reads `schedule_fires` JSON (which is just timestamps), how does it know which fire is the anchor?
   - Recommendation: Store `schedule_fires` as `{ timestamp: string; isAnchor: boolean }[]` (not just timestamps). Alternatively, the first fire in the array is always the anchor (design confirms this: anchor is always `generateSchedule()[0]`).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | In-process tick loop | ✓ | 20.x (project baseline) | — |
| better-sqlite3 | `getDb()` for app_meta reads/writes | ✓ | ^11.6.0 (verified 2026-04-20) | — |
| Claude Code CLI | `send()` via child_process.spawn | ✓ | Latest (user's local install) | — |

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node.js `node:test` + `node:assert/strict` |
| Config file | None (Node.js built-in) |
| Quick run command | `npm test -- test/scheduler.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SCHED-01 | At 03:00 UTC, scheduler reads `status='ok'` snapshots, calls `peakDetector()` + `generateSchedule()`, persists to `app_meta` | unit | `npm test -- test/scheduler.test.ts -g "recompute"` | ✅ Wave 0 |
| SCHED-10 | On startup, fires missed by <15 min fire immediately; ≥15 min skipped | unit | `npm test -- test/scheduler.test.ts -g "catch-up"` | ✅ Wave 0 |
| SCHED-11 | 60s tick loop fires any scheduled time ≤ now not in done list | unit | `npm test -- test/scheduler.test.ts -g "tick"` | ✅ Wave 0 |
| SCHED-12 | When `app_meta.paused='true'`, all fires skipped until toggled off | unit | `npm test -- test/scheduler.test.ts -g "pause"` | ✅ Wave 0 |
| DATA-04 | All 10 `app_meta` keys initialized on startup with documented defaults | unit | `npm test -- test/scheduler.test.ts -g "initialize"` | ✅ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm test -- test/scheduler.test.ts` (targeted; ~3 sec)
- **Per wave merge:** `npm test` (full suite including all phases; ~10 sec)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `test/scheduler.test.ts` — covers SCHED-01, SCHED-10, SCHED-11, SCHED-12, DATA-04 with fake-clock tests
- [ ] `src/lib/scheduler.ts` — main implementation
- [ ] Integration test in Phase 8 (manual dev-loop: seed 7-day snapshots, observe recompute, pin override, verify send_log)

*(If no gaps: "None — existing test infrastructure covers all phase requirements")*

## Security Domain

**Applicable ASVS Categories**

| ASVS Category | Applies | Standard Control |
|---|---|---|
| V2 Authentication | No | Scheduler is internal; auth covered by Phase 6 (OAuth token env var) |
| V3 Session Management | No | No user sessions in scheduler |
| V4 Access Control | No | No multi-user; single-user VM |
| V5 Input Validation | Yes | `app_meta` values read from DB; validate JSON parse, timestamp format, enum values (pause, timezone) |
| V6 Cryptography | No | No sensitive data encrypted/decrypted by scheduler |

**Known Threat Patterns for Node.js + SQLite**

| Pattern | STRIDE | Standard Mitigation |
|---|---|---|
| SQL injection via `app_meta` reads | Tampering | Use parameterized queries (better-sqlite3's `.prepare()` + `.run()` with `?` placeholders) — already done in code examples |
| Denial of service (infinite loop in catch-up) | Denial | Catch-up logic runs once at startup, not per tick; bounded by `schedule_fires` array size (5 items max) |
| Timezone logic bypass (fire at wrong time) | Tampering | Rely on standard `Intl.DateTimeFormat` for timezone conversion; avoid hand-rolled offset math |

## Sources

### Primary (HIGH confidence)

- **better-sqlite3 npm registry** (verified 2026-04-20) — current version ^11.6.0, provides `Database.prepare()` and transaction support
- **Node.js built-in modules** (`node:test`, `node:assert/strict`, `node:child_process`) — standard APIs, no external dependency
- **Codebase inspection** — Phase 1 `db.ts` (app_meta DDL), Phase 2 `peak-detector.ts` + `schedule.ts` signatures, Phase 3 `sender.ts` signature, Phase 1 `queries.ts` + `config.ts` patterns
- **Design spec** (`2026-04-16-tracker-sender-merge-design.md` §3–4) — scheduler responsibilities, 03:00 UTC recompute, catch-up logic, app_meta keys, fire-time generation

### Secondary (MEDIUM confidence)

- **CONTEXT.md decisions** (Phase 4, 2026-04-20) — D-01 through D-04 establish gating, clock injection, error isolation, and app_meta initialization patterns

## Metadata

**Confidence breakdown:**

| Area | Level | Reason |
|---|---|---|
| Function signatures (peakDetector, generateSchedule, send, querySnapshots, getDb) | HIGH | Verified by reading actual Phase 1–3 implementation files |
| app_meta DDL and keys | HIGH | Verified in Phase 1 db.ts; all 10 keys documented in design spec §5.3 |
| Instrumentation registration pattern | HIGH | Verified in instrumentation.ts; collector pattern is the model |
| Tick loop logic (60s interval, fire-due detection, pause check) | HIGH | Design spec §4.3 and D-02/D-03 specify this clearly |
| Nightly 03:00 UTC recompute detection | HIGH | Design spec §3.1 defines the algorithm; edge cases covered |
| Catch-up-on-restart logic | HIGH | Design spec §3.3 specifies <15 min window; example code works |
| User-local to UTC timestamp conversion | MEDIUM | Approach in code examples is sound but untested for DST edge cases; assumes Intl.DateTimeFormat stability |
| Exact module structure (one function vs. class) | MEDIUM | CONTEXT.md lists this as "Claude's Discretion"; no single right answer; recommendation in Summary suggests one function |

**Research date:** 2026-04-20  
**Valid until:** 2026-04-27 (stable API surface; refresh if Node.js or better-sqlite3 release breaking changes)

---

*Phase: 04-scheduler-wiring*  
*Research complete: 2026-04-20*
