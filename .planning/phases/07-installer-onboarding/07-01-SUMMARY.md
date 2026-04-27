---
phase: 07-installer-onboarding
plan: "01"
subsystem: installer
tags: [bash, installer, systemd, sqlite, idempotent]
dependency_graph:
  requires: []
  provides: [scripts/install.sh]
  affects: [/opt/claude-usage-optimizer, /etc/systemd/system/claude-tracker.service, /etc/claude-sender.env, /etc/sudoers.d/claude-tracker]
tech_stack:
  added: []
  patterns: [bash-idempotent-installer, sqlite3-cli-schema-init, systemd-service-user]
key_files:
  created:
    - scripts/install.sh
  modified: []
decisions:
  - "Installer creates app_meta schema and inserts setup_complete='false' via sqlite3 CLI before service starts, so proxy can read DB state on the very first request without a race condition"
  - "DB file chowned to claude-tracker immediately after sqlite3 creates it so the service process can open WAL mode and write siblings (-wal/-shm)"
  - "chmod 644 applied to copied systemd unit file to prevent 'cannot parse' errors from restrictive source permissions"
metrics:
  duration: "~8 min"
  completed_date: "2026-04-27"
  tasks_completed: 1
  files_created: 1
  files_modified: 0
---

# Phase 7 Plan 01: Installer Script Summary

**One-liner:** Idempotent `curl | bash` installer provisions Ubuntu 22.04 e2-micro (swap, Node 20, clone, build, systemd) and seeds SQLite `app_meta.setup_complete='false'` so the first-run wizard triggers immediately.

## What Was Built

`scripts/install.sh` — a 220-line bash script that fully provisions a fresh GCP e2-micro Ubuntu 22.04 VM with a single command:

```
bash <(curl -sL https://raw.githubusercontent.com/elliotdrel/claude-usage-optimizer/main/scripts/install.sh)
```

### 14-step execution sequence

| Step | Action | Idempotency guard |
|------|--------|-------------------|
| 1 | Verify root | `id -u` |
| 2 | `apt-get update -qq` | Always safe |
| 3 | Install git, curl, sqlite3 | apt handles duplicates |
| 4 | Provision 2 GB swap | `[ ! -f /swapfile ]`; fstab append guarded by `grep -q '/swapfile'` |
| 5 | Install Node.js 20 via NodeSource | `command -v node` + version check |
| 6 | Create `claude-tracker` system user | `id -u claude-tracker` |
| 7 | Clone or pull repo to `/opt/claude-usage-optimizer` | `.git` dir check |
| 8 | `npm ci --omit=dev` + `npm run build` | Always re-runs (safe) |
| 9 | Create `data/` dir, chown to service user | `mkdir -p` |
| 10 | Pre-create `/etc/claude-sender.env` (mode 600) | Always overwrites with placeholders |
| 11 | Seed SQLite DB — create `app_meta` schema + `setup_complete='false'` | `INSERT OR REPLACE` |
| 12 | Install sudoers entry for `write-env.sh` (mode 440) | Always overwrites; visudo validates |
| 13 | Copy systemd unit, `daemon-reload`, `enable` | Always safe |
| 14 | `systemctl start claude-tracker` | Checks `is-active` after 2s |

### Security properties

- No secrets hardcoded — placeholder env file only; wizard fills secrets post-install
- All variable expansions in double quotes — prevents word splitting
- Absolute paths only throughout
- `set -e`, `set -u`, and `trap ERR` for fail-fast with line numbers
- Sudoers entry is narrowly scoped to `write-env.sh` only (no wildcards, no ALL)
- `/etc/claude-sender.env` mode 600 root:root; staging file pattern for wizard writes

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] Create app_meta schema before INSERT**

- **Found during:** Task 1 — planning the DB initialization step (step 12)
- **Issue:** The plan specified `INSERT OR REPLACE INTO app_meta` but `app_meta` table does not exist until `getDb()` runs (which only happens when the app starts for the first time). Running the INSERT bare would fail with "no such table: app_meta".
- **Fix:** Installer runs a sqlite3 heredoc that first issues `CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)` (schema matches `src/lib/db.ts` exactly), then the INSERT. The app's own `getDb()` will re-run `CREATE TABLE IF NOT EXISTS` on startup — no conflict.
- **Files modified:** `scripts/install.sh` (step 11)
- **Commit:** 7555f72

**2. [Rule 2 - Missing Critical Functionality] Chown usage.db to service user after sqlite3 creates it**

- **Found during:** Task 1 — reviewing ownership after DB creation
- **Issue:** `sqlite3` runs as root (the installer runs as root), so `usage.db` would be root-owned. The service runs as `claude-tracker`. better-sqlite3 in WAL mode requires write access to the DB file and directory to create `-wal` and `-shm` siblings. A root-owned DB would cause the service to crash on first write.
- **Fix:** Immediately after the sqlite3 heredoc, installer runs `chown claude-tracker:claude-tracker "${DB_PATH}"` and `chmod 640 "${DB_PATH}"`. Directory ownership was already set to `claude-tracker` in step 9.
- **Files modified:** `scripts/install.sh` (step 11)
- **Commit:** 7555f72

**3. [Rule 3 - Blocking Issue] chmod 644 on copied systemd unit file**

- **Found during:** Task 1 — reviewing RESEARCH.md pitfall 4
- **Issue:** `cp` preserves source file permissions. If `claude-tracker.service` in the repo has restrictive mode, the copy would be unreadable by systemd, causing "cannot parse" errors.
- **Fix:** Added `chmod 644 "${SYSTEMD_UNIT}"` immediately after `cp`. This matches the RESEARCH.md documented pitfall.
- **Files modified:** `scripts/install.sh` (step 13)
- **Commit:** 7555f72

**4. [Rule 2 - Missing Critical Functionality] Guard fstab append for idempotency**

- **Found during:** Task 1 — reviewing the swap step
- **Issue:** The plan says "append to /etc/fstab once" but the outer guard (`[ ! -f /swapfile ]`) only prevents re-running on an already-provisioned system if the swapfile exists. A partial run (swapfile created but not activated) could leave a double-entry.
- **Fix:** Added `if ! grep -q '/swapfile' /etc/fstab` guard around the fstab append — belt-and-suspenders idempotency.
- **Files modified:** `scripts/install.sh` (step 4)
- **Commit:** 7555f72

## Known Stubs

None. The installer is a provisioning script with no UI stubs.

## Threat Flags

No new threat surface beyond what the plan's threat model documents. All mitigations from the threat register are implemented:

| Threat | Mitigation applied |
|--------|--------------------|
| T-07-01: GitHub source tampering | HTTPS only; raw.githubusercontent.com URL |
| T-07-02: Runs as root | Idempotency guards on all system ops; no further `sudo` inside script |
| T-07-03: Env file disclosure | Mode 600 root:root; only placeholder values |
| T-07-04: DoS on re-run | All guards in place (swap, user, Node, repo) |
| T-07-05: Sudoers escalation | Narrowly scoped to `write-env.sh` only |
| T-07-06: setup_complete not initialized | Explicitly initialized via sqlite3 CLI |

## Self-Check: PASSED

- [x] `scripts/install.sh` exists at correct path
- [x] Mode 100755 confirmed in git index (`git ls-files -s scripts/install.sh`)
- [x] Commit 7555f72 exists: `feat(07-01): add install.sh one-command Ubuntu 22.04 bootstrap`
- [x] `grep -n "sqlite3.*setup_complete"` returns hit (line 154)
- [x] `grep -n "INSERT OR REPLACE INTO app_meta"` returns hit (line 146)
- [x] `grep -n "CREATE TABLE IF NOT EXISTS app_meta"` returns hit (line 142)
- [x] `grep -n "chown.*SERVICE_USER.*DB_PATH"` returns hit (line 149)
- [x] `bash -n scripts/install.sh` passes (Syntax OK)
- [x] No file deletions in commit (verified via `git diff --diff-filter=D`)
- [x] Script is 220 lines (exceeds 100-line minimum from plan)
