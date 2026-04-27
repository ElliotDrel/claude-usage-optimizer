# Phase 7: Installer & Onboarding - Context

**Gathered:** 2026-04-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver the install story: a single `curl … | bash` command fully provisions a fresh GCP e2-micro Ubuntu 22.04 VM (packages, swap, Node, clone, build, systemd), and a first-run web wizard collects the two required auth secrets, writes the env file via a privileged helper, and starts the service — so a non-technical user reaches a running app at `127.0.0.1:3018` in under 30 minutes.

No new product features. No new dashboard panels. This phase is install automation and onboarding UX only.

</domain>

<decisions>
## Implementation Decisions

### Installer Script
- **D-01:** The `curl … | bash` script fully automates everything in HOSTING-STRATEGY.md Step 4: apt packages (`git`, `sqlite3`, `curl`), 2 GB swap (idempotent guard), Node.js 20 via NodeSource, gcloud CLI, `git clone` to `/opt/claude-usage-optimizer`, `npm install`, `npm run build`, systemd unit install + enable. User only needs to SSH in and run the one command.
- **D-02:** Installer is idempotent — re-running it is safe. Guards: swap file check (`[ ! -f /swapfile ]`), `useradd` ignores existing user, `systemctl enable` is safe to re-run, `git clone` replaced with `git pull` if the directory already exists.
- **D-03:** Installer ends by writing `app_meta.setup_complete='false'` to the SQLite DB to trigger the first-run wizard, then starts the service. This means the wizard is available immediately after the script finishes.
- **D-04:** GCS bucket creation and lifecycle rule remain manual steps documented in HOSTING-STRATEGY.md Step 9. The installer does not touch GCS.

### Wizard Write Permissions
- **D-05:** The installer (running as root) pre-creates `/etc/claude-sender.env` with placeholder values and mode 600 (owned by root). It also installs a small NOPASSWD sudoers entry that allows the `claude-tracker` service user to run a specific helper script (`/opt/claude-usage-optimizer/scripts/write-env.sh`) with elevated permissions.
- **D-06:** On wizard submit, the Next.js API route writes collected secrets to a staging file under `/opt/claude-usage-optimizer/data/.env-staging` (owned by `claude-tracker`), then invokes the sudo helper using the project's `execFileNoThrow` utility (`src/utils/execFileNoThrow.ts`). The helper merges the staging file into `/etc/claude-sender.env` and runs `systemctl restart claude-tracker`. Staging file is deleted after successful merge.
- **D-07:** The sudo helper is a minimal shell script that accepts no arguments and reads only from the fixed staging file path. No user input is interpolated into shell commands — injection risk is eliminated by design.

### First-Run Detection
- **D-08:** Middleware on the Next.js root route checks `app_meta.setup_complete`. If the value is `'false'` or the key is absent, redirect to `/setup`. Once the wizard completes successfully, it writes `app_meta.setup_complete='true'` — subsequent visits go straight to the dashboard.
- **D-09:** The `/setup` route is only accessible when `setup_complete` is not `'true'`. If someone navigates to `/setup` after setup is done, redirect to the dashboard.

### Wizard Auth Fields
- **D-10:** The wizard always collects **both** auth credentials explicitly:
  - **Field 1 — OAuth token** (`CLAUDE_CODE_OAUTH_TOKEN`): for the `claude` CLI sender. Label: "Claude Code OAuth Token".
  - **Field 2 — Usage auth**: either a session cookie (`CLAUDE_SESSION_COOKIE`) or bearer token (`CLAUDE_BEARER_TOKEN`) for the usage data collector. The wizard offers a toggle (cookie vs bearer) since users may have one or the other. Label: "Claude.ai Usage Auth".
- **D-11:** The wizard also collects `user_timezone` (IANA string, default `America/Los_Angeles`) and `GCS_BACKUP_BUCKET` (optional — user can skip and configure later via the dashboard).

### Claude's Discretion
- Exact sudoers entry format and whether to use a separate sudoers.d file or inline entry
- Whether the wizard UI is a single-page scrollable form or a multi-step wizard with progress steps
- How the wizard validates the OAuth token before submitting (e.g., test `claude --version` or accept on trust)
- Whether to show inline help text explaining how to get each credential

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Install requirements
- `REQUIREMENTS.md` — INSTALL-01, INSTALL-02, INSTALL-03, INSTALL-04

### Existing deployment docs (installer automates these steps)
- `HOSTING-STRATEGY.md` — Step 4 (packages, swap, Node, clone, build) and Steps 5–7 (env file, service user, systemd) are what the installer automates. Step 9 (GCS) remains manual.

### Prior phase decisions
- `.planning/phases/06-vm-deployment-hardening/06-CONTEXT.md` — D-03 (GCS lifecycle deferred to Phase 7), D-09 (service user `claude-tracker`), D-10 (`/etc/claude-sender.env`), D-11 (HOSTNAME=127.0.0.1, PORT=3018)

### Config and auth
- `src/lib/config.ts` — Shows the two auth paths: `CLAUDE_SESSION_COOKIE` (cookie mode) and `CLAUDE_BEARER_TOKEN` / auto-read from credentials file (bearer mode). Both are supported by the collector.
- `src/lib/auth-diagnostics.ts` — Auth failure messages and preflight checks relevant to what the wizard needs to surface if auth is wrong.

### Safe subprocess execution
- `src/utils/execFileNoThrow.ts` — Project utility for safe subprocess calls (uses execFile, not exec). Use this when the wizard API route invokes the sudo helper. Never use exec() with interpolated strings.

### App meta keys
- `.planning/phases/04-scheduler-wiring/04-CONTEXT.md` — Documents the `app_meta` key-value store pattern. `setup_complete` is a new key added by this phase.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/db.ts` — `app_meta` key-value read/write helpers; `setup_complete` key follows the same pattern as `paused`, `last_tick_at`, etc.
- `src/lib/config.ts` — `getConfig()` reads `CLAUDE_SESSION_COOKIE`, `CLAUDE_BEARER_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN` from env. The wizard writes these to `/etc/claude-sender.env`; systemd picks them up on restart.
- `src/utils/execFileNoThrow.ts` — Safe subprocess utility; use for the sudo helper invocation in the wizard API route.
- `claude-tracker.service` — Existing systemd unit file. Installer copies it to `/etc/systemd/system/` and enables it.

### Established Patterns
- `app_meta` key-value store: all runtime flags live here. `setup_complete` is a boolean string flag following the `paused='true'/'false'` pattern.
- Safe subprocess calls use `execFileNoThrow` — never raw `exec()` with string interpolation.

### Integration Points
- Root route middleware: checks `app_meta.setup_complete` before rendering the dashboard. New `/setup` page and `/api/setup` POST endpoint added in this phase.
- `instrumentation.ts`: already starts the scheduler and backup job. Wizard completion triggers `systemctl restart`, which re-runs instrumentation — no changes to `instrumentation.ts` needed.

</code_context>

<specifics>
## Specific Ideas

- The installer script should be committed to the repo at `scripts/install.sh` so the GitHub raw URL is the `curl` source. The HOSTING-STRATEGY.md Step 4 block is replaced with the single `curl` command.
- The wizard's 30-minute UX bar (INSTALL-04) means the form must be fast and forgiving — a single scrollable form with clear section headers is preferred over multi-screen wizards.
- The sudo helper must be narrow: reads only from the fixed staging file path, accepts no arguments, no user input interpolated into shell commands.

</specifics>

<deferred>
## Deferred Ideas

- GCS bucket creation automation — user still follows manual steps in HOSTING-STRATEGY.md Step 9; could be automated in v2
- Wizard token validation (e.g., test `claude --version` before accepting the form) — deferred to Claude's discretion
- ntfy.sh / Slack webhook support — deferred from Phase 6, still v2

</deferred>

---

*Phase: 07-installer-onboarding*
*Context gathered: 2026-04-27*
