# Hosting & Storage Strategy — Claude Usage Optimizer

> Source-of-truth document for hosting decisions and data storage strategy. Written 2026-04-16.
> Pipe this into a Claude Code session when rebuilding the system so the agent inherits all research context, decisions, and rationale.

---

## 0. Executive summary

- **Host everything on a single Google Cloud `e2-micro` VM (Always Free tier).** Free forever, browser-based SSH, no capacity lottery, easiest setup for a non-developer.
- **Authenticate Claude Code via `CLAUDE_CODE_OAUTH_TOKEN`**, not an interactive VM-side login. The token is generated once on your local laptop with `claude setup-token`, lasts one year, and authenticates against your Pro/Max subscription (which is what lets you experiment with the 5-hour usage window).
- **Simplify the DB schema to `(id, timestamp, status, endpoint, response_status, raw_json, error_message)`.** Drop the denormalized window/extra-usage columns. Query with SQLite's `json_extract` at read time.
- **Keep SQLite as the storage engine, run it on the VM disk, and back up nightly to Google Cloud Storage (5 GB free tier).** Simpler and cheaper than managed Postgres for this workload; the data model is write-once append-only snapshots, which SQLite handles perfectly.
- **Run both subprojects on the same VM**: the Python message-sender as a systemd service, and the Next.js tracker as a second systemd service bound to `127.0.0.1` and fronted by Tailscale (or skipped entirely if you only need the tracker locally when you're on the VM via SSH tunnel).

Everything else in this document is the reasoning behind those five bullets, plus the step-by-step implementation.

---

## 1. System context

### What's being hosted

**Subproject A — `Claude Message Sender/`** (Python, ~215 LOC)
- Runs `claude -p "<question>"` on a schedule (~5× per day, each call <60s, model `haiku`).
- Purpose: intentionally start or shift the 5-hour rolling usage window on the user's Pro/Max subscription.
- Requires: Python 3.10+, the Claude Code CLI binary, persistent OAuth credentials, and a scheduler.
- Canonical entrypoint: `claude_message_send_with_CC_CLI.py`. The `_with_browser.py` variant is **deprecated** and out of scope.

**Subproject B — `claude-usage-tracker/`** (Next.js 16 + React 19 + better-sqlite3)
- Polls `claude.ai` for the user's usage snapshot at adaptive intervals (30 sec to 5 min based on a 4-tier state machine: `idle` / `light` / `active` / `burst`).
- Persists each snapshot into a SQLite database and renders a dashboard (heatmap, timeline, peak-hours, extra-usage cards).
- Today uses `better-sqlite3` with WAL mode against a local file at `data/usage.db`.

### Long-term direction

The two subprojects will eventually merge: the tracker will detect window boundaries and automatically tell the sender when to fire to shift the window. Any hosting decision made today must preserve that path.

### Hard constraints for hosting

1. **OAuth subscription auth, not API keys.** The whole point is to exercise the Pro/Max 5-hour window, which API-key billing bypasses.
2. **Persistent credentials.** The Claude Code OAuth token must survive VM reboots and redeploys without manual re-login.
3. **Terminal access to the host.** Needed at least once for first-time setup; also for debugging.
4. **Free tier strongly preferred**, always-free more valuable than time-limited trials.
5. **Easiest possible setup for a non-developer**, with as much CLI automation as possible so a Claude Code session can execute the playbook end-to-end.

### Workload profile

| Metric | Value |
|---|---|
| Sender invocations | ~5/day, <60s each, ~99.99% idle |
| Tracker polling | every 30s–5min (adaptive), tiny payload |
| Network in/out | <10 MB/day total |
| Peak RAM | Node + `claude` subprocess ≈ 300–500 MB transient |
| Disk growth | ~1–5 MB/day of snapshots |
| Concurrent users | 1 (you) |

Any "free tier" with ≥1 GB RAM and persistent disk is technically sufficient.

---

## 2. Hosting research — full findings

Three parallel research agents (run 2026-04-16) evaluated every reasonable free or near-free hosting option against the constraints above. Verified against live provider pages the same day.

### 2.1 Always-free VMs

| Provider | Free tier type | RAM / CPU (free cap) | CC required | Setup difficulty (1–5) | CC CLI arch compat | Verdict |
|---|---|---|---|---|---|---|
| **Oracle Cloud — Ampere A1** | Always Free (forever) | Up to 4 OCPU / 24 GB ARM | Yes ($0 charges) | 3 (capacity lottery + idle-reclaim) | ARM64 officially supported | Massive headroom but painful signup |
| **Oracle Cloud — E2.1.Micro** | Always Free (forever) | 2× VMs @ 1/8 OCPU / 1 GB | Yes | 2 | x64 | Solid fallback |
| **Google Cloud — e2-micro** | Always Free (forever) | 1 GB / 2 shared vCPU / 30 GB | Yes | **1** (cleanest UX) | x64 | ✅ **Winner** |
| **AWS — t2/t3.micro** | Trial only | 1 GB / 1 vCPU | Yes (will bill later) | 2 | x64/ARM | Reject — time-limited |
| **Azure — B1s** | Trial only | 1 GB / 1 vCPU | Yes (will bill later) | 2 | x64/ARM | Reject — time-limited |

**Critical gotchas:**
- Oracle Ampere free capacity is region-contested; signup-to-running can be hours to days.
- Oracle reclaims Always-Free compute after 7 days of <20% CPU / <10% net / <10% RAM. 5×/day + idle tracker should stay above the RAM threshold, but a keepalive cron is prudent if you go this route.
- GCP e2-micro free is **region-locked** to `us-west1` / `us-central1` / `us-east1`. Any other region silently bills you.
- AWS's classic 12-month free tier was replaced in 2025 with a "Free Plan" model capped at 6 months + $100 credit, then paid. Not a long-term home.

### 2.2 PaaS / container hosts

| Host | Free tier type | Persistent disk | Native cron | CC required | Setup diff. | Verdict |
|---|---|---|---|---|---|---|
| **Fly.io** | None for new signups (PAYG ~$2/mo min) | Yes (paid volumes) | Yes | Yes | 2 | Technically perfect, no longer free |
| **Railway** | $5 one-time trial + $1/mo credit | Trial volumes deleted 30d after credit | Yes | No (trial) | 2 | Trial only |
| **Render** | Free web service (sleeps after 15 min) | ❌ Not on free tier | ❌ No free cron ($1/mo min) | Yes ($1 verify) | 3 | Disk blocker |
| **Koyeb** | Always-free (1 service, 512 MB, 0.1 vCPU, 2 GB SSD) | Yes (2 GB SSD included) | Yes | No | 2 | Best free PaaS option |
| **Northflank** | Sandbox (2 services, 2 cron jobs) | ❌ Volumes paid | Yes | Likely yes | 3 | Volumes paid |
| **Vercel Hobby** | Cron ≤ 1×/day max | ❌ No FS persistence | Yes | No | 4 | Dismiss — 1/day cap breaks 5/day workload |
| **Netlify** | No Python runtime, 30s cap | ❌ | Yes | No | 4 | Dismiss |
| **Deta Space** | Shut down Oct 2024 | — | — | — | — | Dismiss |

**Why PaaS loses overall:** Most free PaaS tiers assume stateless containers that redeploy often. The Claude Code OAuth credentials file (`~/.claude/.credentials.json`) needs to persist across reboots and redeploys. The only free PaaS that nails persistence + no CC + cron is **Koyeb**, and it's still more constrained than a plain VM.

### 2.3 Serverless / scheduled execution

| Platform | Free tier | Native cron | CC required | CC CLI auth strategy | Setup diff. | Verdict |
|---|---|---|---|---|---|---|
| **Anthropic Routines** | PAYG ~$0.08/runtime-hour | Yes (min 1hr interval) | Yes (Console) | Built-in | 1 | Great fit *if* API-key billing were acceptable — it's not, for this project |
| **GitHub Actions cron** | Unlimited minutes on public repos | Yes | No | `--bare` + `ANTHROPIC_API_KEY` | 2 | ❌ Eliminated — no interactive OAuth path, API-key billing doesn't exercise the subscription window |
| **AWS Lambda + EventBridge** | 1M req/mo + 400k GB-sec | Yes | Yes | API key in Secrets Manager | 4 | Same elimination |
| **Cloud Run Jobs + Scheduler** | 240k vCPU-sec/mo | Yes | Yes | API key in Secret Manager | 3 | Same elimination |
| **Cloudflare Workers Cron** | 100k req/day | Yes | No | DOA — Pyodide sandbox, no subprocess | — | Dismiss |
| **Vercel Cron** | Hobby ≤ 1×/day | Yes | No | — | — | Dismiss |
| **Modal.com** | $30/mo free credits | Yes | No | Secrets | 2 | Same elimination |

**Why serverless loses overall:** Every serverless option assumes API-key auth (`ANTHROPIC_API_KEY` + `claude --bare`). There is no headless OAuth path for Pro/Max subscriptions — that feature is an open request (`anthropics/claude-code#22992`, filed Feb 2026). Since the whole project exists to manipulate the Pro/Max 5-hour window, serverless is fundamentally incompatible.

### 2.4 Cheap paid VPS — for reference only

| Provider | Price | Notes |
|---|---|---|
| Hetzner Cloud CX22 | €3.79/mo | 4 GB RAM, 2 vCPU, rock-solid. Meets Anthropic's stated 4 GB minimum. |
| Contabo | €4.50/mo | 8 GB RAM, slower disks. |
| OVH/Kimsufi | ~$3–5/mo | EU-focused. |

These exist as a fallback if the GCP free tier develops friction; they're not the chosen path today.

---

## 3. Critical findings (load-bearing)

These three facts changed or constrained the recommendation significantly. Call them out explicitly in the rebuild context.

### 3.1 Headless OAuth doesn't work the way it looks like it should

Claude Code's standard login (`claude` → browser popup → paste code) **requires** the browser to redirect back to the same machine that ran `claude`. On a headless VM over SSH, that redirect target is unreachable. This is an open feature request — device-code flow (RFC 8628) has been filed as issue #22992 but not shipped.

**The official workaround** (documented at [`code.claude.com/docs/en/authentication`](https://code.claude.com/docs/en/authentication)):

```bash
# Run this ON YOUR LOCAL LAPTOP, where you have a browser
claude setup-token
# Completes OAuth in your local browser, prints a one-year token
# Copy the token, set it on the VM:
export CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat-...
```

Quoted from the docs:

> For CI pipelines, scripts, or other environments where interactive browser login isn't available, generate a one-year OAuth token with `claude setup-token`. […] This token authenticates with your Claude subscription and requires a Pro, Max, Team, or Enterprise plan.

**Implications:**
- No VM-side interactive login is ever needed. The token is a long-lived string set once as an environment variable.
- The token authenticates against the user's Pro/Max subscription — exactly right for 5-hour-window experiments.
- Token is scoped to inference only; cannot start Remote Control sessions.
- **Do not pass `--bare` to `claude`** — bare mode ignores `CLAUDE_CODE_OAUTH_TOKEN` and requires `ANTHROPIC_API_KEY` instead.
- Token can be regenerated at any time. Revoke by running `claude setup-token` again; old tokens invalidate on new-token issuance.

### 3.2 GCP e2-micro has 1 GB RAM, Anthropic's stated minimum is 4 GB

From [`code.claude.com/docs/en/setup`](https://code.claude.com/docs/en/setup): "Hardware: 4 GB+ RAM, x64 or ARM64 processor."

For a one-shot `claude -p "<short question>" --model haiku` invocation, 1 GB is in practice sufficient, but it's below the stated minimum. **Mitigation**: provision a 2 GB swap file on the VM. The swap absorbs transient spikes during `claude` startup; the tracker's Next.js footprint stays well under 1 GB RSS in production mode.

If the swap approach creates noticeable latency or thrashing, the fallback is Oracle Ampere A1 (6–24 GB free, ARM64) or Hetzner CX22 (€3.79/mo, 4 GB). But do not default to these — GCP is strictly easier.

### 3.3 The subscription OAuth token is the whole architecture

Every hosting option was evaluated through the lens of: *can this run `claude` as the subscription user*? Options that only support API-key auth (serverless, GitHub Actions, Anthropic Routines) are architecturally incompatible with this project's purpose regardless of how technically elegant they are. Don't reopen that question without first revisiting whether the 5-hour-window manipulation is still the goal.

---

## 4. Final hosting recommendation

### Architecture

```
+--------------------------------------+
|  GCP e2-micro VM (Ubuntu 22.04 LTS)  |
|  us-central1, Always Free            |
|                                      |
|  /opt/message-sender/   (Python)     |
|   └─ systemd: claude-sender.service  |
|                                      |
|  /opt/tracker/          (Next.js)    |
|   └─ systemd: claude-tracker.service |
|   └─ data/usage.db      (SQLite)     |
|                                      |
|  /etc/claude-sender.env              |
|   └─ CLAUDE_CODE_OAUTH_TOKEN=...     |
|                                      |
|  Nightly cron:                       |
|   rsync data/ → gs://...-backups/    |
+--------------------------------------+
         |                  |
         |                  +— port 3018 (tracker UI)
         |                     ← exposed via Tailscale or SSH tunnel, never public
         |
         +— outbound HTTPS → claude.ai + api.anthropic.com
```

### Why a single VM for both

- Both subprojects need persistent disk and outbound HTTPS to claude.ai; there is no benefit to splitting them across hosts.
- The long-term merge plan (tracker triggers sender) is much simpler when they share a filesystem.
- One free VM is enough capacity for both; splitting would require two free accounts or one paid host.

### What `systemd` replaces

The Python sender currently uses a `while True: schedule.run_pending(); sleep(1)` loop. That works fine as a long-lived systemd service (unit type `simple`, `Restart=on-failure`). Alternative: rewrite as a one-shot script triggered by a systemd timer (one invocation per scheduled slot). The one-shot timer is more idiomatic on Linux and frees ~30 MB of resident RAM between runs. Defer that refactor until after first-run works — the current loop is fine for a 1 GB VM.

### What does *not* need to change

- Python dependency list (`schedule>=1.2.0`).
- The `QUESTIONS` rotation logic.
- The randomize-within-5-minutes behavior.
- The tier-based adaptive polling.
- Everything in the tracker's API routes.

---

## 5. Database strategy

### 5.1 Current state

Schema (from `src/lib/db.ts`):

```sql
CREATE TABLE usage_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok',
  endpoint TEXT,
  auth_mode TEXT,
  response_status INTEGER,
  five_hour_utilization REAL,
  five_hour_resets_at TEXT,
  seven_day_utilization REAL,
  seven_day_resets_at TEXT,
  extra_usage_enabled INTEGER,
  extra_usage_monthly_limit REAL,
  extra_usage_used_credits REAL,
  extra_usage_utilization REAL,
  raw_json TEXT,
  error_message TEXT
);
```

Plus two migrations (ALTER for extra_usage columns) and one data migration (cents→dollars for extra_usage).

### 5.2 Simplification — the new schema

Per the user's direction: store the raw API response per snapshot, parse at read time. The simplified schema is:

```sql
CREATE TABLE usage_snapshots (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp      TEXT    NOT NULL,      -- ISO 8601 UTC
  status         TEXT    NOT NULL,      -- 'ok' | 'error' | 'auth_failure'
  endpoint       TEXT,                  -- which claude.ai URL we hit
  response_status INTEGER,              -- HTTP status
  raw_json       TEXT,                  -- full API response body, verbatim
  error_message  TEXT                   -- only populated when status != 'ok'
);

CREATE INDEX idx_snapshots_timestamp ON usage_snapshots(timestamp);
CREATE INDEX idx_snapshots_status    ON usage_snapshots(status);

CREATE TABLE app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

Everything else is parsed from `raw_json` at query time using SQLite's built-in JSON functions.

**Why this is a good simplification:**

- **Zero schema migration debt going forward.** Claude.ai can add or rename fields and the DB doesn't care.
- **SQLite's JSON support is production-grade.** `json_extract(raw_json, '$.five_hour.utilization')` compiles to a fast C extension. Index-of-expression (generated columns) remains available if a specific path ever becomes hot.
- **Dashboard queries become explicit, not hidden in collector code.** Each query names exactly which JSON paths it depends on.
- **Easier replay and re-analysis.** A new chart can be built from existing snapshots without a backfill.
- **The raw payload is already being captured** (the `raw_json` column exists today) — so no data is lost by dropping the denormalized columns.

**What to put in `app_meta`:** migration markers, last-seen schema version, the `extra_usage_money_unit = 'dollars'` marker (keep for backward compatibility if you're not erasing the existing DB).

**Example read-time queries:**

```sql
-- Recent 5-hour utilization
SELECT
  timestamp,
  CAST(json_extract(raw_json, '$.five_hour.utilization') AS REAL) AS util,
  json_extract(raw_json, '$.five_hour.resets_at')               AS resets_at
FROM usage_snapshots
WHERE status = 'ok'
  AND timestamp >= datetime('now', '-24 hours')
ORDER BY timestamp;

-- Extra-usage dollars-spent (assuming the payload always stores cents when present)
SELECT
  timestamp,
  ROUND(CAST(json_extract(raw_json, '$.extra_usage.used_credits') AS REAL) / 100.0, 2) AS used_dollars
FROM usage_snapshots
WHERE json_extract(raw_json, '$.extra_usage.is_enabled') = 1
ORDER BY timestamp DESC
LIMIT 100;
```

**The read-path refactor:** move the work currently in `src/lib/normalize.ts` into a thin layer in `src/lib/queries.ts` that takes a `SnapshotRow` and returns a `NormalizedPayload` by running `JSON.parse(row.raw_json)` and the existing `normalizeUsagePayload` on it. Keep `normalize.ts` as the pure function; just call it at read time instead of write time.

**What the collector writes:**

```ts
insertSnapshot({
  timestamp:       new Date().toISOString(),
  status:          'ok',
  endpoint:        'https://claude.ai/api/...',
  responseStatus:  200,
  rawJson:         JSON.stringify(apiResponseBody),
  errorMessage:    null,
});
```

### 5.3 Storage hosting options

| Option | Free cost | Complexity | Latency | Durability | Verdict |
|---|---|---|---|---|---|
| **SQLite on the VM disk** | Free (uses VM's 30 GB PD) | Minimal — already working | Sub-ms local | VM-local (mitigate with backup) | ✅ **Winner for this workload** |
| **Turso (libSQL)** | 500 DBs / 9 GB / 1B row reads/mo | Change driver to `@libsql/client` | Tens of ms over network | Managed replicas | Second choice if VM-local durability becomes a concern |
| **Neon Postgres** | 0.5 GB / branching | Full driver swap, rewrite queries | 10s of ms | Managed | Overkill for append-only snapshots |
| **Supabase Postgres** | 500 MB, auto-pauses after 7d idle | Driver swap | 10s of ms | Managed | Auto-pause is a nonstarter for a 24/7 tracker |
| **Cloudflare D1** | 5 GB / 100k writes/day | Requires Workers to access | Varies | Managed | Hard to access from a plain VM |

**Why SQLite stays:**

- The workload is append-only and single-writer (one collector process). This is SQLite's sweet spot.
- Existing code already uses `better-sqlite3` in WAL mode. Zero migration work if we stay.
- Read-side dashboard is also on the same VM, so there is no network between writer and reader.
- Managed Postgres is a complexity tax with no benefit here.

### 5.4 Backup strategy

**Goal:** never lose more than 24 hours of snapshots. Protect against VM disk loss, VM deletion, accidental `rm`, or data corruption.

**Recommendation:** nightly SQLite online backup → Google Cloud Storage.

```bash
# /opt/tracker/backup.sh
#!/usr/bin/env bash
set -euo pipefail

DB=/opt/tracker/data/usage.db
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT=/tmp/usage-${STAMP}.db

sqlite3 "$DB" ".backup '$OUT'"          # online backup, safe while DB is in use
gzip -9 "$OUT"
gcloud storage cp "${OUT}.gz" "gs://${BUCKET}/backups/daily/"
rm -f "${OUT}.gz"
```

**GCS bucket configuration:**
- Storage class: `STANDARD` (within 5 GB always-free allowance for this region).
- Lifecycle rule: delete objects older than 30 days automatically.
- A second rule: transition to `NEARLINE` after 7 days (cheaper long-term retention).

**Free-tier GCS allowances (North America):**
- 5 GB of storage per month in `us-west1`, `us-central1`, `us-east1`.
- 100 GB egress per month from North America.
- 5,000 Class A + 50,000 Class B operations per month.

Your backups will be a few MB/day compressed, well inside the free envelope.

**Schedule:** systemd timer at 04:15 UTC daily (outside the 5 sender runs, outside peak claude.ai polling). Retain 30 daily backups and 12 monthly rollups.

**Restore procedure:**
```bash
gcloud storage cp gs://${BUCKET}/backups/daily/usage-YYYYMMDDTHHMMSSZ.db.gz .
gunzip usage-*.db.gz
sqlite3 usage-*.db "PRAGMA integrity_check;"   # should return 'ok'
mv usage-*.db /opt/tracker/data/usage.db
systemctl restart claude-tracker
```

---

## 6. Implementation playbook

Four phases. Phases 1–2 are one-time on your laptop; phases 3–4 run on the VM (mostly automated).

### Phase 1 — Local laptop setup (one-time, ~10 min)

**1.1 Install gcloud CLI (Windows).** Download and run [`GoogleCloudSDKInstaller.exe`](https://dl.google.com/dl/cloudsdk/channels/rapid/GoogleCloudSDKInstaller.exe). Winget is not officially supported by Google for this tool; use the installer.

**1.2 Authenticate and pick a project.**
```powershell
gcloud init
# Follow the prompts: sign in with your Google account, select/create a project.
gcloud auth login
gcloud config set compute/region us-central1
gcloud config set compute/zone   us-central1-a
```

**1.3 Enable the Compute Engine API (first time only).**
```powershell
gcloud services enable compute.googleapis.com
```

**1.4 Install Claude Code on your laptop (if not already).**
```powershell
winget install Anthropic.ClaudeCode
# Alternative: irm https://claude.ai/install.ps1 | iex
```

**1.5 Generate the long-lived OAuth token.**
```powershell
claude setup-token
```
This opens your browser for OAuth, then prints a token like `sk-ant-oat-...`. **Copy the whole token** — you will paste it into an env file on the VM in Phase 3. The printed token is never saved to disk; if you lose it, just run `setup-token` again.

### Phase 2 — Provision the VM (one command, ~1 min)

```powershell
gcloud compute instances create claude-optimizer `
  --machine-type=e2-micro `
  --zone=us-central1-a `
  --image-family=ubuntu-2204-lts `
  --image-project=ubuntu-os-cloud `
  --boot-disk-size=30GB `
  --boot-disk-type=pd-standard `
  --tags=claude-optimizer
```

Wait ~30 seconds. Confirm it's up:
```powershell
gcloud compute instances list
```

Connect over browser SSH (easiest) or CLI SSH:
```powershell
gcloud compute ssh claude-optimizer --zone=us-central1-a
```

### Phase 3 — VM-side setup (run on the VM)

Copy-paste the following block into the SSH session. It is idempotent — rerunning it is safe.

```bash
# === 3.1 System packages ===
sudo apt-get update
sudo apt-get install -y python3 python3-venv python3-pip git rsync sqlite3

# === 3.2 Add 2 GB swap (mitigation for 1 GB RAM vs Anthropic's 4 GB stated minimum) ===
if [ ! -f /swapfile ]; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

# === 3.3 Install Claude Code (native installer, auto-updates) ===
curl -fsSL https://claude.ai/install.sh | bash
# Binary lands at ~/.local/bin/claude

# === 3.4 Clone the umbrella repo ===
sudo mkdir -p /opt && sudo chown "$USER" /opt
cd /opt
# Replace the URL below with your repo's clone URL (HTTPS or SSH):
git clone https://github.com/<you>/claude-usage-optimizer.git
cd claude-usage-optimizer

# === 3.5 Paste the OAuth token into an env file with restrictive perms ===
sudo tee /etc/claude-sender.env >/dev/null <<'EOF'
CLAUDE_CODE_OAUTH_TOKEN=PASTE_YOUR_TOKEN_HERE
PATH=/home/YOUR_USERNAME/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
EOF
sudo chmod 600 /etc/claude-sender.env
# Then `sudo nano /etc/claude-sender.env` and replace both placeholders.

# === 3.6 Python venv for the sender ===
cd "/opt/claude-usage-optimizer/Claude Message Sender"
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# === 3.7 Systemd service for the sender ===
sudo tee /etc/systemd/system/claude-sender.service >/dev/null <<EOF
[Unit]
Description=Claude Message Sender (5-hour window shifter)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER
WorkingDirectory=/opt/claude-usage-optimizer/Claude Message Sender
EnvironmentFile=/etc/claude-sender.env
ExecStart=/opt/claude-usage-optimizer/Claude Message Sender/.venv/bin/python claude_message_send_with_CC_CLI.py
Restart=on-failure
RestartSec=30

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now claude-sender
sudo systemctl status claude-sender --no-pager
```

For the tracker (when its source is ready after the schema refactor):

```bash
# === 3.8 Node + tracker build ===
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
cd /opt/claude-usage-optimizer/claude-usage-tracker
npm ci
npm run build

# === 3.9 Tracker env + service ===
sudo tee /etc/claude-tracker.env >/dev/null <<'EOF'
APP_HOST=127.0.0.1
PORT=3018
AUTO_OPEN_BROWSER=false
# Add your claude.ai cookie / auth config here as needed
EOF
sudo chmod 600 /etc/claude-tracker.env

sudo tee /etc/systemd/system/claude-tracker.service >/dev/null <<EOF
[Unit]
Description=Claude Usage Tracker (Next.js)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER
WorkingDirectory=/opt/claude-usage-optimizer/claude-usage-tracker
EnvironmentFile=/etc/claude-tracker.env
ExecStart=/usr/bin/npm run start
Restart=on-failure
RestartSec=30

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now claude-tracker
```

### Phase 4 — Backups

```bash
# === 4.1 Create GCS bucket (run once, on laptop or VM) ===
gcloud storage buckets create gs://claude-optimizer-backups-$RANDOM \
  --location=us-central1 \
  --default-storage-class=STANDARD

# Save the bucket name — you'll reference it in the backup script.

# === 4.2 Backup script on VM ===
sudo tee /opt/tracker-backup.sh >/dev/null <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
BUCKET=gs://claude-optimizer-backups-CHANGEME
DB=/opt/claude-usage-optimizer/claude-usage-tracker/data/usage.db
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT=/tmp/usage-${STAMP}.db
sqlite3 "$DB" ".backup '$OUT'"
gzip -9 "$OUT"
gcloud storage cp "${OUT}.gz" "${BUCKET}/backups/daily/"
rm -f "${OUT}.gz"
EOF
sudo chmod +x /opt/tracker-backup.sh

# === 4.3 Systemd timer for nightly backup at 04:15 UTC ===
sudo tee /etc/systemd/system/tracker-backup.service >/dev/null <<EOF
[Unit]
Description=Nightly SQLite backup to GCS
[Service]
Type=oneshot
ExecStart=/opt/tracker-backup.sh
EOF

sudo tee /etc/systemd/system/tracker-backup.timer >/dev/null <<EOF
[Unit]
Description=Run tracker-backup daily
[Timer]
OnCalendar=*-*-* 04:15:00
Persistent=true
[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now tracker-backup.timer

# === 4.4 Lifecycle rule: delete backups older than 30 days ===
cat <<'EOF' > /tmp/lifecycle.json
{
  "rule": [
    {"action": {"type": "Delete"}, "condition": {"age": 30}}
  ]
}
EOF
gcloud storage buckets update gs://claude-optimizer-backups-CHANGEME \
  --lifecycle-file=/tmp/lifecycle.json
```

### Phase 5 — Verification

```bash
# Services healthy?
systemctl status claude-sender   --no-pager
systemctl status claude-tracker  --no-pager
systemctl list-timers tracker-backup

# Sender logs (live tail)
journalctl -u claude-sender -f

# Tracker reachable locally?
curl -sI http://127.0.0.1:3018 | head -1   # expect HTTP/1.1 200 OK

# Claude CLI authenticated?
sudo -u $USER bash -c 'source /etc/claude-sender.env && claude --version && claude -p "say hi" --model haiku'

# Backup dry-run
sudo /opt/tracker-backup.sh
gcloud storage ls gs://claude-optimizer-backups-*/backups/daily/ | tail -3
```

### Accessing the tracker dashboard

Three options, pick what fits:

1. **SSH tunnel** (simplest, no extra setup):
   `gcloud compute ssh claude-optimizer --zone=us-central1-a -- -NL 3018:127.0.0.1:3018`
   Then open `http://127.0.0.1:3018` on your laptop.
2. **Tailscale** (persistent, zero-friction): install tailscaled on the VM, add it to your tailnet, access `http://claude-optimizer:3018` from any device.
3. **Cloudflare Tunnel / Tailscale Funnel**: expose to the public internet if you want. Not recommended unless you add auth.

Do **not** open port 3018 on the VM's external firewall. The tracker has no auth layer today.

---

## 7. Rebuild prompt (drop into Claude Code)

The block below is a self-contained prompt you can paste into a fresh Claude Code session to rebuild the system from scratch against this hosting strategy. The agent should have this document on hand (`--add-dir` the repo root) before starting.

```
Your task: rebuild the Claude Usage Optimizer system on a fresh GCP e2-micro VM
following HOSTING-STRATEGY.md. That document is the source of truth; consult it
whenever a decision is ambiguous.

Phase order (do not skip or reorder):
  1. Provision the GCP e2-micro VM per HOSTING-STRATEGY.md §6 Phase 2.
  2. Refactor the tracker DB layer to the simplified schema in §5.2 BEFORE
     deploying the tracker. Specifically:
       - Drop the five_hour_*, seven_day_*, extra_usage_* columns from
         usage_snapshots.
       - Keep only (id, timestamp, status, endpoint, response_status,
         raw_json, error_message).
       - Move normalization work into a read-side queries.ts that parses
         raw_json with JSON.parse and calls normalizeUsagePayload.
       - Rewrite src/app/api/dashboard/route.ts and any other reader to
         use json_extract or the new queries.ts.
       - Write a one-shot migrator that ingests any existing usage.db
         into the new schema by re-running normalize on the stored
         raw_json per row — do not re-fetch from claude.ai.
  3. Deploy sender + tracker per §6 Phase 3.
  4. Configure backups per §6 Phase 4.
  5. Verify everything per §6 Phase 5 and report status.

Hard rules:
  - Use CLAUDE_CODE_OAUTH_TOKEN for auth, never ANTHROPIC_API_KEY and never
    --bare mode (see §3.1).
  - Do not expose the tracker port to the public internet (§6.5).
  - Do not use Claude Code CLI's auto-update if pinning to a specific
    version is requested; defer to §3 of the Claude Code setup docs.

When you hit an ambiguity HOSTING-STRATEGY.md doesn't cover, ask a single
targeted question before acting.
```

---

## 8. Open questions / future work

Flag these for your own backlog; none are blockers for the initial deploy.

- **Device-code OAuth flow** (RFC 8628) support for Claude Code is tracked at [`anthropics/claude-code#22992`](https://github.com/anthropics/claude-code/issues/22992). If/when it ships, the laptop-side `claude setup-token` step can move onto the VM directly — marginal UX win but eliminates one handoff.
- **Tracker auth.** The dashboard has no login. Mitigated today by binding to `127.0.0.1`. If you ever expose it publicly (Cloudflare Tunnel, Tailscale Funnel), add basic auth or an OIDC proxy.
- **Sender refactor to systemd timer.** Replaces the `while True` schedule loop with a one-shot script fired by `OnCalendar=*-*-* 05:05:00` timer definitions. Frees ~30 MB resident RAM between runs. Low priority.
- **5-hour window detection.** The tracker has the data to detect when a window just started (utilization drops from >0 to 0). Wiring that detection to a `systemctl start claude-sender-oneshot` call is the merge point the roadmap refers to.
- **Multiple-user / Pro accounts.** Out of scope today; would require secret-per-account and some form of namespacing in the DB.
- **Observability.** `journalctl` is enough for one user. If you ever want notifications (sender failed 3× in a row, tracker stopped writing), `ntfy.sh` or a single Discord webhook is the cheapest add.

---

## 9. Sources

All fetched 2026-04-16 in the research session that produced this document.

**GCP:**
- [GCP Always Free features](https://docs.cloud.google.com/free/docs/free-cloud-features) — e2-micro limits, eligible regions, 30 GB PD, 1 GB egress.
- [GCP SDK install](https://docs.cloud.google.com/sdk/docs/install) — Windows installer URL.
- [gcloud compute instances create](https://docs.cloud.google.com/compute/docs/instances/create-start-instance) — VM provisioning syntax.
- [GCP Cloud Storage Always Free](https://cloud.google.com/storage/pricing) — 5 GB free bucket allowance.

**Oracle Cloud:**
- [Oracle Cloud Always Free](https://www.oracle.com/cloud/free/) — Ampere A1 + E2.1.Micro limits.
- [Oracle Always Free reclamation](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) — idle-instance reclamation policy.

**Claude Code:**
- [Claude Code setup](https://code.claude.com/docs/en/setup) — system requirements, install commands, 4 GB RAM minimum.
- [Claude Code authentication](https://code.claude.com/docs/en/authentication) — `claude setup-token`, `CLAUDE_CODE_OAUTH_TOKEN` precedence, `--bare` mode exclusion.
- [Claude Code headless](https://code.claude.com/docs/en/headless) — bare mode behavior.
- [Feature request: device code flow](https://github.com/anthropics/claude-code/issues/22992) — tracks the headless OAuth gap.
- [Feature request: remote SSH OAuth](https://github.com/anthropics/claude-code/issues/44028) — macOS keychain + SSH issue.

**PaaS / serverless (eliminated but documented):**
- [Fly.io pricing](https://fly.io/docs/about/pricing/) — PAYG model post-Oct-2024.
- [Koyeb pricing](https://www.koyeb.com/pricing) — always-free instance specs.
- [Render pricing](https://render.com/pricing) / [Render free docs](https://render.com/docs/free) — no free disk, no free cron.
- [Railway pricing](https://railway.com/pricing) / [Railway free trial](https://docs.railway.com/pricing/free-trial) — $5 trial + $1/mo credit.
- [Vercel cron usage](https://vercel.com/docs/cron-jobs/usage-and-pricing) — Hobby 1/day cap.
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/) / [Python Workers](https://developers.cloudflare.com/workers/languages/python/how-python-workers-work/) — Pyodide sandbox, no subprocess.
- [Modal cron](https://modal.com/docs/guide/cron) / [Modal pricing](https://modal.com/pricing) — $30/mo credits.
- [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) / [inactivity pause](https://github.com/orgs/community/discussions/86087).
- [Anthropic Routines docs](https://code.claude.com/docs/en/routines) / [scheduled tasks](https://code.claude.com/docs/en/scheduled-tasks).

**Data storage alternatives (for reference):**
- [Turso pricing](https://turso.tech/pricing) — libSQL free tier.
- [Neon pricing](https://neon.tech/pricing) — free Postgres tier.
- [Supabase free tier](https://supabase.com/pricing) — auto-pause caveat.
- [Cloudflare D1](https://developers.cloudflare.com/d1/platform/pricing/) — free tier, Workers-only access.
