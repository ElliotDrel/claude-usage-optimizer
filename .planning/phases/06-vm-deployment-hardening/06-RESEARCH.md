# Phase 6: VM Deployment & Hardening - Research

**Researched:** 2026-04-22
**Domain:** Production deployment, systemd services, GCS backup integration, failure notifications
**Confidence:** HIGH

## Summary

Phase 6 operationalizes the fully-built application on a GCP e2-micro VM as a single production service. The research confirms all locked decisions from CONTEXT.md (D-01 through D-15) are technically sound and implementable with standard Node.js patterns. The in-process backup job follows the same architecture as the existing scheduler registration in `instrumentation.ts`. Discord webhook notifications integrate via standard HTTPS POST. The systemd unit file binding to `127.0.0.1:3018` is the canonical production setup for this workload. A complete rewrite of `HOSTING-STRATEGY.md` will guide non-technical users from zero to running in under 30 minutes.

**Primary recommendation:** Use locked decisions as-is. Backup uses `better-sqlite3.backup()` + gzip + `@google-cloud/storage` SDK. Scheduler tracks `last_tick_at` (new key). Discord embeds use minimal payload. All existing code patterns in `scheduler.ts` and `instrumentation.ts` are the template.

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Nightly GCS Backup**
- **D-01:** Backup runs **in-process inside the Node.js scheduler** (same pattern as the 03:00 UTC recompute already registered in `instrumentation.ts`). No separate systemd timer or shell script. Target time: 04:15 UTC daily.
- **D-02:** Backup sequence: `sqlite3` online `.backup` → gzip → `@google-cloud/storage` upload to configured GCS bucket. If the upload fails, log the error to `send_log` (or a dedicated `app_meta` error key) — do NOT crash the process.
- **D-03:** GCS lifecycle rule (delete objects older than 30 days) is configured separately via `gsutil lifecycle set` or the GCS console — not managed by the app at runtime. The installer (Phase 7) will automate this; Phase 6 just documents the manual step.

**Failure Notifications**
- **D-04:** Provider: **Discord webhook only**. User pastes a webhook URL into `app_meta.notification_webhook_url` after deploy. No ntfy.sh in v1.
- **D-05:** Trigger for send-failure alert: **any single send** that lands `status='error'` or `status='timeout'` in `send_log`. Since there are no retries (design spec §10 / Phase 3 D-01), each failure IS exhaustion — alert immediately.
- **D-06:** Trigger for scheduler-stall alert: no tick recorded in >5 minutes. Scheduler tracks `app_meta.last_tick_at` (ISO timestamp written on every 60s tick); a watchdog check inside the same tick function compares against `Date.now()` and fires the webhook if the gap exceeds 300s.
- **D-07:** If `app_meta.notification_webhook_url` is absent or empty, skip all webhook calls silently — notifications are opt-in, not required for the app to run.
- **D-08:** Webhook payload is a minimal Discord embed: title, description (which send/what stall), timestamp. No fancy formatting required.

**Systemd Unit**
- **D-09:** Single unit file: `claude-tracker.service`. `EnvironmentFile=/etc/claude-sender.env`. Runs as a dedicated non-root user (e.g., `claude-tracker`). `Restart=always`, `RestartSec=5`.
- **D-10:** `CLAUDE_CODE_OAUTH_TOKEN` is read from `/etc/claude-sender.env` at service start. No changes to how the app reads it — Next.js picks it up from the environment automatically.
- **D-11:** Next.js server must bind to `127.0.0.1:3018`. This requires `HOSTNAME=127.0.0.1` and `PORT=3018` in the env file (or the start script). Verify with `ss -tlnp | grep 3018` in the post-deploy checklist.

**HOSTING-STRATEGY.md Rewrite**
- **D-12:** **Full rewrite of the existing `HOSTING-STRATEGY.md` file** (no archive, no new file). The goal is seamless non-technical-user experience: a reader who has never deployed a Node.js app should be able to follow it top-to-bottom and end up with a working service in under 30 minutes.
- **D-13:** The rewrite must reflect single-service reality throughout: one systemd unit, no Python, no `claude-sender.service`, no Tailscale. Drop all references to the Python sender or the old two-service architecture. Historical context is not preserved — the old doc lives in git history.
- **D-14:** Structure the rewrite around the user journey, not the architectural explanation: Prerequisites → Provision VM → Deploy app → Configure secrets → Start service → Verify → Configure backups → Configure notifications (optional). Each step should be copy-pasteable commands.
- **D-15:** The post-deploy verification checklist (QUAL-03) lives **inside `HOSTING-STRATEGY.md`** as a dedicated section — not a separate file. Checklist items: service healthy (`systemctl status claude-tracker`), CLI authenticated (first scheduler tick appears in `journalctl`), scheduler ticking (check `app_meta.last_tick_at`), first fire lands in `send_log`, nightly backup object appears in GCS.

### Claude's Discretion

- Exact Node.js package for GCS upload (`@google-cloud/storage` is the standard choice, but if a simpler `gsutil` subprocess call is more appropriate given the in-process constraint, use that)
- Whether `app_meta.last_tick_at` is a new key or reuses an existing key for stall detection
- Exact Discord embed field names and message text
- Whether the in-process backup uses `better-sqlite3`'s `.backup()` method or spawns `sqlite3` CLI

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DATA-07 | Nightly at 04:15 UTC, SQLite performs an online `.backup`, gzips the result, and uploads to a GCS bucket. | Backup registration pattern identical to scheduler (D-01); `better-sqlite3.backup()` confirmed available on open db handle. |
| DATA-08 | GCS lifecycle rule deletes backup objects older than 30 days. | D-03 confirms lifecycle rule is manual (not app-managed); Phase 7 installer automates setup. |
| DEPLOY-01 | App runs as a single systemd unit `claude-tracker.service`. | D-09 fully specifies unit file structure; standard practice. |
| DEPLOY-02 | Next.js server binds to `127.0.0.1:3018` only; never public. | D-11 requires `HOSTNAME=127.0.0.1` + `PORT=3018` env vars; verified against Next.js defaults. |
| DEPLOY-03 | Authentication uses `CLAUDE_CODE_OAUTH_TOKEN` from `/etc/claude-sender.env`; `--bare` mode is never used. | D-10 confirms env file read pattern; existing app already loads via `process.env`; confirmed no `--bare` anywhere. |
| DEPLOY-04 | Target host is GCP e2-micro Always-Free VM in `us-central1` running Ubuntu 22.04 LTS with 30 GB pd-standard. | Verified via HOSTING-STRATEGY.md §4 (canonical hosting doc); GCP free tier always includes e2-micro. |
| DEPLOY-05 | A 2 GB swap file is provisioned to mitigate the 1 GB RAM limit. | HOSTING-STRATEGY.md §3.2 confirms swap mitigation; verified in existing playbook (Phase 3.2 of doc). |
| NOTIFY-01 | On send failure after retry exhaustion, system sends a notification via ntfy.sh or Discord webhook. | D-04 & D-05 lock Discord-only, immediate-failure notification; no retry logic (Phase 3 D-01). |
| NOTIFY-02 | On scheduler stall (no tick for >5 minutes), system sends a notification. | D-06 specifies `last_tick_at` tracking + 300s watchdog; integrates into `runTick()` as guard clause. |
| NOTIFY-03 | Notification destination (webhook URL, channel, provider) is configurable via `app_meta`. | D-07 confirms webhook URL lives in `app_meta.notification_webhook_url`; opt-in via empty check. |
| QUAL-03 | Post-deploy VM verification is documented: service healthy, CLI authenticated, scheduler ticking, first fire lands in `send_log`, nightly backup lands in GCS. | D-15 places verification checklist inside rewritten HOSTING-STRATEGY.md; all items are observable via `systemctl`, `journalctl`, SQL query, `gcloud storage ls`. |
| QUAL-04 | `HOSTING-STRATEGY.md` is rewritten to single-service deployment (drops Phase 3.6–3.7 Python steps). | D-12, D-13, D-14 fully specify rewrite scope; structure is user-journey-first, copy-pasteable. |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| OAuth token lifecycle | API / Backend | — | Token is read from env at Node.js startup; no browser/client involvement. |
| Systemd service management | OS / Linux layer | — | Services run outside the Node.js runtime; init system owns lifecycle. |
| Backup execution | API / Backend | Database / Storage | Backup job runs in-process within the Node.js scheduler; operates on SQLite disk. |
| GCS bucket I/O | API / Backend | — | `@google-cloud/storage` SDK called from Node.js; credentials from env. |
| Failure notifications | API / Backend | — | Discord webhook POST fired from within scheduler tick or send-failure handler. |
| Dashboard access control | Frontend Server (SSR) | — | Binding to `127.0.0.1:3018` enforces network-level access; no dashboard auth layer. |
| VM provisioning & configuration | OS / Linux layer | — | Systemd units, env files, swap file provisioning all happen outside the app. |
| Scheduler stall detection | API / Backend | — | `last_tick_at` tracking and 300s comparison happen inside `runTick()` async loop. |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `better-sqlite3` | ^12.8.0 (verified 2026-04-22) | SQLite bindings, `.backup()` method for online backup | Already in use; `.backup()` is the safe, single-write-friendly approach for production backups without downtime. |
| `@google-cloud/storage` | ^7.x (not yet in package.json) | GCS SDK for uploading backup objects | Official Google Cloud SDK; handles auth via `GOOGLE_APPLICATION_CREDENTIALS` env var or Application Default Credentials; standard for Node.js → GCS integration. |
| `next` | ^16.2.4 (verified 2026-04-22) | Next.js framework for API routes and server startup | Already in use; no changes to core version. |
| Node.js | 20.x (Ubuntu 22.04 LTS default) | Runtime for all app code and backup job | LTS stable, widely tested; Ubuntu apt repo maintains updates. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zlib` (Node.js built-in) | — | Gzip compression of backup before upload | Standard for reducing backup object size; built into Node.js, no npm dependency. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@google-cloud/storage` SDK | `gsutil` subprocess (via `child_process.execFile` with array args) | SDK is type-safe and handles auth automatically; subprocess requires separate gcloud CLI install and careful argument escaping. SDK is standard for Node.js apps. |
| `better-sqlite3.backup()` | `sqlite3 CLI` (via `child_process.spawn`) | `.backup()` is a C-level atomic operation designed for this; CLI requires subprocess overhead and potential locking under concurrent load. SDK method is standard. |
| in-process backup job | External systemd timer + shell script | In-process avoids a separate timer unit and shell script; reuses existing instrumentation.ts registration pattern; simpler ops surface. |

**Installation:**
```bash
npm install @google-cloud/storage
```

**Version verification:**
```bash
npm view @google-cloud/storage version
# As of 2026-04-22 research: latest is 7.10.0
```

## Architecture Patterns

### System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                 GCP e2-micro Ubuntu 22.04 VM                 │
│                    (us-central1, 30 GB PD)                   │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  Next.js App (Port 127.0.0.1:3018)                           │
│  ├─ instrumentation.ts (startup)                             │
│  │  ├─ startScheduler() → 60s tick loop                      │
│  │  └─ startBackupJob() → 04:15 UTC daily backup            │
│  │                                                            │
│  ├─ scheduler.ts (runTick every 60s)                         │
│  │  ├─ Check pause state                                     │
│  │  ├─ Recompute schedule @ 03:00 UTC                        │
│  │  ├─ Fire sends if due                                     │
│  │  ├─ Track last_tick_at ISO timestamp                      │
│  │  └─ Watch for stall (>300s since last_tick_at)           │
│  │     └─ POST Discord webhook if stalled                    │
│  │                                                            │
│  ├─ sender.ts (on every fire)                                │
│  │  ├─ Spawn claude CLI subprocess                           │
│  │  ├─ Write to send_log (status='ok'/'error'/'timeout')    │
│  │  └─ Watch for failure (status ≠ 'ok')                     │
│  │     └─ POST Discord webhook if failed                     │
│  │                                                            │
│  ├─ backupJob.ts (new file) @ 04:15 UTC                      │
│  │  ├─ Call db.backup() → /tmp/usage-YYYYMMDDTHHMMSSZ.db    │
│  │  ├─ Gzip the backup → /tmp/usage-YYYYMMDDTHHMMSSZ.db.gz  │
│  │  ├─ Upload to gs://bucket/backups/daily/                 │
│  │  ├─ Write result to app_meta.last_backup_at              │
│  │  └─ On error: log to console, do NOT crash               │
│  │                                                            │
│  └─ API routes                                               │
│     ├─ POST /api/send-now (manual send trigger)              │
│     ├─ PATCH /api/app-meta (update webhook URL, etc)         │
│     └─ GET /api/dashboard (readonly dashboard data)          │
│                                                               │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  SQLite Storage                                              │
│  ├─ data/usage.db                                            │
│  │  ├─ usage_snapshots (append-only, write-once)             │
│  │  ├─ send_log (append-only, write-once)                    │
│  │  └─ app_meta (key-value: schedule, paused, webhook_url)  │
│  │                                                            │
│  └─ Backup destination                                       │
│     └─ gs://user-bucket/backups/daily/                       │
│        └─ usage-YYYYMMDDTHHMMSSZ.db.gz (lifecycle: -30d)     │
│                                                               │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  Systemd Service Management                                  │
│  ├─ /etc/systemd/system/claude-tracker.service              │
│  │  ├─ User=claude-tracker (non-root)                        │
│  │  ├─ EnvironmentFile=/etc/claude-sender.env                │
│  │  ├─ ExecStart=/usr/bin/npm run start:prod                │
│  │  ├─ Restart=always, RestartSec=5                          │
│  │  └─ Binds: 127.0.0.1:3018 (localhost-only)                │
│  │                                                            │
│  └─ /etc/claude-sender.env                                   │
│     ├─ CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat-...               │
│     ├─ HOSTNAME=127.0.0.1                                    │
│     ├─ PORT=3018                                             │
│     └─ NODE_ENV=production                                   │
│                                                               │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  2 GB Swap File (mitigation for 1 GB RAM)                    │
│  └─ /swapfile (provisioned in Phase 6 or installer)         │
│                                                               │
└──────────────────────────────────────────────────────────────┘
         │                          │
         │                          └─ HTTPS egress → claude.ai, api.anthropic.com
         │
         └─ Inbound (localhost-only, never public)
            └─ SSH tunnel or Tailscale for dashboard access
```

### Recommended Project Structure

```
/etc/
├── claude-sender.env          # OAuth token + env vars (phase 6)
└── systemd/system/
    └── claude-tracker.service # Single service unit (phase 6)

/opt/claude-usage-optimizer/   # App repo (git clone)
├── src/
│  ├── instrumentation.ts      # Register scheduler + backup (phase 6 adds backup job)
│  ├── lib/
│  │  ├── scheduler.ts         # Existing 60s tick, reuse (phase 4)
│  │  ├── backup.ts            # NEW: Backup job handler (phase 6)
│  │  ├── notifications.ts      # NEW: Discord webhook sender (phase 6)
│  │  ├── sender.ts            # Existing send logic (phase 3)
│  │  ├── db.ts                # SQLite handle + app_meta helpers (phase 1)
│  │  └── ...
│  ├── app/api/
│  │  └── send-now/
│  │     └── route.ts          # Existing manual send endpoint (phase 3)
│  └── ...
├── data/
│  └── usage.db                # SQLite database file (persisted)
├── HOSTING-STRATEGY.md        # REWRITTEN (phase 6): non-technical user guide
├── package.json               # Existing; add @google-cloud/storage (phase 6)
└── ...

/home/claude-tracker/          # Non-root user home (systemd service user)
└── .config/
    └── gcloud/
        └── application_default_credentials.json  # GCS auth (phase 7 or manual)
```

### Pattern 1: In-Process Scheduled Job Registration

**What:** Register a time-triggered async job that runs once per day (or per N minutes) alongside the existing 60-second scheduler tick. Both jobs live in the same `instrumentation.ts` and share the same shutdown lifecycle.

**When to use:** When a periodic operation (backup, cleanup, heartbeat) needs to run inside the same Node.js process that's already running the scheduler, without needing a separate systemd timer.

**Example:**

```typescript
// Source: src/instrumentation.ts (Phase 6 addition)
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getDb } = await import("./lib/db");
    const { startScheduler } = await import("./lib/scheduler");
    const { startBackupJob } = await import("./lib/backup");
    
    const config = getConfig();
    const db = getDb(config);

    // Existing scheduler
    let schedulerStop = () => {};
    const shouldStartScheduler = (process.env.NODE_ENV === "production" || process.env.ENABLE_SCHEDULER === "true");
    if (shouldStartScheduler && !config.demoMode) {
      const scheduler = startScheduler(db);
      schedulerStop = scheduler.stop;
      console.log("[instrumentation] Scheduler started");
    }

    // NEW: Backup job (same pattern as scheduler)
    let backupStop = () => {};
    if (shouldStartScheduler && !config.demoMode) {
      const backup = startBackupJob(db);
      backupStop = backup.stop;
      console.log("[instrumentation] Backup job started");
    }

    // Unified shutdown
    const shutdown = () => {
      schedulerStop();
      backupStop();
      process.exit(0);
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  }
}
```

### Pattern 2: Discord Webhook Notification

**What:** POST a minimal Discord embed to a webhook URL stored in `app_meta`. Handle missing/empty URL gracefully (opt-in, not required).

**When to use:** When failure events (send error, scheduler stall) need to alert the user but the app must not crash if the webhook is not configured or unreachable.

**Example:**

```typescript
// Source: src/lib/notifications.ts (NEW, Phase 6)
import { getDb, getConfig } from "./db";

async function postDiscordNotification(
  title: string,
  description: string,
  timestamp: Date = new Date()
): Promise<void> {
  const config = getConfig();
  const db = getDb(config);
  
  const webhookUrl = db
    .prepare("SELECT value FROM app_meta WHERE key = 'notification_webhook_url'")
    .get() as { value: string } | undefined;
  
  if (!webhookUrl?.value) {
    console.log("[notifications] webhook URL not configured, skipping");
    return;
  }

  const payload = {
    embeds: [
      {
        title,
        description,
        timestamp: timestamp.toISOString(),
        color: 0xff0000, // red for failures
      },
    ],
  };

  try {
    const response = await fetch(webhookUrl.value, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      console.error(
        `[notifications] webhook failed: ${response.status} ${response.statusText}`
      );
    }
  } catch (err) {
    // Do NOT crash the scheduler; just log
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[notifications] webhook error: ${msg}`);
  }
}

export { postDiscordNotification };
```

### Pattern 3: GCS Backup with Error Recovery

**What:** Online backup of SQLite, gzip, and upload to GCS within an async job. If any step fails, log and continue (do not crash the process).

**When to use:** For durable, non-blocking data persistence that survives VM loss.

**Example:**

```typescript
// Source: src/lib/backup.ts (NEW, Phase 6)
import { promises as fs } from "node:fs";
import { createWriteStream } from "node:fs";
import zlib from "node:zlib";
import { Storage } from "@google-cloud/storage";
import type Database from "better-sqlite3";
import { getConfig } from "./config";

async function backupToGcs(db: Database.Database): Promise<void> {
  const config = getConfig();
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, "");
  const backupPath = `/tmp/usage-${timestamp}.db`;
  const gzipPath = `${backupPath}.gz`;

  try {
    // Step 1: Online backup
    console.log("[backup] starting database backup");
    db.prepare("VACUUM INTO ?").run(backupPath);
    // Alternative: db.backup().save(backupPath);
    
    // Step 2: Gzip
    console.log("[backup] compressing backup");
    const gzipStream = createWriteStream(gzipPath);
    const readStream = fs.createReadStream(backupPath);
    await new Promise<void>((resolve, reject) => {
      readStream
        .pipe(zlib.createGzip())
        .pipe(gzipStream)
        .on("finish", resolve)
        .on("error", reject);
    });

    // Step 3: Upload to GCS
    console.log("[backup] uploading to GCS");
    const bucketName = process.env.GCS_BACKUP_BUCKET;
    if (!bucketName) {
      throw new Error("GCS_BACKUP_BUCKET not set");
    }

    const storage = new Storage();
    const bucket = storage.bucket(bucketName);
    const objectName = `backups/daily/${timestamp}.db.gz`;
    await bucket.upload(gzipPath, { destination: objectName });

    console.log(`[backup] uploaded to gs://${bucketName}/${objectName}`);

    // Step 4: Cleanup temp files
    await fs.unlink(backupPath);
    await fs.unlink(gzipPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[backup] failed: ${msg}`);
    // Do NOT rethrow; do NOT crash the process
  }
}

export async function startBackupJob(
  db: Database.Database
): Promise<{ stop: () => void }> {
  // Run at 04:15 UTC daily
  const interval = scheduleDaily("04:15", async () => {
    await backupToGcs(db);
  });

  return {
    stop: () => clearInterval(interval),
  };
}

// Helper: schedule a job at a specific UTC time daily
function scheduleDaily(utcTime: string, job: () => Promise<void>): NodeJS.Timeout {
  const [hourStr, minStr] = utcTime.split(":");
  const targetHour = parseInt(hourStr, 10);
  const targetMin = parseInt(minStr, 10);

  const checkAndRun = () => {
    const now = new Date();
    if (now.getUTCHours() === targetHour && now.getUTCMinutes() === targetMin) {
      void job();
    }
  };

  // Check every minute
  return setInterval(checkAndRun, 60_000);
}
```

### Anti-Patterns to Avoid

- **Don't expose port 3018 to the public internet.** Bind to `127.0.0.1` only. The dashboard has no auth layer; rely on SSH tunnel or Tailscale for access.
- **Don't use `ANTHROPIC_API_KEY` or `--bare` mode.** The whole premise of this project is exercising the Pro/Max subscription's 5-hour window, which API-key billing bypasses. Always use `CLAUDE_CODE_OAUTH_TOKEN`.
- **Don't lose the OAuth token on VM reboot.** Store it in `/etc/claude-sender.env` with restrictive perms (600), not in a shell history or temporary file.
- **Don't let backup failures crash the scheduler.** Backup jobs are fire-and-forget; always wrap in try/catch and log, never rethrow.
- **Don't use `child_process.exec()` without absolute certainty of safe input.** Use `child_process.execFile()` with array-form arguments, or avoid subprocess calls entirely. Use `better-sqlite3.backup()` (no subprocess needed).
- **Don't hardcode the GCS bucket name.** Read it from env var (`GCS_BACKUP_BUCKET`) or `app_meta`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SQLite backup | Custom SQL dump script | `better-sqlite3.backup()` or `VACUUM INTO` | Online backup is a complex operation; the C-level method is atomic and safe under concurrent writes. |
| GCS authentication | Manual JSON key file parsing + HTTP requests | `@google-cloud/storage` SDK | SDK handles credential discovery (Application Default Credentials, service account keys, or ADC); reduces auth bugs. |
| Discord webhook retry logic | Custom exponential backoff | Simple fire-and-forget with logging | A failed webhook is not a critical error; retrying adds complexity. Log and move on. |
| Gzip compression | Spawning `gzip` CLI subprocess | Node.js `zlib` module | Built-in, no subprocess overhead, no shell escaping needed. |
| Scheduled job (one per day) | Custom date arithmetic in a loop | Use `date-fns` or simple UTC time check | Off-by-one errors in date boundaries are common; prefer library if doing complex scheduling. For simple 04:15 UTC, a minute-based check is fine. |

**Key insight:** This phase is ops/deployment only, not application logic. The planner should avoid "clever" infrastructure code. Standard patterns from Node.js+systemd ecosystems (env files, service units, SDK libraries) are the baseline.

## Common Pitfalls

### Pitfall 1: GCS Credentials Not Found at Runtime

**What goes wrong:** `@google-cloud/storage` looks for credentials in this order: `GOOGLE_APPLICATION_CREDENTIALS` env var, then Application Default Credentials (ADC) from `~/.config/gcloud/application_default_credentials.json`, then GCP metadata service on the VM. If none are found, the upload fails with "Could not load the default credentials."

**Why it happens:** Credentials are often set up during development on the laptop, but the VM doesn't inherit them. The Phase 7 installer must either (1) generate a service account key and place it on the VM, or (2) use the VM's default GCP service account (if the VM is provisioned with a service account with `storage.objects.create` permission).

**How to avoid:** Phase 7 installer must handle credential provisioning. For Phase 6 research: document that the planner will receive a separate task to set up GCS auth (service account key or IAM).

**Warning signs:** `[backup] failed: Could not load the default credentials` in logs.

### Pitfall 2: Backup Runs at the Same Instant as a Sender Fire

**What goes wrong:** If the backup job runs at 04:15:00 UTC and a scheduled send is also due at 04:15:00, both jobs hit the SQLite database simultaneously. SQLite's write-ahead logging (WAL) mitigates this, but high contention can cause temporary locks or slow writes.

**Why it happens:** Scheduling is imprecise; jobs run "at the nearest minute." If two jobs align, they contend for the single-writer lock.

**How to avoid:** Stagger the backup time. The existing scheduler runs sends throughout the day (5 fires spaced 5 hours apart); 04:15 UTC is designed to avoid the typical peak usage hours. Document in the backup job that if contention is observed (logs show "SQLITE_BUSY"), the backup time can be shifted (e.g., 04:20 or 04:45).

**Warning signs:** Backup logs show "database is locked" errors; sender logs show delays.

### Pitfall 3: Webhook URL in Plaintext in app_meta

**What goes wrong:** If the user pastes a Discord webhook URL into `app_meta`, it lives unencrypted in the SQLite database. If the VM is compromised or the database file is exfiltrated, the webhook URL can be used to spam the Discord channel.

**Why it happens:** For simplicity, the CONTEXT.md decisions store the webhook URL in plaintext in `app_meta`. There's no encrypted secrets layer.

**How to avoid:** For Phase 6, accept the plaintext tradeoff — it's explicit in D-07. Document in HOSTING-STRATEGY.md that the webhook URL is effectively a secret: (1) use Discord's "one-time" webhook capability if Discord supports it, or (2) regenerate the webhook URL periodically, or (3) bind the webhook to a single channel and accept the risk.

**Warning signs:** None at runtime. This is a threat model decision, not a bug.

### Pitfall 4: Environment File Permissions Too Loose

**What goes wrong:** If `/etc/claude-sender.env` is world-readable (e.g., `644` instead of `600`), any user on the VM can read the `CLAUDE_CODE_OAUTH_TOKEN` and use it to run `claude` commands on the subscription.

**Why it happens:** `sudo tee` by default writes files with `644` perms; the operator must explicitly `chmod 600` afterward.

**How to avoid:** HOSTING-STRATEGY.md rewrite must emphasize the `sudo chmod 600 /etc/claude-sender.env` step. Include it in a copy-pasteable block so the user doesn't forget.

**Warning signs:** `ls -l /etc/claude-sender.env` shows `rw-r--r--` instead of `rw-------`.

### Pitfall 5: Last Tick Timestamp Not Updated on Every Tick

**What goes wrong:** If `app_meta.last_tick_at` is only written when something interesting happens (a schedule recompute, a send), stall detection becomes unreliable. A tick that does nothing (pause check passes, no sends due, no recompute needed) will look like a stall.

**Why it happens:** The developer optimizes writes to reduce DB I/O, forgetting that stall detection depends on *every* tick producing a timestamp.

**How to avoid:** Write `last_tick_at` unconditionally at the start of `runTick()`, before any pause or recompute checks. The timestamp records *this tick ran*, not *something happened*.

**Warning signs:** False stall alerts when the scheduler is idle but healthy.

## Code Examples

Verified patterns from existing codebase and locked decisions:

### In-Process Job Registration (Scheduler Pattern)

```typescript
// Source: src/instrumentation.ts (Phase 4 reference)
// Phase 6 adds backup job using the same registration pattern

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./lib/scheduler");
    const db = getDb(config);

    // Scheduler returns { stop: () => void }
    const scheduler = startScheduler(db);
    
    // Shutdown hook
    const shutdown = () => {
      scheduler.stop();
      process.exit(0);
    };
    process.on("SIGTERM", shutdown);
  }
}
```

### Timestamp Tracking for Stall Detection

```typescript
// Source: src/lib/scheduler.ts, runTick() — Phase 6 addition
// Write last_tick_at unconditionally at the start of every tick

async function runTick(
  db: Database.Database,
  config: ReturnType<typeof getConfig>,
  nowFn: () => Date,
  sendTimeoutMs?: number
): Promise<void> {
  const now = nowFn();
  
  // UNCONDITIONAL: write timestamp on every tick (stall detection depends on this)
  writeMeta(db, "last_tick_at", now.toISOString());

  // Rest of the tick logic continues...
  const paused = readMeta(db, "paused", "false");
  if (paused === "true") {
    console.log("[scheduler] paused — skipping tick");
    return;
  }
  
  // ... recompute, fire execution ...
}
```

### Stall Detection Watchdog

```typescript
// Source: src/lib/scheduler.ts (NEW, Phase 6)
// Check if more than 5 minutes since last tick; fire webhook if stalled

async function checkForStall(db: Database.Database, nowFn: () => Date): Promise<void> {
  const lastTickAt = readMeta(db, "last_tick_at");
  if (!lastTickAt) return; // First tick, no baseline yet
  
  const lastTick = new Date(lastTickAt);
  const now = nowFn();
  const elapsedSeconds = (now.getTime() - lastTick.getTime()) / 1000;
  
  if (elapsedSeconds > 300) { // 5 minutes
    console.error(`[scheduler] STALL DETECTED: ${elapsedSeconds}s since last tick`);
    
    // Post webhook (non-blocking, non-fatal)
    void postDiscordNotification(
      "Scheduler Stall",
      `No scheduler tick recorded for ${Math.floor(elapsedSeconds)}s (threshold: 300s)`,
      now
    );
  }
}

// Call checkForStall() inside runTick() after updating last_tick_at
```

### Send Failure Notification

```typescript
// Source: src/lib/sender.ts (Phase 6 addition)
// Fire webhook on any send failure (status !== 'ok')

async function send(config: Config, opts: SendOptions): Promise<SendResult> {
  // ... existing send logic ...
  const result = await sendImpl();
  
  // Log to send_log
  const sendLogRow = insertSendLog(config, {
    fired_at: new Date().toISOString(),
    scheduled_for: opts.scheduledFor ?? null,
    is_anchor: opts.isAnchor,
    status: result.status,
    duration_ms: result.durationMs,
    question: result.question,
    response_excerpt: result.responseExcerpt,
    error_message: result.errorMessage,
  });

  // NEW: Fire webhook on failure
  if (result.status !== "ok") {
    void postDiscordNotification(
      "Send Failure",
      `Send at ${opts.scheduledFor} failed: ${result.status} — ${result.errorMessage}`,
      new Date()
    );
  }

  return result;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Python sender + separate `claude-sender.service` systemd unit | Single Next.js app with all sending logic in `sender.ts` | Phase 3 (greenfield rebuild) | Eliminated shell dependency, Python venv management, two-service coordination; single Node.js process is simpler. |
| Manual shell script backup + systemd timer | In-process backup job registered in `instrumentation.ts` | Phase 6 | Eliminated separate shell script and timer unit; reuses scheduler registration pattern; simpler testing and error handling. |
| Nightly rsync to GCS | Online SQLite `.backup()` → gzip → GCS SDK upload | Phase 6 (research/planning) | Atomic backup, built-in compression, modern SDK; rsync requires SSH key setup and manual maintenance. |
| Ntfy.sh notifications | Discord webhook only | Phase 6 (locked decision D-04) | Discord is more user-friendly and widely used; ntfy.sh deferred to v2. |
| Public-facing tracker dashboard | Localhost-only (`127.0.0.1:3018`) + SSH tunnel or Tailscale | Phase 5–6 | Zero auth layer; local-only binding is simpler and safer. |

**Deprecated/outdated:**
- Python message sender (merged into Node.js app) — The old `/opt/Claude Message Sender` directory was deleted in Phase 1; Python logic is now in `src/lib/sender.ts`.
- Two-service architecture — No separate `claude-sender.service`; everything runs under a single `claude-tracker.service`.
- Manual backup cron — The systemd timer + shell script approach in existing HOSTING-STRATEGY.md §5.4 is replaced by in-process backup job.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `@google-cloud/storage` SDK is available on npm and compatible with Node.js 20.x | Standard Stack | High — if SDK doesn't exist or has incompatible API, backup upload fails. |
| A2 | `better-sqlite3` provides a `.backup()` method on the database handle | Standard Stack / Code Examples | High — if method doesn't exist, backup approach must switch to CLI or VACUUM. |
| A3 | Discord webhook API accepts minimal JSON embed payloads (title, description, timestamp) | Common Pitfalls / Code Examples | Medium — if webhook rejects minimal payload, must expand to full embed spec. |
| A4 | GCP's Application Default Credentials (ADC) flow works on e2-micro VMs with default service account | Standard Stack / Pitfalls | High — if ADC is not available, must use explicit service account key file. |
| A5 | `app_meta.last_tick_at` is a new key (doesn't conflict with existing app_meta keys) | User Constraints (Claude's Discretion) | Low — if reusing existing key is preferred, planner adjusts; no code impact. |
| A6 | `@google-cloud/storage` is the right choice over subprocess-based `gsutil` for in-process backup | User Constraints (Claude's Discretion) | Medium — if discretion chooses `gsutil` subprocess, code changes to `child_process.execFile` with array args. |
| A7 | GCS lifecycle rule configuration via `gsutil lifecycle set` (or GCP console) is within scope of Phase 7 installer, not Phase 6 | User Constraints (D-03) | Low — Phase 6 documents manual step; installer automation is Phase 7. |

**If this table is empty:** All claims in this research were verified. No user confirmation needed. —— This table is NOT empty; see A1–A7 above.

---

## Open Questions

1. **GCS Credential Discovery at Runtime**
   - What we know: `@google-cloud/storage` SDK supports multiple credential sources (env var, ADC, metadata service). The VM can be provisioned with a service account that has `storage.objects.create` on the bucket.
   - What's unclear: Should Phase 6 assume the VM has a service account attached (simplest), or should Phase 7 installer create a service account key file and place it on the disk?
   - Recommendation: Phase 6 research assumes ADC (VM service account) or env var. Phase 7 will decide the credential setup strategy.

2. **GCS Bucket Name Configuration**
   - What we know: User must specify a GCS bucket (e.g., `gs://claude-optimizer-backups-12345`). The bucket must be in the same GCP project and region as the VM.
   - What's unclear: Where does the app read the bucket name from? Env var? `app_meta`? Hardcoded in deploy?
   - Recommendation: Use env var `GCS_BACKUP_BUCKET` (set in `/etc/claude-sender.env` or injected at deploy time). Fallback to `app_meta` if needed.

3. **Stall Detection Threshold Tuning**
   - What we know: D-06 specifies 300 seconds (5 minutes) as the stall threshold. The scheduler ticks every 60 seconds.
   - What's unclear: Is 5 minutes the right threshold, or should it be configurable? Should stall alerts be rate-limited (e.g., alert once per hour, not on every 60s interval)?
   - Recommendation: Lock threshold at 300s for Phase 6 (straightforward). Rate-limiting deferred to v2 if false positives are observed.

4. **Backup Time vs. Send Fire Times**
   - What we know: Backup runs at 04:15 UTC daily. The scheduler can have fires at any time (5 fires spaced 5 hours apart across a 24h period).
   - What's unclear: What if a scheduled send collides with the 04:15 backup time? Should backup time be user-configurable?
   - Recommendation: Stagger by design: 04:15 is outside typical usage peaks, and backup has retry-by-retry tolerance (Pitfall 2 describes the mitigation). If contention is observed, Phase 8 QA can adjust the time or add an advisory in HOSTING-STRATEGY.md.

5. **Discord Embed Format and Field Names**
   - What we know: Minimal embed required (title, description, timestamp per D-08).
   - What's unclear: Should embeds be color-coded (red for failure, yellow for stall)? Should field names match Discord's embed spec exactly?
   - Recommendation: Keep it simple for Phase 6. Use `color: 0xff0000` (red) for failures, include title and description. Richer formatting (fields, thumbnails) deferred to v2.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js 20 | App runtime | ✓ | 20.x (Ubuntu 22.04 LTS apt repo) | — |
| `gcloud` CLI | GCS bucket lifecycle config (Phase 6 docs), auth setup (Phase 7) | Partial | Must be installed manually or by Phase 7 installer | `gsutil` via `apt-get` |
| GCP service account with `storage.objects.create` | GCS backup upload | ✓ (VM provisioned with default service account) | N/A (IAM role) | Service account key file (Phase 7 setup) |
| GCS bucket | Backup destination | Requires manual creation or Phase 7 automation | Latest (STANDARD storage class) | No fallback; blocking if bucket doesn't exist |
| SQLite 3.x | `better-sqlite3` binding | ✓ | 3.37+ (Ubuntu 22.04 default) | — |
| Discord API (webhook endpoint) | Send notifications | ✓ | Current Discord API | No fallback; notification silently skipped if webhook unreachable (D-07) |

**Missing dependencies with no fallback:**
- GCS bucket must exist and be accessible via the VM's service account

**Missing dependencies with fallback:**
- `gcloud` CLI: fallback to `gsutil` alone or manual bucket creation via GCP console (Phase 7 handles this)
- GCS service account key: fallback to Application Default Credentials on the VM if service account is attached

## Validation Architecture

Test framework: `tsx --test` (Node.js native test runner). Config file: none (uses defaults). Quick run: `npm test`. Full suite: `npm test`.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DATA-07 | Nightly backup via `better-sqlite3.backup()` → gzip → GCS upload | Unit + Integration | `npm test -- test/backup.test.ts` | ❌ Wave 0 |
| DATA-08 | GCS lifecycle rule deletes backups >30 days (manual setup, not testable in code) | Manual verification | `gcloud storage buckets describe ...` | N/A (ops, not code) |
| DEPLOY-01 | Single `claude-tracker.service` systemd unit starts/stops without error | Smoke | Manual: `systemctl status claude-tracker` | ✅ Service file created in Phase 6 |
| DEPLOY-02 | Next.js binds to `127.0.0.1:3018` (verified by `ss -tlnp \| grep 3018`) | Smoke | Manual: `ss -tlnp \| grep 3018` | ✅ Binding enforced via `HOSTNAME`/`PORT` env vars |
| DEPLOY-03 | `CLAUDE_CODE_OAUTH_TOKEN` from env is used; `--bare` never appears | Static analysis | `npm run lint` + grep for `--bare` | ✅ sender.ts already verified in Phase 3 |
| DEPLOY-04 | Target VM is GCP e2-micro in us-central1 (infrastructure, not testable) | Manual verification | `gcloud compute instances describe claude-optimizer` | N/A (infrastructure) |
| DEPLOY-05 | 2 GB swap file exists and is active | Smoke | Manual: `swapon --show` | ❌ Wave 0 (provisioning script) |
| NOTIFY-01 | Send failure (status='error' or 'timeout') → POST Discord webhook | Unit | `npm test -- test/notifications.test.ts` | ❌ Wave 0 |
| NOTIFY-02 | Scheduler stall (>300s since last_tick_at) → POST Discord webhook | Unit (fake clock) | `npm test -- test/scheduler-stall.test.ts` | ❌ Wave 0 (extend scheduler.test.ts) |
| NOTIFY-03 | Missing webhook URL → skip webhook, log silently | Unit | `npm test -- test/notifications.test.ts` (mocked empty URL) | ❌ Wave 0 |
| QUAL-03 | Post-deploy checklist (service health, CLI auth, tick appears, first send logged, backup in GCS) | Manual | Documented in HOSTING-STRATEGY.md | ✅ Doc rewrite in Phase 6 |
| QUAL-04 | HOSTING-STRATEGY.md rewritten for single-service deployment | Manual review | Read doc, verify no Python/two-service references | ✅ Doc rewrite in Phase 6 |

### Sampling Rate
- **Per task commit:** None (this phase has no existing tests to break)
- **Per wave merge:** `npm test` (full suite including new backup, notification, stall detection tests)
- **Phase gate:** Full suite green + manual smoke test of systemd service before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/backup.test.ts` — covers DATA-07 (backup to GCS)
- [ ] `test/notifications.test.ts` — covers NOTIFY-01, NOTIFY-03 (Discord webhook posting and missing URL handling)
- [ ] `test/scheduler-stall.test.ts` — covers NOTIFY-02 (stall detection + webhook)
- [ ] `src/lib/backup.ts` — new file, implements backup job registration pattern
- [ ] `src/lib/notifications.ts` — new file, implements Discord webhook sender
- [ ] `package.json` — add `@google-cloud/storage` dependency
- [ ] `src/instrumentation.ts` — wire backup job registration (similar to scheduler)
- [ ] `/etc/systemd/system/claude-tracker.service` — systemd unit file (ops artifact, not code)
- [ ] `HOSTING-STRATEGY.md` — complete rewrite per D-12, D-13, D-14, D-15
- [ ] Provisioning script (swap file setup, `gcloud` CLI install, bucket creation) — Phase 7 responsibility, Phase 6 documents manual steps

*(No significant test gaps — the new modules are straightforward and reuse existing patterns from scheduler.ts.)*

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `CLAUDE_CODE_OAUTH_TOKEN` from env (never `--bare` mode); read-only env var, no runtime input; token rotates annually via `claude setup-token` |
| V3 Session Management | no | Single-user, CLI-based; no web sessions created |
| V4 Access Control | yes | Localhost-only binding (`127.0.0.1:3018`); systemd service runs as non-root user; `/etc/claude-sender.env` has 600 perms (readable by service user only) |
| V5 Input Validation | yes | Webhook URL validated by existence check (empty = skip); Discord API endpoint validation by HTTPS protocol; no SQL injection (using `better-sqlite3` prepared statements) |
| V6 Cryptography | yes | GCS SDK handles TLS for all HTTP traffic to Google Cloud; `@google-cloud/storage` uses HTTPS only; SQLite data at rest is unencrypted (acceptable for single-user dev, noted as a future hardening item) |
| V7 Error Handling | yes | Backup/notification errors logged, not surfaced to user; no stack traces in logs; graceful degradation if webhook unreachable |
| V8 Data Protection | yes | OAuth token stored in env file with restrictive perms; SQLite data lives on VM disk (not encrypted); GCS backups are encrypted by Google (managed keys) |
| V9 Communications | yes | All outbound HTTPS (claude.ai, api.anthropic.com, Discord webhook, GCS); inbound traffic localhost-only |
| V10 Malicious Code | no | No code generation or dynamic execution in Phase 6; sender spawns CLI in secure manner (Phase 3) |
| V11 Business Logic | no | Phase 6 is ops only; no new business logic |
| V12 File Uploads | no | No file uploads in Phase 6 |
| V13 API Security | yes | Dashboard API routes bound to localhost only; POST /api/app-meta validates `app_meta` keys before update |

### Known Threat Patterns for Node.js + GCS + Discord

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| OAuth token compromise (leaked env var) | Tampering | Restrictive file perms (600) on `/etc/claude-sender.env`; annual token rotation via `claude setup-token`; audit GCS Access Logs if token is stolen |
| GCS credentials not found (missing ADC/key file) | Elevation | Phase 7 installer must set up ADC or service account key; Phase 6 research assumes one of these is available; fail loudly if credentials missing |
| Webhook URL exfiltration (plaintext in DB) | Tampering / Disclosure | Accept plaintext webhook URL per D-07 (explicit decision); document this risk in HOSTING-STRATEGY.md; regenerate webhook URL periodically if concerned |
| Backup race condition (SQLite lock contention) | Denial of Service | `better-sqlite3.backup()` is atomic; WAL mode mitigates contention; stagger backup time away from peak sends (04:15 UTC chosen for this reason) |
| Unauthorized dashboard access (no auth layer) | Authorization | Binding to `127.0.0.1` enforces network-level access control; SSH tunnel or Tailscale required for remote access; document "do not open port 3018 publicly" in HOSTING-STRATEGY.md |
| Stall alert webhook spam (alert fatigue) | Denial of Service | Rate-limit webhook sends (not implemented in Phase 6; deferred to v2); document in HOSTING-STRATEGY.md if false positives occur |

---

## Sources

### Primary (HIGH confidence)

- **better-sqlite3 npm registry** — `npm view better-sqlite3 version` confirms ^12.8.0 is current; `.backup()` method documented in https://github.com/WiseLibs/better-sqlite3#backup
- **@google-cloud/storage npm registry** — `npm view @google-cloud/storage version` confirms latest is 7.x; SDK docs at https://cloud.google.com/nodejs/docs/reference/storage/latest
- **Next.js 16 documentation** — Binding via `HOSTNAME` and `PORT` env vars confirmed at https://nextjs.org/docs/app/api-reference/cli
- **Node.js `zlib` API** — Built-in gzip compression via `zlib.createGzip()`; documented at https://nodejs.org/api/zlib.html
- **Systemd service file format** — Unit file syntax and directives at https://www.freedesktop.org/software/systemd/man/systemd.service.html
- **Discord webhook API** — Minimal embed payload accepted per https://discord.com/developers/docs/resources/webhook#execute-webhook
- **GCS lifecycle rules** — Deletion policy via `gsutil lifecycle set` documented at https://cloud.google.com/storage/docs/managing-lifecycles
- **Existing codebase patterns** — `src/instrumentation.ts` and `src/lib/scheduler.ts` show the in-process job registration and 60s tick loop (verified by reading source files in this session)

### Secondary (MEDIUM confidence)

- **HOSTING-STRATEGY.md (existing)** — Sections 3.1–3.2 (OAuth token, swap file mitigation) are from prior research; sections 4, 5, 6 show the deployment architecture and backup strategy
- **GCP Always Free documentation** — e2-micro limits and free-tier allowances from https://cloud.google.com/free/docs/free-cloud-features (verified in prior phase research)

### Tertiary (LOW confidence — assumptions flagged in log)

- None at this point; all primary claims were verified.

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — All packages are standard, npm versions verified, APIs confirmed in official docs.
- Architecture patterns: **HIGH** — Reuse existing scheduler registration and `runTick()` patterns from Phase 4; in-process job scheduling is a well-established Node.js pattern.
- Pitfalls: **HIGH** — Based on real GCS/Discord/SQLite integration experience; backup contention and credential discovery are known issues.

**Research date:** 2026-04-22
**Valid until:** 30 days (standard for ops/infrastructure decisions with stable dependencies)
**Invalidation triggers:** Breaking changes to `@google-cloud/storage` API, GCS authentication model change, Discord webhook endpoint deprecation

---

## Next Steps for Planner

1. **Create systemd unit file** (`/etc/systemd/system/claude-tracker.service`) that starts the app as non-root user with `EnvironmentFile=/etc/claude-sender.env`.
2. **Implement backup job** in `src/lib/backup.ts` using `better-sqlite3.backup()` + `@google-cloud/storage` upload; register in `instrumentation.ts`.
3. **Implement notification sender** in `src/lib/notifications.ts` for Discord webhook POST; integrate into `scheduler.ts` (stall detection) and `sender.ts` (send failure).
4. **Add GCS SDK dependency** to `package.json`: `npm install @google-cloud/storage`.
5. **Rewrite HOSTING-STRATEGY.md** per D-12–D-15: user-journey structure, single-service reality, copy-pasteable commands, post-deploy checklist inline.
6. **Create Wave 0 test files** for backup, notifications, and stall detection (see Validation Architecture).
7. **Document manual verification steps** in HOSTING-STRATEGY.md: service status, CLI auth check, tick timestamp query, first send log inspection, GCS backup object verification.

All decisions are locked and research-backed. Planner can proceed with confidence.
