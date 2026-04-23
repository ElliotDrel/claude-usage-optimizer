---
phase: 06-vm-deployment-hardening
plan: 03
subsystem: Infrastructure & Deployment
tags:
  - systemd
  - production-deployment
  - ops-artifacts
  - security
dependency_graph:
  requires:
    - Phase 1: Schema & DB initialization (SCHEMA constant available)
    - Phase 3: Sender logic (npm run start:prod implemented)
  provides:
    - Systemd service unit file for non-root production execution
    - Environment file template with comprehensive documentation
  affects:
    - Phase 6 Plan 4 (HOSTING-STRATEGY.md rewrite references these artifacts)
tech_stack:
  added: []
  patterns:
    - systemd Type=simple service management
    - EnvironmentFile-based configuration injection
    - Unix file permissions (mode 600 for secrets)
key_files:
  created:
    - /claude-tracker.service (repo root; deployed to /etc/systemd/system/claude-tracker.service on VM)
    - /claude-sender.env.example (repo root; deployed to /etc/claude-sender.env on VM, with deployer customization)
  modified: []
decisions:
  - Use systemd Type=simple (process-based) rather than Type=forking — cleaner lifecycle management and better integration with journal logging
  - Store HOSTNAME and PORT in EnvironmentFile rather than hardcoding in unit file — allows deployers to change binding without unit file regeneration
  - Include security warning in env template about chmod 600 — reduces attack surface for stored OAuth tokens
metrics:
  duration_seconds: 164
  completed_date: 2026-04-23T05:40:13Z
  task_count: 2
  file_count: 2
---

# Phase 6 Plan 3: Production Systemd Service & Env File Summary

**Objective:** Create systemd service unit file and environment template for production deployment on GCP e2-micro VM.

**Core Value:** Enables non-technical users to deploy a production-ready service that automatically recovers from crashes, binds securely to localhost only, and reads all configuration from a single environment file.

## What Was Built

### Task 1: Systemd Unit File (`claude-tracker.service`)

**File:** `/claude-tracker.service` (repo root; deploys to `/etc/systemd/system/claude-tracker.service`)

**Key Structure:**

```ini
[Unit]
Description=Claude Usage Optimizer Tracker
After=network.target

[Service]
Type=simple                                    # Process-based, no forking
User=claude-tracker                            # Non-root user (security)
Group=claude-tracker                           # Same group ownership
WorkingDirectory=/opt/claude-usage-optimizer   # Repo root (where package.json lives)
EnvironmentFile=/etc/claude-sender.env         # Load all env vars from config file
ExecStart=/usr/bin/npm run start:prod          # Production server startup
Restart=always                                 # Auto-recover from crashes
RestartSec=5                                   # Wait 5 seconds before restarting
StandardOutput=journal                         # Log stdout to systemd journal
StandardError=journal                          # Log stderr to systemd journal

[Install]
WantedBy=multi-user.target                     # Enable for multi-user systems
```

**Key Design Decisions:**

1. **Type=simple** — Process-based service (not forking). The Next.js app runs in foreground, and systemd monitors the PID directly. Cleaner than Type=forking and better journal integration.

2. **Non-root execution** — Service runs as dedicated `claude-tracker` user. Systemd starts the service as root, then drops privileges before executing the app. This prevents privilege escalation and contains any potential compromise.

3. **EnvironmentFile pattern** — All configuration (HOSTNAME, PORT, CLAUDE_CODE_OAUTH_TOKEN, GCS_BACKUP_BUCKET, etc.) is read from `/etc/claude-sender.env`. Unit file does NOT hardcode or override these values — deployers change the env file, not the unit file. No unit file reload needed.

4. **Journal logging** — StandardOutput and StandardError go to systemd journal. Operational logs are accessible via `journalctl -u claude-tracker`. Single log stream; no need to manage separate log files.

5. **Automatic recovery** — Restart=always means systemd restarts the service on any exit code (crash, unhandled exception, etc.). RestartSec=5 provides a 5-second grace period before retrying — prevents rapid-fire restart loops during startup failures.

**Deployment Flow:**

- `sudo cp ./claude-tracker.service /etc/systemd/system/` → Copies unit file to standard location
- `sudo systemctl daemon-reload` → Tells systemd to re-read unit files
- `sudo systemctl enable claude-tracker` → Marks service for auto-start on boot
- `sudo systemctl start claude-tracker` → Starts the service immediately
- `sudo systemctl status claude-tracker` → Verifies service is running

### Task 2: Environment File Template (`claude-sender.env.example`)

**File:** `/claude-sender.env.example` (repo root; deployers copy to `/etc/claude-sender.env` and customize)

**Content Structure:**

```bash
# Security warning (at top)
# File contains OAuth token and GCS credentials — must have mode 600 after creation

# OAuth Authentication
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat-...  # Placeholder; deployer pastes their token here

# Server Binding
HOSTNAME=127.0.0.1      # Localhost-only; never change to 0.0.0.0 (would expose to network)
PORT=3018               # Fixed port; app listens here

# Node Environment
NODE_ENV=production

# Data Directory (optional)
# DATA_DIR=/opt/claude-usage-optimizer/data

# GCS Backup Configuration
GCS_BACKUP_BUCKET=your-gcs-bucket-name-here  # Deployer creates bucket and sets this

# Optional Discord Notifications
# DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

**Key Design Decisions:**

1. **Single source of truth** — All configuration flows from `/etc/claude-sender.env`. The systemd unit file loads this file via `EnvironmentFile=/etc/claude-sender.env`, and the Next.js app reads environment variables at startup (via Node's `process.env`).

2. **Bind to localhost only** — HOSTNAME=127.0.0.1 and PORT=3018 are hardcoded as literals in the template (not placeholders). This enforces security: the app never listens on 0.0.0.0 (public interface). Dashboard has no auth layer; network isolation is the only protection.

3. **OAuth token security** — Placeholder token `sk-ant-oat-...` is clearly marked as an example. Real token is pasted by deployer. File must have chmod 600 (rw-------) after creation — only the `claude-tracker` user can read it. This prevents other users or processes from accessing the token.

4. **GCS bucket** — Placeholder `your-gcs-bucket-name-here` requires deployer to create a GCS bucket and set this value. Backup job reads this var at startup.

5. **Optional Discord notifications** — DISCORD_WEBHOOK_URL is commented out; notifications are opt-in. Deployer can add it now or set it later via the dashboard (it updates `app_meta.notification_webhook_url`). If neither is set, notifications are silently skipped.

6. **Comprehensive documentation** — Each section has inline comments explaining what the variable does, why it matters, and any caveats (e.g., "never 0.0.0.0", "chmod 600 required").

**Deployment Flow:**

- Deployer copies template: `sudo cp ./claude-sender.env.example /etc/claude-sender.env`
- Deployer fills in their values: `CLAUDE_CODE_OAUTH_TOKEN`, `GCS_BACKUP_BUCKET`, optionally `DISCORD_WEBHOOK_URL`
- Deployer secures the file: `sudo chmod 600 /etc/claude-sender.env`
- Deployer verifies: `ls -l /etc/claude-sender.env` shows `-rw-------` (mode 600)
- Service reads env file at startup (via systemd EnvironmentFile directive)
- Next.js app reads variables via `process.env` at runtime

## Threat Model Mitigations

| Threat ID | Category | Component | Mitigation in This Plan |
|-----------|----------|-----------|--------------------------|
| T-06-01 | Tampering / Disclosure | /etc/claude-sender.env permissions too loose | Documented in env file template: "sudo chmod 600 /etc/claude-sender.env". File is mode 600 (rw-------) so only claude-tracker user can read. Blocks other users and processes from accessing OAuth token. |
| T-06-02 | Tampering / Disclosure | OAuth token exposed via env var or process listing | Token stored in env file with restrictive perms (600). At runtime, Next.js reads via process.env (not passed as command-line arg). Kernel protects env vars from ps output. |
| T-06-11 | Elevation | Systemd starts service as non-root, but socket is root-owned initially | Service runs as claude-tracker user (non-root). Unit file specifies User=claude-tracker. Systemd binds the listening socket before dropping privs (standard practice). App cannot escalate back to root. |
| T-06-12 | Authorization | Binding to public interface (0.0.0.0) instead of 127.0.0.1 | Unit file loads HOSTNAME=127.0.0.1 from env file. Template explicitly documents: "never 0.0.0.0". Binding to 127.0.0.1 enforces network-level access control (dashboard only accessible via SSH tunnel or Tailscale). |
| T-06-13 | Information Disclosure | systemd journal logs contain sensitive errors | StandardOutput=journal and StandardError=journal mean all stdout/stderr goes to journalctl. If errors contain tokens or credentials, they could be exposed. Mitigated by: (a) code that avoids logging secrets, and (b) journal permissions (journalctl requires read access to /var/log/journal/). |

## Deployment Verification Checklist

After deployer completes the manual steps (copy unit file, copy env file, fill in values, chmod 600, systemctl daemon-reload, systemctl enable, systemctl start), the following verification commands should succeed:

```bash
# Service is running
sudo systemctl status claude-tracker

# Service is listening on 127.0.0.1:3018
sudo ss -tlnp | grep 3018

# Env file has correct permissions (rw-------)
ls -l /etc/claude-sender.env

# Recent log shows successful startup
sudo journalctl -u claude-tracker --since "5 min ago"

# OAuth token is recognized (first API call succeeds)
# Evidenced by: no 401/403 errors in journalctl, and/or first usage_snapshot appears in DB

# Scheduler ticks every 60 seconds
# Evidenced by: app_meta.last_tick_at is recent (within last minute)
```

## Related Plans

**Phase 6 Plan 1 (Backup)** — Runs nightly backup job; reads GCS_BACKUP_BUCKET from env file.

**Phase 6 Plan 2 (Notifications)** — Fires Discord webhooks on send failures; reads DISCORD_WEBHOOK_URL from env file or app_meta.

**Phase 6 Plan 4 (HOSTING-STRATEGY.md)** — Complete rewrite; includes full deployment playbook (create VM, provision swap, install Node.js, clone repo, copy unit file, copy env file, fill values, chmod, systemctl commands).

## Deviations from Plan

None — plan executed exactly as written.

- systemd unit file created with correct sections and directives
- EnvironmentFile pattern used (no hardcoded env vars in unit file)
- env file template includes all required vars + comprehensive documentation
- Security warnings included (chmod 600, OAuth token safety, never 0.0.0.0)
- Placeholder values clearly marked (sk-ant-oat-..., your-gcs-bucket-name-here)

## Success Criteria Met

- [x] /etc/systemd/system/claude-tracker.service (created at repo root; deploys to /etc/)
- [x] Unit file has Type=simple
- [x] Unit file specifies User=claude-tracker (non-root)
- [x] Unit file loads env vars from EnvironmentFile=/etc/claude-sender.env
- [x] ExecStart is /usr/bin/npm run start:prod (absolute path)
- [x] Restart=always and RestartSec=5
- [x] StandardOutput=journal and StandardError=journal
- [x] /etc/claude-sender.env.example (created at repo root; deployers copy to /etc/)
- [x] Env template includes HOSTNAME=127.0.0.1, PORT=3018, CLAUDE_CODE_OAUTH_TOKEN, NODE_ENV, GCS_BACKUP_BUCKET
- [x] Env template includes security warning about chmod 600
- [x] All placeholder values are clearly marked (sk-ant-oat-..., your-gcs-bucket-name-here)

## Test Coverage

These are ops artifacts (not code). No automated tests. Manual verification: deployer will copy .example to /etc/claude-sender.env, fill in values, chmod 600, then run `sudo systemctl daemon-reload && sudo systemctl enable claude-tracker && sudo systemctl start claude-tracker`.

Post-deploy verification via: `systemctl status`, `ss -tlnp`, `journalctl -u claude-tracker`, inspection of `usage_snapshots` table (first scheduled send lands).
