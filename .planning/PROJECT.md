# Claude Usage Optimizer

## What This Is

A single Next.js application that observes your Claude.ai usage, computes an optimal daily send schedule from historical peak patterns, and automatically fires messages via the `claude` CLI so one 5-hour window boundary lands at the midpoint of your 4-hour peak block — letting you drain two full 5-hour budgets across your peak period instead of one. Hosted on a free GCP e2-micro VM; deployable end-to-end by a non-technical user via a single bootstrap script.

## Core Value

**The scheduled anchor send fires at the midpoint of the detected 4-hour peak block, guaranteeing two consecutive 5-hour windows span your peak usage period.**

Everything else is scaffolding. If this one thing works, the product is valuable.

## Requirements

### Validated

<!-- Capabilities proven by the existing subprojects. V1 preserves these through rebuild. -->

- ✓ Adaptive usage polling against `claude.ai/api/organizations/{orgId}/usage` and `api.anthropic.com/api/oauth/usage` — existing
- ✓ Snapshot persistence in SQLite with raw API JSON already captured per row — existing
- ✓ Hourly bars + 7×24 heatmap computation from snapshot deltas — existing
- ✓ `claude -p "<question>"` subprocess send via the Claude Code CLI — existing (Python)
- ✓ Next.js dashboard rendering (React 19 + Tailwind v4) — existing

### Active

<!-- v1 scope. Everything here ships together. -->

**Algorithm & scheduling**
- [ ] Nightly 03:00 UTC recompute over all historical `status='ok'` snapshots
- [ ] User-local hour-of-day bucketing via IANA timezone (default `America/Los_Angeles`)
- [ ] 4-hour sliding window peak detection with midnight wrap (`(start + i) % 24`)
- [ ] Midpoint + `:05` anchor; 5-fire daily chain wrapping past 24h (fixes current Python overflow bug)
- [ ] Deterministic tiebreak — midpoint closest to 12:00 local wins, earliest breaks further ties
- [ ] `<3` days of data → fall back to `default_seed_time` (default `05:05`)
- [ ] `schedule_override_start_time` short-circuits peak detection when set
- [ ] Catch-up on restart: <15 min late → fire immediately; ≥15 min late → skip
- [ ] Retry logic on failed sends

**Database**
- [ ] Simplified `usage_snapshots`: `(id, timestamp, status, endpoint, response_status, raw_json, error_message)` + indexes on `timestamp` and `status`
- [ ] New `send_log` table for send attempts (fired_at, scheduled_for, is_anchor, status, duration_ms, question, response_excerpt, error_message)
- [ ] New `app_meta` key-value store for schedule state, overrides, timezone, schema_version
- [ ] One-shot idempotent migrator via `schema_version='simplified-v1'` marker — preserves `raw_json`, no re-fetch
- [ ] Read-side `queries.ts` using `json_extract` / `JSON.parse` + `normalizeUsagePayload`

**Runtime (single Next.js app)**
- [ ] Python sender and `Claude Message Sender/` directory deleted
- [ ] Stale root-level `claude-usage-tracker/` build-artifact duplicate deleted
- [ ] In-process scheduler (`setInterval` 60s tick) registered in `instrumentation.ts`
- [ ] Sender spawns `claude -p "<question>" --model haiku` via `child_process.spawn` with 60s timeout
- [ ] One systemd unit (`claude-tracker.service`) — no separate sender service

**Dashboard**
- [ ] Optimal Schedule card: peak block display, 5 fire times with status, next-fire countdown
- [ ] Manual "Send now" button (inserts row with `scheduled_for=NULL`)
- [ ] Overrides section: all `app_meta` keys as form inputs; save triggers recompute
- [ ] Send history panel: last 20 `send_log` rows
- [ ] Pause toggle: globally pause automatic sending
- [ ] Tomorrow's schedule preview

**Onboarding (non-technical-user deployability)**
- [ ] One-command bootstrap shell installer (`curl … | bash`) that provisions the VM end-to-end after GCP account + OAuth token are in hand
- [ ] First-run web wizard: collects OAuth token, claude.ai auth (cookie/bearer), user timezone, GCS bucket name; writes env files; starts services

**Notifications**
- [ ] Failure alerts via ntfy.sh or Discord webhook: send failures after retry exhaustion, scheduler stalls, auth expiry

**Hosting & ops**
- [ ] GCP e2-micro Always-Free VM, `us-central1`, Ubuntu 22.04 LTS, 30 GB pd-standard
- [ ] 2 GB swap file provisioned (mitigates 1 GB RAM vs Anthropic's stated 4 GB minimum)
- [ ] `CLAUDE_CODE_OAUTH_TOKEN` set via `/etc/claude-sender.env`; generated on laptop via `claude setup-token`
- [ ] Nightly SQLite online `.backup` → gzipped → GCS bucket with 30-day lifecycle delete
- [ ] Tracker bound to `127.0.0.1:3018`; access via SSH tunnel or Tailscale only

**Testing**
- [ ] Unit tests: `peak-detector.test.ts`, `schedule.test.ts`, `sender.test.ts`, `scheduler.test.ts`
- [ ] Manual dev-loop verification against synthetic 7-day snapshot fixture
- [ ] Post-deploy VM checks: service healthy, CLI authenticated, first fire reaches `send_log`, nightly backup lands in GCS

**Documentation**
- [ ] `HOSTING-STRATEGY.md` rewritten to reflect single-service deployment (drop Phase 3.6–3.7 Python venv + `claude-sender.service`)

### Out of Scope

- Day-of-week-specific schedules — single global schedule for all days in v1 (design spec §10)
- Lifestyle-change / date-range exclusion from peak calc — rely on natural convergence across all history (design spec §9)
- Per-question customization beyond the existing rotation — port the current `QUESTIONS` list verbatim (design spec §10)
- Multi-user support — one user per VM (design spec §2)
- Public exposure of the dashboard without auth — must stay on `127.0.0.1` (design spec §2)
- API-key auth via `--bare` — would bypass the 5-hour subscription window the project exists to manipulate (design spec §2, hosting §3.1)
- Browser-automation sender (`_with_browser.py`, pyautogui) — deprecated; deleted with Python sender

## Context

**Existing codebase (replaced, not reused):**
Two subprojects live in this repo. Canonical tracker source: `Claude Usage Tracker/claude-usage-tracker/` (Next.js 16 + React 19 + better-sqlite3 in WAL mode; adaptive polling with 4-tier state machine `idle`/`light`/`active`/`burst`). Canonical sender: `Claude Message Sender/claude_message_send_with_CC_CLI.py` (~215 LOC, `schedule` library, fixed 5-hour chain with `start_time` seed). A stale duplicate at root-level `claude-usage-tracker/` contains only build artifacts. `pyautogui` is used in the deprecated `_with_browser.py` variant but absent from `requirements.txt`. Deployment today is Windows-only via PowerShell-registered Scheduled Task.

**Source-of-truth documents:**
- `HOSTING-STRATEGY.md` — hosting, auth, DB simplification, backup strategy, full deployment playbook
- `docs/superpowers/specs/2026-04-16-tracker-sender-merge-design.md` — algorithm, architecture, DB schema, migration plan, testing strategy

**Design decisions already locked (before this project started):**
- Full rebuild authorized — existing code is reference material, not a constraint
- Raw API JSON stored verbatim; all normalization moves to the read path
- Tracker absorbs sender — one Next.js runtime, one systemd unit, one log stream
- OAuth token is the whole architecture: generated on laptop via `claude setup-token` (one-year validity), pasted into VM env file, authenticates against Pro/Max subscription
- All peak computation keyed by user-local time; VM runs in UTC so timezone conversion happens in the scheduler

**Scheduling formula (load-bearing):**
Slide 4-hour window over 24 hourly buckets → max-sum block = peak → midpoint = `block_start + 2h` → anchor = midpoint + `:05` buffer → chain = anchor, +5h, +10h, +15h, +20h (modulo 24h). Result: one 5-hour window ends at the peak midpoint and the next begins immediately — two full budgets span the peak.

**Why `claude setup-token` (not VM-side `claude login`):**
Standard OAuth requires a browser redirect to the same machine. On a headless VM, that redirect target is unreachable. Device-code flow (RFC 8628) is an open feature request (`anthropics/claude-code#22992`) not yet shipped. The `setup-token` command is Anthropic's official workaround — completes OAuth on the laptop, prints a one-year token, set once as `CLAUDE_CODE_OAUTH_TOKEN`.

## Constraints

- **Authentication**: `CLAUDE_CODE_OAUTH_TOKEN` only. Never `ANTHROPIC_API_KEY`, never `claude --bare`. The project's entire purpose is exercising Pro/Max 5-hour windows, which API-key billing bypasses.
- **Hosting**: Must run on a free-forever tier. GCP e2-micro is the chosen target. 1 GB RAM is below Anthropic's stated 4 GB minimum — mitigated by a 2 GB swap file.
- **Deployability**: A non-technical user must be able to install this end-to-end. "Simplicity is a hard requirement, not a nice-to-have." Every automatable step is automated; every remaining step is copy-pasteable and foolproof.
- **Runtime**: Node.js only. No Python. No Playwright. No browser automation.
- **Single-process**: One Next.js app, one systemd unit (`claude-tracker.service`), one log stream (`journalctl -u claude-tracker`).
- **Storage**: SQLite on VM disk (workload is append-only single-writer). Nightly backup to GCS. No more than 24 hours of data loss tolerance.
- **Security**: Dashboard never exposed to the public internet. Bound to `127.0.0.1:3018`, reached via SSH tunnel or Tailscale.
- **Cost**: $0/month target. GCP Always-Free (VM + GCS 5 GB) + OAuth token (Pro/Max subscription already paid).

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Single Next.js app absorbs Python sender | "One product" mandate; kills Python venv + `schedule` lib; one startup, one log stream | — Pending |
| GCP e2-micro (not Oracle Ampere, not Koyeb, not GitHub Actions) | Simplest UX for non-dev (browser SSH, one form); always free; no capacity lottery; no idle reclaim; x64 avoids ARM64 npm gotchas | — Pending |
| OAuth subscription token (not API key, never `--bare`) | Project's whole purpose is manipulating Pro/Max 5-hour windows — API billing bypasses them | — Pending |
| Simplified DB: raw_json + `json_extract` on read | Zero migration debt as claude.ai API evolves; `raw_json` is already captured today | — Pending |
| Full greenfield rebuild authorized | Existing code is reference; simplicity is a hard requirement that existing architecture obstructs | — Pending |
| 4-hour peak window, midpoint + `:05` anchor, chain wraps past 24h | User-specified formula; fixes overflow bug in current Python sender that drops late-day fires | — Pending |
| All-history nightly recompute over user-local buckets | User expects convergence as data accumulates; lifestyle patterns are local, not UTC | — Pending |
| In-process 60s `setInterval` scheduler (not systemd timers) | Single responsibility boundary; no unit regeneration when schedule changes; catch-up-on-restart covers downtime | — Pending |
| Send attempts in separate `send_log` table (not `usage_snapshots`) | Different write cadence, different read patterns; a snapshot is an observation, a send is an action | — Pending |
| Retry logic on failed sends included in v1 | Added 2026-04-16 — a single transient CLI failure shouldn't cost a 5-hour window | — Pending |
| Dashboard as operational control surface | Next send, token health, pause, manual fire, send history — not hidden in `journalctl` | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-16 after initialization*
