---
phase: 07-installer-onboarding
verified: 2026-04-27T12:00:00Z
status: human_needed
score: 9/9 must-haves verified
re_verification:
  previous_status: gaps_found
  previous_score: 7/9
  gaps_closed:
    - "Claude Code CLI install step added to install.sh (command -v guard + npm install -g @anthropic-ai/claude-code)"
    - "HOSTING-STRATEGY.md updated: Step 4 now shows the single curl | bash command; Steps 5-7 replaced with setup wizard instructions"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Timed non-technical-user dry-run"
    expected: "A user starting with only a GCP account and OAuth token reaches a running app at http://127.0.0.1:3018 with the setup wizard in under 30 minutes"
    why_human: "Requires provisioning a real GCP e2-micro VM, running the installer, and measuring wall-clock time. Cannot be verified programmatically."
  - test: "Setup wizard end-to-end flow"
    expected: "After submitting the wizard form, credentials are written to /etc/claude-sender.env, the claude-tracker service restarts, and the user is redirected to the dashboard with no setup gate"
    why_human: "Requires a running VM with sudo/systemd to invoke write-env.sh; cannot be tested in the repo without root access."
---

# Phase 7: Installer & Onboarding — Re-Verification Report

**Phase Goal:** A non-technical user can go from "I have a GCP account and an OAuth token" to "running app on 127.0.0.1:3018 via SSH tunnel" in under 30 minutes using one `curl … | bash` command plus a first-run web wizard that collects the remaining secrets in a browser form.
**Verified:** 2026-04-27
**Status:** human_needed
**Re-verification:** Yes — after gap closure (previous score 7/9, both gaps now closed)

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | curl \| bash installer installs system packages, provisions swap, Node 20, Claude Code CLI, clones/builds app, installs systemd unit, and seeds DB end-to-end (ROADMAP SC-1) | VERIFIED | install.sh lines 87–95: `[4b/14]` step added — `command -v claude` guard then `npm install -g @anthropic-ai/claude-code`. Syntax OK (`bash -n`). All 14 main steps present. |
| 2 | Installer creates swap, Node 20, clone, build, systemd unit, sudoers — all idempotently (INSTALL-01, INSTALL-03) | VERIFIED | Every mutating step has an explicit guard. INSERT OR REPLACE for DB. `npm ci` and `npm run build` always safe to re-run. |
| 3 | Re-running installer is safe and exits cleanly (INSTALL-03) | VERIFIED | All 14 steps have guard conditions confirmed in previous verification; no regressions found. |
| 4 | After installer completes, first-run wizard is available because app_meta.setup_complete='false' is seeded in DB | VERIFIED | install.sh lines 151–173: sqlite3 heredoc creates `app_meta` and inserts `setup_complete='false'` with verification grep. DB chowned to claude-tracker. |
| 5 | User visits http://127.0.0.1:3018 and is redirected to /setup if setup_complete is not 'true' (INSTALL-02) | VERIFIED | src/proxy.ts: imports `getAppMeta`, reads `meta.get('setup_complete')`, redirects to /setup if not 'true'. D-09 enforced. |
| 6 | Setup form collects OAuth token, usage auth (cookie/bearer toggle), timezone, GCS bucket | VERIFIED | src/app/setup/page.tsx: 5 fields with proper labels, required markers, Tailwind styling. POSTs to /api/setup. |
| 7 | Form submission writes staging file and invokes sudo helper via safe execFileNoThrow | VERIFIED | src/app/api/setup/route.ts: `execFileNoThrow` imported and invoked with array args. `force-dynamic` export present. |
| 8 | On success, setup_complete is written to app_meta and user is redirected to dashboard | VERIFIED | route.ts: `setAppMeta(config, 'setup_complete', 'true')` before sudo call; rollback on failure; client redirects via `router.push('/')`. |
| 9 | Installation documentation walks through the flow concisely enough for under-30-minute completion (INSTALL-04 / ROADMAP SC-5) | VERIFIED | HOSTING-STRATEGY.md Step 4 now shows the single `bash <(curl -fsSL .../install.sh)` command. Step 5 describes SSH tunnel + browser wizard. Old manual Steps 5–7 replaced with wizard instructions. |

**Score:** 9/9 truths verified

---

## Gaps Closed Since Previous Verification

| Gap | Fix Applied | Verification |
|-----|-------------|-------------|
| Claude Code CLI not in install.sh | Lines 87–95: `[4b/14]` step with `command -v claude` guard + `npm install -g @anthropic-ai/claude-code` | grep confirms both idempotency guard and install command; `bash -n` syntax check passes |
| HOSTING-STRATEGY.md still had old manual instructions | Step 4 rewritten to single `curl | bash` line. Step 5 replaced with tunnel + wizard instructions. Note added that old Steps 5–7 are handled by installer/wizard | `grep 'install\.sh' HOSTING-STRATEGY.md` confirms curl line present at line 81 |

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `scripts/install.sh` | One-command bootstrap | VERIFIED | 235 lines, executable. All 14 steps + Step 4b (Claude CLI). All idempotency guards present. |
| `scripts/write-env.sh` | Privileged env helper | VERIFIED | Syntax OK. Fixed paths. chmod 600 + chown root:root. systemctl restart. rm staging. |
| `src/proxy.ts` | Setup gate proxy | VERIFIED | Reads getAppMeta. Redirects on incomplete setup. D-09 enforced. |
| `src/app/setup/page.tsx` | Setup wizard UI | VERIFIED | 5 fields. POST to /api/setup. Loading/error states. Tailwind styled. |
| `src/app/api/setup/route.ts` | Setup API POST endpoint | VERIFIED | Input validation. Newline injection guard. staging file mode 0o640. execFileNoThrow safe invocation. |
| `src/utils/execFileNoThrow.ts` | Safe subprocess utility | VERIFIED | Array args. Never throws. Returns status/stdout/stderr. |
| `HOSTING-STRATEGY.md` | Non-technical user installation guide | VERIFIED | Step 4 shows single curl command; Step 5 shows SSH tunnel + wizard flow. |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| install.sh syntax | `bash -n scripts/install.sh` | Exit 0 | PASS |
| write-env.sh syntax | `bash -n scripts/write-env.sh` | Exit 0 | PASS |
| Claude Code CLI install in install.sh | `grep 'npm install -g @anthropic-ai/claude-code' scripts/install.sh` | Line 91 match | PASS |
| Claude Code idempotency guard | `grep 'command -v claude' scripts/install.sh` | Line 89 match | PASS |
| curl installer in HOSTING-STRATEGY.md | `grep 'install\.sh' HOSTING-STRATEGY.md` | Line 81 match | PASS |
| proxy.ts reads getAppMeta | `grep 'getAppMeta' src/proxy.ts` | Lines 4, 19 | PASS |
| setup route force-dynamic | `grep 'force-dynamic' src/app/api/setup/route.ts` | Line 8 | PASS |
| execFileNoThrow array-form usage | `grep 'execFileNoThrow' src/app/api/setup/route.ts` | Lines 6, 112 | PASS |

---

## Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| INSTALL-01 | Single-command bootstrap installer | SATISFIED | install.sh 235 lines; covers all provisioning steps including Claude CLI |
| INSTALL-02 | First-run web wizard collects credentials, writes env, starts services | SATISFIED | proxy.ts + setup/page.tsx + api/setup/route.ts + write-env.sh all wire correctly |
| INSTALL-03 | Installer is idempotent | SATISFIED | All steps have guard conditions; re-run safe |
| INSTALL-04 | Docs concise enough for under-30-min completion | SATISFIED (pending human timing) | HOSTING-STRATEGY.md now shows single curl command and wizard-based completion flow |

---

## Anti-Patterns Found

None blocking. Previous blockers resolved.

| File | Pattern | Severity | Notes |
|------|---------|----------|-------|
| `src/app/api/setup/route.ts` line 108 | setup_complete written before sudo helper (CR-02 design decision) | INFO | Intentional: prevents lost-write race if restart kills process; rollback on failure implemented |

---

## Human Verification Required

### 1. Timed Non-Technical-User Dry-Run

**Test:** Provision a fresh GCP e2-micro Ubuntu 22.04 VM, run `bash <(curl -fsSL https://raw.githubusercontent.com/elliotdrel/claude-usage-optimizer/main/scripts/install.sh)`, then visit http://127.0.0.1:3018 via SSH tunnel and complete the setup wizard.
**Expected:** Total elapsed time under 30 minutes from having GCP account + OAuth token in hand.
**Why human:** Requires real VM, real systemd, real wall-clock measurement. Programmatically untestable.

### 2. Setup Wizard End-to-End Flow

**Test:** After installer completes on a real VM, submit the wizard form with valid OAuth token, session cookie, timezone, and optional GCS bucket.
**Expected:** Credentials written to `/etc/claude-sender.env` (mode 600 root:root), `claude-tracker` service restarts cleanly, browser redirects to dashboard with no setup redirect on subsequent visits.
**Why human:** Requires root/sudo, live systemd, real SQLite DB write — unavailable in the development environment.

---

## Summary

All 9 observable truths now verified. Both gaps from the initial verification are closed:

**Gap 1 (Claude Code CLI):** `install.sh` Step 4b added at lines 87–95 — idempotent `command -v claude` guard followed by `npm install -g @anthropic-ai/claude-code`. The sender pipeline's dependency on the `claude` binary is now satisfied by the installer.

**Gap 2 (Documentation):** `HOSTING-STRATEGY.md` Step 4 now presents the single `curl | bash` command with a full bullet-list of what it installs. Step 5 describes the SSH tunnel and browser wizard flow. The old manual Steps 5–7 are acknowledged as superseded by a note. A non-technical user following this document will land in the wizard without any manual provisioning.

The only remaining items are human-only tests (real VM timing and live systemd invocation) that cannot be verified programmatically.

---

_Verified: 2026-04-27_
_Verifier: Claude (gsd-verifier)_
