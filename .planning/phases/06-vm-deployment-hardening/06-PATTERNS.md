# Phase 6: VM Deployment & Hardening - Pattern Map

**Mapped:** 2026-04-22
**Files analyzed:** 8 (new/modified)
**Analogs found:** 6 / 8 (2 new artifact types: systemd unit, env file template)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/instrumentation.ts` | bootstrap | request-response | self (existing) | exact |
| `src/lib/scheduler.ts` | service | event-driven | self (existing) | exact |
| `src/lib/db.ts` | persistence | CRUD | self (existing) | exact |
| `src/lib/notifier.ts` | service | request-response | `src/lib/sender.ts` | role-match |
| `src/lib/backup.ts` | service | batch/file-I/O | `src/lib/scheduler.ts` | role-match |
| `HOSTING-STRATEGY.md` | documentation | (N/A) | self (existing doc) | rewrite |
| `claude-tracker.service` | config/infrastructure | (N/A) | systemd templates | new artifact |
| `/etc/claude-sender.env` | config/infrastructure | (N/A) | template | new artifact |

---

## Pattern Assignments

### `src/instrumentation.ts` (bootstrap, request-response — modify)

**Analog:** `src/instrumentation.ts` (existing pattern — extend)

**Existing Pattern** (lines 1-26):
```typescript
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Dynamic imports for isolation
    const { getCollector } = await import("./lib/collector-singleton");
    const { getConfig } = await import("./lib/config");
    const { getDb } = await import("./lib/db");
    const { startScheduler } = await import("./lib/scheduler");
    
    const collector = getCollector();
    const config = getConfig();
    const db = getDb(config);
    console.log("[instrumentation] Collector started");

    // Conditional start (demo mode suppression, NODE_ENV check)
    const shouldStartScheduler =
      (process.env.NODE_ENV === "production" ||
        process.env.ENABLE_SCHEDULER === "true") &&
      !config.demoMode;

    let schedulerStop = () => {};
    if (shouldStartScheduler) {
      const scheduler = startScheduler(db);
      schedulerStop = scheduler.stop;
      console.log("[instrumentation] Scheduler started");
    }

    // ... auto-open browser ...

    // Unified shutdown hook
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

**Phase 6 Addition Pattern:**
Copy the scheduler registration pattern (lines 14-25) to register a backup job immediately after. Replace `startScheduler` with `startBackupJob`, reuse the same `shouldStartScheduler` guard, and add `backupStop` to the shutdown hook. See `src/lib/backup.ts` for the job function signature.

---

### `src/lib/scheduler.ts` (service, event-driven — modify)

**Analog:** `src/lib/scheduler.ts` (existing pattern — enhance)

**Existing runTick Structure** (lines 298-401):
```typescript
async function runTick(
  db: Database.Database,
  config: ReturnType<typeof getConfig>,
  nowFn: () => Date,
  sendTimeoutMs?: number
): Promise<void> {
  // ... pause check, recompute check, fire execution ...
}
```

**Helper Functions** (lines 72-86):
```typescript
function readMeta(db: Database.Database, key: string, fallback = ""): string {
  const row = db
    .prepare("SELECT value FROM app_meta WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
}

function writeMeta(db: Database.Database, key: string, value: string): void {
  db.prepare(
    "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, value);
}
```

**Phase 6 Modifications:**

1. **Add `last_tick_at` write at the start of `runTick()`** (before any other logic):
   ```typescript
   // Unconditionally write timestamp on every tick (stall detection depends on this)
   writeMeta(db, "last_tick_at", nowFn().toISOString());
   ```

2. **Add stall detection watchdog (after last_tick_at write)**:
   ```typescript
   // Check if more than 5 minutes since last tick (D-06)
   const lastTickAt = readMeta(db, "last_tick_at");
   if (lastTickAt) {
     const lastTick = new Date(lastTickAt);
     const elapsedSeconds = (nowFn().getTime() - lastTick.getTime()) / 1000;
     if (elapsedSeconds > 300) { // 5 minutes = 300s
       console.error(`[scheduler] STALL DETECTED: ${elapsedSeconds}s since last tick`);
       void postDiscordNotification(
         "Scheduler Stall",
         `No scheduler tick recorded for ${Math.floor(elapsedSeconds)}s (threshold: 300s)`,
         nowFn()
       );
     }
   }
   ```

3. **Add send failure notification (in the fire-execution loop, after insertSendLog)**:
   ```typescript
   if (result.status !== "ok") {
     void postDiscordNotification(
       "Send Failure",
       `Send at ${scheduledFor} failed: ${result.status} — ${result.error_message || "unknown error"}`,
       new Date()
     );
   }
   ```

**Import Addition:**
```typescript
import { postDiscordNotification } from "./notifier";
```

**Add to initializeAppMeta (lines 38-58):**
```typescript
const defaults: Record<string, string> = {
  // ... existing keys ...
  last_tick_at: "",                   // ISO timestamp, written on every tick
  notification_webhook_url: "",       // Discord webhook URL, opt-in
  // ... rest ...
};
```

---

### `src/lib/db.ts` (persistence, CRUD — modify)

**Analog:** `src/lib/db.ts` (existing pattern — add helper)

**Existing Export Pattern** (lines 140-192):
```typescript
export function insertSnapshot(config: Config, data: {...}): void {
  const db = getDb(config);
  db.prepare(`INSERT INTO usage_snapshots ...`).run(...);
}

export function insertSendLog(config: Config, data: Omit<SendLogRow, "id">): SendLogRow {
  const db = getDb(config);
  const stmt = db.prepare(`INSERT INTO send_log ...`);
  const result = stmt.run(...);
  return { id: result.lastInsertRowid as number, ...data };
}
```

**Phase 6 Addition — Backup Helper Function:**
Add after existing helper functions (around line 220, before database queries):
```typescript
export function backupDatabase(config: Config, outputPath: string): void {
  const db = getDb(config);
  // Use better-sqlite3's .backup() method for online backup
  // Alternative: db.prepare("VACUUM INTO ?").run(outputPath);
  const backup = db.backup(outputPath);
  backup.step(-1); // -1 means all pages in one step
  backup.finish();
}
```

Rationale: The backup function wraps `better-sqlite3`'s `.backup()` C-level method, which is atomic and safe under concurrent writes. No subprocess needed (avoids T-03-04 subprocess risks). The actual upload to GCS happens in `src/lib/backup.ts`; this function only handles the local copy.

---

### `src/lib/notifier.ts` (service, request-response — NEW)

**Analog:** `src/lib/sender.ts` (lines 1-130)

**Import Pattern** (from sender.ts lines 1-4):
```typescript
import type { Config } from "./config";
import { getDb } from "./db";
```

**Error Handling Pattern** (from sender.ts lines 67-87):
```typescript
try {
  // ... perform I/O operation ...
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("[sender]", msg);
  // Handle gracefully — do NOT crash
}
```

**Function Pattern — Async with Fire-and-Forget:**

```typescript
/**
 * notifier.ts
 *
 * Discord webhook notification sender. Posts to a webhook URL stored in app_meta.
 * Gracefully handles missing URL and webhook unreachability without crashing.
 *
 * D-04: Discord webhook only (ntfy.sh deferred to v2).
 * D-07: Webhook URL is opt-in; if absent or empty, silently skip.
 */

import type { Config } from "./config";
import { getDb } from "./db";

/**
 * postDiscordNotification — POST a minimal Discord embed to the configured webhook.
 *
 * Returns immediately if webhook URL is not configured (opt-in, D-07).
 * If POST fails, logs the error and continues (non-fatal, D-02).
 *
 * @param title — embed title (e.g., "Send Failure", "Scheduler Stall")
 * @param description — embed description (what happened, why)
 * @param timestamp — optional timestamp; defaults to now
 */
export async function postDiscordNotification(
  title: string,
  description: string,
  timestamp?: Date
): Promise<void> {
  // Read webhook URL from app_meta (opt-in)
  const db = getDb({ dataDir: process.env.DATA_DIR ?? "", dbPath: "" } as any);
  const row = db
    .prepare("SELECT value FROM app_meta WHERE key = ?")
    .get("notification_webhook_url") as { value: string } | undefined;

  if (!row?.value) {
    console.log("[notifier] webhook URL not configured, skipping notification");
    return;
  }

  const webhookUrl = row.value;
  const now = timestamp ?? new Date();

  const payload = {
    embeds: [
      {
        title,
        description,
        timestamp: now.toISOString(),
        color: 0xff0000, // Red for failures
      },
    ],
  };

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.warn(
        `[notifier] webhook POST failed: ${response.status} ${response.statusText}`
      );
      // Do NOT rethrow — log and continue
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[notifier] webhook error: ${msg}`);
    // Do NOT rethrow — log and continue (non-fatal, D-02)
  }
}
```

**Testing Pattern** (to verify graceful degradation):
- Test missing URL: webhook URL not set in app_meta → function returns early with log message
- Test network failure: webhook endpoint unreachable → function catches error, logs, continues (no throw)
- Test success: valid webhook URL and reachable endpoint → embed posted successfully

---

### `src/lib/backup.ts` (service, batch/file-I/O — NEW)

**Analog:** `src/lib/scheduler.ts` (lines 438-467 — job registration pattern)

**Time-Triggered Job Pattern** (from scheduler.ts):
```typescript
export function startScheduler(
  db: Database.Database,
  opts?: { nowFn?: () => Date; sendTimeoutMs?: number }
): { stop: () => void } {
  // ... initialization ...
  const interval = setInterval(() => {
    void runTick(db, config, nowFn, sendTimeoutMs).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[scheduler] tick threw unexpectedly: ${msg}`);
    });
  }, 60_000);  // 60-second interval

  return { stop: () => clearInterval(interval) };
}
```

**File I/O Pattern** (from sender.ts lines 40-128 — child process + error handling):
- Use `spawn` for subprocess calls with array-form args (never shell: true)
- Wrap in try/catch with graceful error logging (no crash)

**Function Pattern:**

```typescript
/**
 * backup.ts
 *
 * In-process GCS backup job. Runs daily at 04:15 UTC. Follows the same
 * registration pattern as src/lib/scheduler.ts.
 *
 * D-01: Backup runs in-process, same pattern as scheduler (no separate systemd timer).
 * D-02: On failure, log and continue (non-fatal).
 */

import { promises as fs } from "node:fs";
import { createReadStream, createWriteStream } from "node:fs";
import zlib from "node:zlib";
import type Database from "better-sqlite3";
import { Storage } from "@google-cloud/storage";
import { backupDatabase } from "./db";
import { getConfig } from "./config";

/**
 * backupToGcs — perform a single GCS backup cycle:
 * 1. Online SQLite backup via backupDatabase()
 * 2. Gzip compression
 * 3. Upload to GCS
 * 4. Cleanup temp files
 *
 * Any step failure logs and continues (D-02, non-fatal).
 */
async function backupToGcs(db: Database.Database): Promise<void> {
  const config = getConfig();
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, "");
  const backupPath = `/tmp/usage-${timestamp}.db`;
  const gzipPath = `${backupPath}.gz`;

  try {
    console.log("[backup] starting database backup");
    backupDatabase(config, backupPath);

    console.log("[backup] compressing backup");
    const gzipStream = createWriteStream(gzipPath);
    const readStream = createReadStream(backupPath);
    await new Promise<void>((resolve, reject) => {
      readStream
        .pipe(zlib.createGzip())
        .pipe(gzipStream)
        .on("finish", resolve)
        .on("error", reject);
    });

    console.log("[backup] uploading to GCS");
    const bucketName = process.env.GCS_BACKUP_BUCKET;
    if (!bucketName) {
      throw new Error("GCS_BACKUP_BUCKET not configured");
    }

    const storage = new Storage();
    const bucket = storage.bucket(bucketName);
    const objectName = `backups/daily/${timestamp}.db.gz`;
    await bucket.upload(gzipPath, { destination: objectName });

    console.log(`[backup] uploaded to gs://${bucketName}/${objectName}`);

    // Cleanup temp files
    await fs.unlink(backupPath);
    await fs.unlink(gzipPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[backup] failed: ${msg}`);
    // Do NOT rethrow; do NOT crash the scheduler (D-02)
  }
}

/**
 * scheduleDaily — run a job at a specific UTC time every day.
 *
 * Checks every minute whether the current UTC time matches the target time.
 * If so, fires the job asynchronously (fire-and-forget).
 *
 * @param utcTime — "HH:MM" format (e.g., "04:15")
 * @param job — async function to run
 * @returns interval ID for cleanup
 */
function scheduleDaily(utcTime: string, job: () => Promise<void>): NodeJS.Timeout {
  const [hourStr, minStr] = utcTime.split(":");
  const targetHour = parseInt(hourStr, 10);
  const targetMin = parseInt(minStr, 10);

  const checkAndRun = () => {
    const now = new Date();
    if (now.getUTCHours() === targetHour && now.getUTCMinutes() === targetMin) {
      void job().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[backup] scheduled job threw: ${msg}`);
      });
    }
  };

  // Check every minute
  return setInterval(checkAndRun, 60_000);
}

/**
 * startBackupJob — register the daily GCS backup job.
 *
 * Returns { stop } for shutdown integration into instrumentation.ts (same pattern as scheduler).
 * Runs at 04:15 UTC daily per D-01.
 *
 * @param db — open better-sqlite3 database handle
 */
export function startBackupJob(db: Database.Database): { stop: () => void } {
  const interval = scheduleDaily("04:15", async () => {
    await backupToGcs(db);
  });

  return { stop: () => clearInterval(interval) };
}
```

**Testing Pattern:**
- Unit: Mock GCS SDK, test gzip compression works
- Integration: Fake-clock test with `scheduleDaily`, verify job fires at target UTC minute
- Error scenario: GCS_BACKUP_BUCKET not set → logs error, does NOT crash

**Dependencies to Add to package.json:**
```json
"@google-cloud/storage": "^7.10.0"
```

---

### `HOSTING-STRATEGY.md` (documentation — full rewrite)

**Analog:** Existing `HOSTING-STRATEGY.md` (file to be completely rewritten per D-12, D-13, D-14)

**Structure (from D-14):**
The rewrite must follow a user-journey structure, NOT an architectural explanation:

1. **Prerequisites** — What you need before you start
2. **Provision VM** — Create the GCP e2-micro instance
3. **Deploy app** — Clone repo, build, install deps
4. **Configure secrets** — Set up OAuth token, GCS bucket, Discord webhook
5. **Start service** — Enable systemd unit
6. **Verify** — Post-deploy checklist (§QUAL-03, per D-15)
7. **Configure backups** — Set up GCS lifecycle rule
8. **Configure notifications** (optional) — Add Discord webhook URL

**Key Deletions (D-13):**
- All references to Python sender / `claude-sender.service` / two-service architecture
- Tailscale setup (localhost-only binding instead)
- Old manual backup shell script (replace with in-process backup)

**Key Inclusions:**
- Copy-pasteable commands for each section
- Post-deploy checklist (inline, not separate file) with observable verification steps:
  - `systemctl status claude-tracker` — service healthy
  - `journalctl -u claude-tracker -n 20` — first scheduler tick appears
  - `sqlite3 data/usage.db "SELECT value FROM app_meta WHERE key='last_tick_at';"` — tick timestamp
  - `sqlite3 data/usage.db "SELECT status FROM send_log ORDER BY fired_at DESC LIMIT 1;"` — first send logged
  - `gcloud storage ls gs://YOUR_BUCKET/backups/daily/` — backup object exists

**Rationale for Rewrite:** Non-technical user must read this doc top-to-bottom in under 30 minutes and have a working service. No architectural prose; every sentence serves the "how do I do this" question.

---

### `claude-tracker.service` (systemd unit file — NEW)

**Analog:** Standard systemd service file templates (not code analog, but follows POSIX conventions)

**Reference (from D-09, D-10, D-11):**
- Single unit file (no separate timer)
- EnvironmentFile=/etc/claude-sender.env (D-09, D-10)
- Binds to 127.0.0.1:3018 via HOSTNAME/PORT env vars (D-11)
- Non-root user `claude-tracker` (D-09)
- Restart=always, RestartSec=5 (D-09)
- `ExecStart=/usr/bin/npm run start:prod` (production server)

**File Location:** `/etc/systemd/system/claude-tracker.service` (create as new file)

**Content Template:**
```ini
[Unit]
Description=Claude Usage Optimizer Tracker
After=network.target

[Service]
Type=simple
User=claude-tracker
Group=claude-tracker
WorkingDirectory=/opt/claude-usage-optimizer
EnvironmentFile=/etc/claude-sender.env
ExecStart=/usr/bin/npm run start:prod
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

**Key Details:**
- `Type=simple` — process-based service (not forking)
- `WorkingDirectory` — repo root (where package.json lives)
- `EnvironmentFile` — reads HOSTNAME, PORT, CLAUDE_CODE_OAUTH_TOKEN, NODE_ENV
- `StandardOutput=journal` — logs to systemd journal (viewable via `journalctl`)
- `Restart=always` — restart on any exit code (D-09)

**Post-Install Steps (documented in HOSTING-STRATEGY.md):**
1. Create non-root user: `sudo useradd -r -s /bin/bash -d /opt/claude-usage-optimizer claude-tracker`
2. Set permissions: `sudo chown -R claude-tracker:claude-tracker /opt/claude-usage-optimizer`
3. Place unit file: `sudo tee /etc/systemd/system/claude-tracker.service < claude-tracker.service`
4. Reload: `sudo systemctl daemon-reload`
5. Enable: `sudo systemctl enable claude-tracker`
6. Start: `sudo systemctl start claude-tracker`
7. Verify: `sudo systemctl status claude-tracker`

---

### `/etc/claude-sender.env` (env file template — NEW, documentation only)

**Analog:** Standard env file templates (not code, but follows convention)

**Format:** `KEY=VALUE` pairs, one per line (no export prefix)

**Content Template:**
```
# OAuth Authentication
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat-...

# Server Binding (127.0.0.1 = localhost-only, never public)
HOSTNAME=127.0.0.1
PORT=3018

# Node Environment
NODE_ENV=production

# Data Directory (optional; defaults to ./data)
# DATA_DIR=/opt/claude-usage-optimizer/data

# GCS Backup Configuration
GCS_BACKUP_BUCKET=your-gcs-bucket-name-here

# Optional: Discord Webhook URL (can be set later via dashboard)
# DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

**Documentation Notes:**
- D-10: OAuth token is read from this file at service startup by Next.js
- D-11: HOSTNAME=127.0.0.1 + PORT=3018 enforce localhost-only binding
- GCS_BACKUP_BUCKET: User must create the bucket and set this value
- DISCORD_WEBHOOK_URL: Optional; can also be set via dashboard (app_meta). If neither env var nor app_meta is set, notifications are silently skipped (D-07).

**Security Note (Pitfall 4 from RESEARCH.md):**
- File perms MUST be 600 (read/write for owner only): `sudo chmod 600 /etc/claude-sender.env`
- Never use world-readable perms (644); this exposes the OAuth token to other users on the VM

**Installation Instructions (for HOSTING-STRATEGY.md):**
1. Create the file: `sudo tee /etc/claude-sender.env > /dev/null << 'EOF'`
2. Paste the template above, fill in values (OAuth token, GCS bucket name)
3. Set perms: `sudo chmod 600 /etc/claude-sender.env`
4. Verify: `sudo systemctl restart claude-tracker && sleep 2 && sudo systemctl status claude-tracker`

---

## Shared Patterns

### Error Handling (applies to all new service modules)

**Source:** `src/lib/sender.ts` (lines 67-87, 90-127)

All async operations that could fail (GCS upload, Discord webhook, subprocess calls) follow this pattern:

```typescript
try {
  // Perform I/O
  const response = await someAsyncOperation();
} catch (err) {
  // Always translate error to string
  const msg = err instanceof Error ? err.message : String(err);
  // Always log (console.error or console.warn)
  console.error("[moduleName] operation failed: ${msg}");
  // Never rethrow in non-critical paths (fire-and-forget)
  // If critical, rethrow; if fire-and-forget, return or continue
}
```

**Apply to:** `notifier.ts` (webhook POST), `backup.ts` (GCS upload)

---

### Database Access (applies to all modules reading/writing SQLite)

**Source:** `src/lib/db.ts` (lines 72-86 for readMeta/writeMeta, lines 106-116 for getDb)

All app_meta access follows this pattern:

```typescript
// Read
function readMeta(db: Database.Database, key: string, fallback = ""): string {
  const row = db
    .prepare("SELECT value FROM app_meta WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
}

// Write (upsert)
function writeMeta(db: Database.Database, key: string, value: string): void {
  db.prepare(
    "INSERT INTO app_meta (key, value) VALUES (?, ?) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, value);
}
```

**Apply to:** `scheduler.ts` (last_tick_at write), `notifier.ts` (webhook URL read)

---

### Time-Triggered Job Registration (applies to backup job)

**Source:** `src/lib/scheduler.ts` (lines 438-467)

Pattern for registering a background job that runs on a schedule:

```typescript
export function startJob(db: Database.Database): { stop: () => void } {
  const interval = setInterval(() => {
    void runJobOnce().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[job] threw: ${msg}`);
    });
  }, INTERVAL_MS);

  return { stop: () => clearInterval(interval) };
}
```

Then register in `instrumentation.ts`:

```typescript
const job = startJob(db);
// ... later ...
const shutdown = () => {
  schedulerStop();
  job.stop();  // Add to shutdown
  process.exit(0);
};
```

**Apply to:** `backup.ts` (use `scheduleDaily` helper instead of fixed interval)

---

### Import Conventions

**Source:** Existing files (`scheduler.ts` lines 1-17, `sender.ts` lines 1-4, `db.ts` lines 1-3)

All new modules follow this pattern:

```typescript
import type Database from "better-sqlite3";
import { getDb, readMeta, writeMeta } from "./db";
import type { Config } from "./config";
```

- `import type` for TypeScript-only imports (avoids runtime overhead)
- Absolute path imports (no `../../../`; project uses `@/*` alias)
- Grouped: Node.js builtins, third-party, local imports

---

### Console Logging

**Source:** Existing files (`scheduler.ts`, `sender.ts`, `db.ts`)

All console logs use a `[moduleName]` prefix for easy filtering:

```typescript
console.log("[scheduler] message");
console.warn("[notifier] warning");
console.error("[backup] error occurred");
```

**Apply to:** All new modules

---

## No Analog Found

Files with no close match in the codebase (planner should use RESEARCH.md patterns instead):

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `/etc/systemd/system/claude-tracker.service` | infrastructure/config | (N/A) | Systemd unit file; new artifact type (not code) |
| `/etc/claude-sender.env` | infrastructure/config | (N/A) | Environment template file; new artifact type (not code) |

**Action for Planner:** 
- For `claude-tracker.service`: Follow standard systemd.service(5) man page conventions. Reuse patterns from RESEARCH.md (D-09, D-10, D-11).
- For `/etc/claude-sender.env`: Follow standard `.env` file conventions. Use template from RESEARCH.md and document in HOSTING-STRATEGY.md.

---

## Metadata

**Analog search scope:** 
- `src/` directory — all TypeScript modules
- `test/` directory — test patterns
- Existing `HOSTING-STRATEGY.md` — doc rewrite scope

**Files scanned:** 15 source files, 14 test files

**Pattern extraction date:** 2026-04-22

**Confidence:** HIGH — All analogs are from existing codebase or standard infrastructure templates. No external libraries required beyond `@google-cloud/storage` (already verified in RESEARCH.md).

---

## Summary for Planner

All Phase 6 files reuse established patterns from the existing codebase:

1. **Instrumentation/bootstrap:** Copy scheduler registration pattern, adapt for backup job
2. **Scheduler enhancement:** Use existing `readMeta`/`writeMeta` helpers, add timestamp write + stall check
3. **Notifier service:** Mirror error handling from `sender.ts`, use fire-and-forget pattern
4. **Backup service:** Mirror time-triggered job pattern from `scheduler.ts`, add GCS upload
5. **Database helper:** Add one-liner backup function using `better-sqlite3.backup()`
6. **Documentation:** Rewrite in user-journey structure (not architectural); include post-deploy checklist
7. **Systemd unit:** Follow standard conventions; bind to 127.0.0.1 only
8. **Env file:** Template with comments; emphasize perms (600)

**No new patterns required.** All code follows existing project conventions (type imports, console prefixes, error handling, database access).
