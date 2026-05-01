# Roadmap: Claude Usage Optimizer

## Overview

Rebuild the two-subproject (Python sender + Next.js tracker) system into a single Next.js application that observes Claude.ai usage, computes an optimal daily send schedule from detected 4-hour peak blocks, and automatically fires sends via the `claude` CLI so one 5-hour window boundary lands at the midpoint of the peak — letting the user drain two consecutive 5-hour budgets across their peak period. The rebuild proceeds in the sequence prescribed by the design spec §8: DB foundation first (schema simplification + migrator), then pure algorithm modules, then the sender, then scheduler wiring, then dashboard panels, then VM deployment and hardening, then the non-technical-user installer/onboarding wizard, and finally a dedicated quality/acceptance phase. Each phase is a committable checkpoint; the system is usable (at progressively higher fidelity) after every phase.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation & DB Refactor** - Delete legacy trees, land simplified schema + one-shot migrator, move normalization to the read path so existing dashboard panels keep rendering. *(Completed 2026-04-19)*
- [x] **Phase 2: Algorithm Core (Pure Modules)** - Ship `peak-detector.ts` and `schedule.ts` as pure, fully-tested functions with no runtime wiring. *(Completed 2026-04-20)*
- [x] **Phase 3: Sender Module** - Implement Node-side `sender.ts` (spawn `claude -p`, no retries per design spec §10, `send_log` writes) plus `POST /api/send-now` for manual-fire testing. *(Completed 2026-04-20)*
- [x] **Phase 4: Scheduler Wiring** - Land `scheduler.ts`, register the 60-second tick loop in `instrumentation.ts`, wire nightly 03:00 UTC recompute + catch-up-on-restart + pause toggle. *(Completed 2026-04-21)*
- [x] **Phase 5: Dashboard Control Surface** - Add Optimal Schedule card, Overrides form, Send History panel, Send Now button, Pause toggle, Tomorrow's Schedule preview. *(Completed 2026-04-22)* ✓
- [x] **Phase 6: VM Deployment & Hardening** - Single `claude-tracker.service` systemd unit, `127.0.0.1:3018` bind, OAuth token auth, nightly GCS backup, failure notifications, rewritten `HOSTING-STRATEGY.md`. *(Completed 2026-04-23)*
- [x] **Phase 7: Installer & Onboarding** - One-command `curl … | bash` bootstrap installer plus first-run web wizard so a non-technical user can reach a running app in under 30 minutes. *(Completed 2026-04-28)*
- [x] **Phase 8: Quality & Acceptance** - Comprehensive unit-test coverage for the four new modules plus documented manual dev-loop verification against a synthetic 7-day fixture. *(Completed 2026-05-01)*
- [x] **Phase 9: Integration Gap Closure** - Mount Next.js setup gate middleware so first-run wizard activates on first browser visit; parameterize peakDetector to consume `peak_window_hours` from app_meta so user override takes effect. (2026-05-01)

## Phase Details

### Phase 1: Foundation & DB Refactor
**Goal**: The repo contains exactly one tracker tree running on the simplified `(id, timestamp, status, endpoint, response_status, raw_json, error_message)` schema, with all existing dashboard panels still rendering correctly off the new read path.
**Depends on**: Nothing (first phase)
**Requirements**: DATA-01, DATA-02, DATA-05, DATA-06, UI-08, DEPLOY-06
**Success Criteria** (what must be TRUE):
  1. The `Claude Message Sender/` directory and the stale root-level `claude-usage-tracker/` duplicate are both removed from the repo, leaving exactly one canonical tracker tree.
  2. `usage_snapshots` has exactly the simplified seven columns plus indexes on `timestamp` and `status`; the one-shot migrator rewrites existing rows in place without re-fetching from claude.ai and marks `app_meta.schema_version='simplified-v1'`.
  3. Re-running the app after migration is a no-op (migrator is idempotent).
  4. Every existing dashboard panel (heatmap, hourly bars, usage timeline, extra-usage card) still renders correctly, now sourcing its fields from `raw_json` via `queries.ts`.
  5. No structured-column reads remain anywhere in the codebase — all reads go through `queries.ts` or `json_extract`.
**Plans**: 5 plans
Plans:
- [x] 01-01-PLAN.md — Delete Claude Message Sender/ and claude-usage-tracker/.env.local (DEPLOY-06)
- [x] 01-02-PLAN.md — Simplified schema, SnapshotRow, insertSnapshot, idempotent migrator, db.test.ts (DATA-01, DATA-02, DATA-05)
- [x] 01-03-PLAN.md — Create queries.ts (ParsedSnapshot, parseSnapshot, parseSnapshots) and queries.test.ts (DATA-06)
- [x] 01-04-PLAN.md — Simplify collector.ts write path + collector-singleton.ts demo seeder (DATA-01)
- [x] 01-05-PLAN.md — Route analysis.ts through ParsedSnapshot, wire dashboard/route.ts, update analysis.test.ts (DATA-06, UI-08)

### Phase 2: Algorithm Core (Pure Modules)
**Goal**: Peak detection and schedule generation exist as pure, independently-tested functions that, given snapshots and options, return a deterministic peak block and a 5-fire daily chain — with no runtime wiring yet.
**Depends on**: Phase 1
**Requirements**: SCHED-02, SCHED-03, SCHED-04, SCHED-05, SCHED-06, SCHED-07, SCHED-08, SCHED-09
**Success Criteria** (what must be TRUE):
  1. `peak-detector.ts` accepts a list of snapshots plus an IANA timezone and returns either a `{ peakBlock, midpoint }` object or `null` when fewer than 3 days of data exist.
  2. Given a known 7-day synthetic fixture with an obvious 4-hour peak block, `peak-detector` returns that block's indices and midpoint — including cases where the peak wraps midnight (e.g., 22:00–02:00).
  3. Tied peak blocks resolve deterministically to the midpoint closest to 12:00 local, with earliest-block as the secondary tiebreaker.
  4. `schedule.ts` produces exactly 5 fire times spaced 5h apart (all wrapping past 24h), with the anchor set to midpoint + `:05` exactly and non-anchor fires jittered 0–5 minutes.
  5. When `schedule_override_start_time` is supplied, `schedule.ts` short-circuits peak detection and treats the override as the anchor.

**Plans**: 2 plans
Plans:
- [x] 02-01-PLAN.md — peak-detector.ts + peak-detector.test.ts (SCHED-02, SCHED-03, SCHED-07, SCHED-08)
- [x] 02-02-PLAN.md — schedule.ts + schedule.test.ts (SCHED-04, SCHED-05, SCHED-06, SCHED-09)

### Phase 3: Sender Module
**Goal**: A single `POST /api/send-now` call spawns `claude -p` under a 60s timeout, writes every attempt to `send_log`, and is manually invokable from the dashboard or via curl. **Note:** SEND-03 (retry logic) is superseded by design spec §10 and is out of scope; see CONTEXT.md D-01.
**Depends on**: Phase 1
**Requirements**: SEND-01, SEND-02, SEND-03, SEND-04, SEND-05, SEND-06, DATA-03
**Success Criteria** (what must be TRUE):
  1. `POST /api/send-now` spawns `claude -p "<question>" --model haiku` via `child_process.spawn` using a question drawn from the ported `QUESTIONS` rotation constant.
  2. Every send attempt — success, error, or timeout — writes a row to the new `send_log` table capturing fired_at, scheduled_for, is_anchor, status, duration_ms, question, response_excerpt, and error_message.
  3. (SEND-03: No retries. Design spec §10 explicitly excludes retry logic; failed sends are logged with status='error' and the next scheduled slot is honored.)
  4. A send that exceeds 60s is killed and logged with `status='timeout'`.
  5. Manual-fire invocations write `send_log` rows with `scheduled_for=NULL` so they're distinguishable from scheduled fires.

**Plans**: 3 plans
Plans:
- [x] 03-01-PLAN.md — Add send_log table DDL, SendLogRow interface, insertSendLog() helper to db.ts; schema test to db.test.ts (DATA-03)
- [x] 03-02-PLAN.md — Create sender.ts with send() function and QUESTIONS constant; test send_log write logic in sender.test.ts (SEND-01, SEND-02, SEND-04, SEND-06, SEND-03)
- [x] 03-03-PLAN.md — Create POST /api/send-now route handler (SEND-05)

### Phase 4: Scheduler Wiring
**Goal**: An in-process 60-second tick loop registered in `instrumentation.ts` fires the sender for matching scheduled slots, recomputes the schedule nightly at 03:00 UTC, catches up on recent missed fires after restart, and honors a global pause toggle.
**Depends on**: Phase 2, Phase 3
**Requirements**: SCHED-01, SCHED-10, SCHED-11, SCHED-12, DATA-04
**Success Criteria** (what must be TRUE):
  1. `scheduler.ts` is registered in `instrumentation.ts` (gated behind `ENABLE_SCHEDULER=true` during development) and its 60s tick invokes the sender for any fire whose timestamp is ≤ now and not yet recorded in `schedule_fires_done`.
  2. At 03:00 UTC daily, the scheduler reads all historical `status='ok'` snapshots, recomputes the peak block and fire chain, and persists the result to the documented `app_meta` keys (`schedule_fires`, `schedule_fires_done`, `schedule_generated_at`, `peak_block`, etc.).
  3. On process restart, a fire missed by <15 minutes fires immediately; a fire missed by ≥15 minutes is skipped.
  4. Setting `app_meta.paused='true'` causes every subsequent tick to skip all fires until the flag is cleared; the global state survives restarts.
  5. All required `app_meta` keys from the spec (`schedule_fires`, `schedule_fires_done`, `schedule_generated_at`, `peak_block`, `schedule_override_start_time`, `peak_window_hours`, `anchor_offset_minutes`, `default_seed_time`, `user_timezone`, `schema_version`, `paused`) are read and written by the running system.

**Plans**: 2 plans
Plans:
- [x] 04-01-PLAN.md — Create src/lib/scheduler.ts: initializeAppMeta, startScheduler, catch-up, tick loop, nightly recompute (SCHED-01, SCHED-10, SCHED-11, SCHED-12, DATA-04)
- [x] 04-02-PLAN.md — Wire scheduler in instrumentation.ts + test/scheduler.test.ts with 8 fake-clock tests (SCHED-01, SCHED-10, SCHED-11, SCHED-12, DATA-04)

### Phase 5: Dashboard Control Surface
**Goal**: The dashboard becomes the operational control surface — a user can see the detected peak block, today's fire times with live countdown, tomorrow's preview, the last 20 sends, adjust overrides with immediate recompute, pause automatic sending, and trigger a manual send — without ever touching `journalctl`.
**Depends on**: Phase 4
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05, UI-06, UI-07
**Success Criteria** (what must be TRUE):
  1. The Optimal Schedule card displays the detected peak block (e.g., "Peak: 00:00–04:00, midpoint 02:00"), today's 5 fire times with pending/fired/failed status, and a live next-fire countdown.
  2. An Overrides section exposes `schedule_override_start_time`, `peak_window_hours` (3–6), `anchor_offset_minutes` (0–15), `default_seed_time`, and `user_timezone` as form inputs; saving any value writes through to `app_meta` and triggers an immediate schedule recompute visible in the card within seconds.
  3. The Send History panel lists the last 20 `send_log` rows with fired_at, status, duration, and response excerpt.
  4. A "Send now" button triggers a manual send and the resulting `send_log` row shows up in the history panel.
  5. A Pause toggle flips `app_meta.paused` and the scheduler visibly stops firing sends until the toggle is flipped back.
  6. A Tomorrow's Schedule preview shows the 5 predicted fire times for the next day alongside today's.
**Plans**: 3 plans
Plans:
- [x] 05-01-PLAN.md — Extend GET /api/dashboard with scheduleData + sendHistory, create PATCH /api/app-meta endpoint with recompute (UI-01, UI-02, UI-03)
- [x] 05-02-PLAN.md — Build OptimalScheduleCard with Today/Tomorrow tabs, live countdown, peak block display (UI-01, UI-07)
- [x] 05-03-PLAN.md — Build ScheduleOverridesPanel, SendHistoryPanel, SendNowButton, PauseToggle, TimezoneWarningBanner (UI-02, UI-04, UI-05, UI-06)
**UI hint**: yes

### Phase 6: VM Deployment & Hardening
**Goal**: The app runs on a GCP e2-micro VM as a single `claude-tracker.service` bound to `127.0.0.1:3018`, authenticated via `CLAUDE_CODE_OAUTH_TOKEN`, with nightly GCS backups and webhook-based failure notifications — and `HOSTING-STRATEGY.md` reflects this single-service reality.
**Depends on**: Phase 4
**Requirements**: DATA-07, DATA-08, DEPLOY-01, DEPLOY-02, DEPLOY-03, DEPLOY-04, DEPLOY-05, NOTIFY-01, NOTIFY-02, NOTIFY-03, QUAL-03, QUAL-04
**Success Criteria** (what must be TRUE):
  1. `systemctl status claude-tracker` on the GCP e2-micro VM (us-central1, Ubuntu 22.04 LTS, 30 GB pd-standard, 2 GB swap) shows the single service active; no `claude-sender.service` exists.
  2. The app binds to `127.0.0.1:3018` only (never public), authenticates via `CLAUDE_CODE_OAUTH_TOKEN` from `/etc/claude-sender.env`, and `--bare` mode is never used anywhere in the codebase or ops scripts.
  3. At 04:15 UTC nightly, SQLite performs an online `.backup`, gzips the result, and uploads it to a GCS bucket governed by a lifecycle rule that deletes objects older than 30 days.
  4. On send-failure-after-retry-exhaustion and on scheduler stall (>5 min with no tick), the app posts a notification to the configured ntfy.sh or Discord webhook (destination configurable via `app_meta`).
  5. `HOSTING-STRATEGY.md` is rewritten so Phases 3.6–3.7 describe a single-service deployment (no Python venv, no `claude-sender.service`).
  6. A documented post-deploy verification checklist confirms: service healthy, CLI authenticated, scheduler ticking, first fire lands in `send_log`, nightly backup lands in GCS.

**Plans**: 4 plans
Plans:
- [x] 06-01-PLAN.md — In-process backup job: src/lib/backup.ts, backupDatabase() helper, @google-cloud/storage integration (DATA-07, DATA-08)
- [x] 06-02-PLAN.md — Failure notifications: src/lib/notifier.ts, scheduler stall detection, send failure alerts via Discord webhook (NOTIFY-01, NOTIFY-02, NOTIFY-03)
- [x] 06-03-PLAN.md — Systemd service unit and env file template: /etc/systemd/system/claude-tracker.service, /etc/claude-sender.env.example (DEPLOY-01, DEPLOY-02, DEPLOY-03, DEPLOY-04, DEPLOY-05)
- [x] 06-04-PLAN.md — HOSTING-STRATEGY.md rewrite: user-journey structure, copy-pasteable commands, post-deploy verification checklist (QUAL-03, QUAL-04)

### Phase 7: Installer & Onboarding
**Goal**: A non-technical user can go from "I have a GCP account and an OAuth token" to "running app on `127.0.0.1:3018` via SSH tunnel" in under 30 minutes using one `curl … | bash` command plus a first-run web wizard that collects the remaining secrets in a browser form.
**Depends on**: Phase 6
**Requirements**: INSTALL-01, INSTALL-02, INSTALL-03, INSTALL-04
**Success Criteria** (what must be TRUE):
  1. Running `curl <installer-url> | bash` on a fresh Ubuntu 22.04 GCP e2-micro VM installs system packages, provisions 2 GB swap, installs Node 20, installs the Claude Code CLI, clones/builds the app, installs the systemd unit, and installs the backup timer — end-to-end, no manual intervention beyond the single curl invocation.
  2. On first browser visit, the user is presented with a wizard form that collects OAuth token, claude.ai auth (cookie or bearer), user timezone, and GCS bucket name; on submit, the wizard writes the env files and starts services.
  3. Rerunning the `curl … | bash` installer is safe — no duplicate packages, no duplicate systemd units, no destroyed data.
  4. A timed dry-run by a non-technical user confirms the provisioning → running-app path takes under 30 minutes from the moment they have their GCP account + OAuth token in hand.
  5. Installation documentation (in the repo and/or in-wizard inline) walks through the flow in a copy-pasteable sequence with zero prerequisites beyond the GCP account and OAuth token.
**Plans**: TBD
**UI hint**: yes

### Phase 8: Quality & Acceptance
**Goal**: The new module set (`peak-detector`, `schedule`, `sender`, `scheduler`) has comprehensive unit coverage for its edge cases, and a documented manual dev-loop procedure lets any engineer confirm end-to-end correctness against a synthetic 7-day fixture in minutes.
**Depends on**: Phase 4
**Requirements**: QUAL-01, QUAL-02
**Success Criteria** (what must be TRUE):
  1. `test/peak-detector.test.ts`, `test/schedule.test.ts`, `test/sender.test.ts`, and `test/scheduler.test.ts` each exist and pass, covering (at minimum) ties, midnight wrap, insufficient data, catch-up on restart, override short-circuit, timeout handling, and 03:00 UTC recompute.
  2. `npm test` runs the full tracker suite including the new modules, with zero failures.
  3. A documented manual verification procedure (in `README.md` or a dedicated doc) walks through: seed 7 days of synthetic snapshots → start app → observe dashboard renders peak card → pin override to fire in 2 min → observe `send_log` row appears → success.
  4. Running the documented procedure end-to-end takes under 10 minutes for a fresh developer.
**Plans**: 0 (tests written in-phase during Phases 2–4; QUAL-02 delivered as docs/DEV-LOOP.md)

### Phase 9: Integration Gap Closure
**Goal**: Close both critical integration gaps found in the v1.0 audit: mount the setup gate as Next.js middleware so first-run wizard activates on first browser visit, and parameterize `peakDetector` to consume `peak_window_hours` from `app_meta` so the dashboard override actually takes effect.
**Depends on**: Phase 7, Phase 2
**Requirements**: INSTALL-01, INSTALL-02, INSTALL-03, SCHED-03
**Gap Closure:** Closes gaps from v1.0-MILESTONE-AUDIT.md
**Success Criteria** (what must be TRUE):
  1. `src/middleware.ts` exists, exports `setupGate as middleware` from `./proxy`, and includes a matcher that covers all non-API, non-static routes.
  2. On first browser visit with `setup_complete` unset, the middleware redirects to `/setup`; after completing the wizard, subsequent visits reach the dashboard directly.
  3. `peakDetector()` in `src/lib/peak-detector.ts` accepts an optional `windowHours` parameter (default 4).
  4. `scheduler.ts` reads `peak_window_hours` from `app_meta` and passes it to `peakDetector` on every recompute.
  5. Setting `peak_window_hours=5` in the Overrides panel causes the scheduler to use a 5-hour detection window on the next recompute.
  6. `peak-detector.test.ts` covers at least one test case with a non-default window size.
**Plans**: 2/2

## Progress

**Execution Order:**
Phases execute in numeric order. With `parallelization=true`, phases 2 + 3 (both depend only on Phase 1, and neither depends on the other) may run concurrently. Phases 6 and 8 may run concurrently after Phase 4 is complete.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation & DB Refactor | 5/5 | Complete | 2026-04-19 |
| 2. Algorithm Core (Pure Modules) | 2/2 | Complete | 2026-04-20 |
| 3. Sender Module | 3/3 | Complete | 2026-04-20 |
| 4. Scheduler Wiring | 2/2 | Complete | 2026-04-21 |
| 5. Dashboard Control Surface | 3/3 | Complete | 2026-04-22 |
| 6. VM Deployment & Hardening | 4/4 | Complete | 2026-04-23 |
| 7. Installer & Onboarding | 3/3 | Complete | 2026-04-28 |
| 8. Quality & Acceptance | 0/0 | Complete | 2026-05-01 |
| 9. Integration Gap Closure | 2/2 | Complete | 2026-05-01 |

---

*Roadmap created: 2026-04-16*
*Phase 3 planning: 2026-04-20*
*Phase 4 planning: 2026-04-20*
*Phase 4 complete: 2026-04-21*
*Phase 5 planning: 2026-04-21*
*Phase 5 complete: 2026-04-22*
