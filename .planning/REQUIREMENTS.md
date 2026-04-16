# Requirements: Claude Usage Optimizer

**Defined:** 2026-04-16
**Core Value:** The scheduled anchor send fires at the midpoint of the detected 4-hour peak block, guaranteeing two consecutive 5-hour windows span the user's peak usage period.

## v1 Requirements

### Scheduling

- [ ] **SCHED-01**: System recomputes the optimal schedule at 03:00 UTC daily using all historical `status='ok'` snapshots.
- [ ] **SCHED-02**: Peak detection buckets snapshot deltas by user-local hour-of-day using the configured IANA timezone (default `America/Los_Angeles`).
- [ ] **SCHED-03**: Peak detection slides a 4-hour window across 24 hourly buckets (wrapping midnight) and picks the block with the largest delta sum.
- [ ] **SCHED-04**: Daily anchor fire time equals the peak-block midpoint plus a 5-minute safety offset.
- [ ] **SCHED-05**: Daily schedule contains 5 fire times spaced every 5 hours, all wrapping past midnight so no fire is dropped.
- [ ] **SCHED-06**: Non-anchor fires receive 0–5 minute jitter; the anchor fire is exact.
- [ ] **SCHED-07**: Tied peak blocks resolve deterministically — midpoint closest to 12:00 local wins, earliest breaks further ties.
- [ ] **SCHED-08**: With fewer than 3 days of snapshot data, scheduler falls back to the configured `default_seed_time` (default `05:05`).
- [ ] **SCHED-09**: When `schedule_override_start_time` is set, peak detection is skipped and the override acts as the anchor.
- [ ] **SCHED-10**: On restart, any missed fire within the last 15 minutes fires immediately; older misses are skipped.
- [ ] **SCHED-11**: An in-process 60-second tick loop invokes the sender for any fire time whose timestamp is ≤ now and not yet marked done today.
- [ ] **SCHED-12**: User can globally pause automatic sending via a dashboard toggle; scheduler honors pause state on every tick.

### Sending

- [ ] **SEND-01**: Sends invoke `claude -p "<question>" --model haiku` via `child_process.spawn`.
- [ ] **SEND-02**: Each send has a 60-second timeout; timeouts are logged as failures.
- [ ] **SEND-03**: Failed sends are retried automatically with exponential backoff, bounded to the current 5-hour window so no retry fires into the next window.
- [ ] **SEND-04**: Every send attempt writes a row to `send_log` with fired_at, scheduled_for, is_anchor, status, duration_ms, question, response_excerpt, error_message.
- [ ] **SEND-05**: User can trigger a manual send from the dashboard; manual sends write a `send_log` row with `scheduled_for=NULL`.
- [ ] **SEND-06**: `QUESTIONS` rotation from the existing Python sender is ported verbatim into the Node sender.

### Data

- [ ] **DATA-01**: `usage_snapshots` persists the raw API payload verbatim in a `raw_json` column.
- [ ] **DATA-02**: Simplified schema columns are exactly `(id, timestamp, status, endpoint, response_status, raw_json, error_message)` with indexes on `timestamp` and `status`.
- [ ] **DATA-03**: `send_log` table persists send attempts separately from snapshots.
- [ ] **DATA-04**: `app_meta` key-value store holds `schedule_fires`, `schedule_fires_done`, `schedule_generated_at`, `peak_block`, `schedule_override_start_time`, `peak_window_hours`, `anchor_offset_minutes`, `default_seed_time`, `user_timezone`, `schema_version`, `paused`.
- [ ] **DATA-05**: A one-shot idempotent migrator runs at startup; it preserves existing `raw_json` (no re-fetch from claude.ai) and marks completion via `schema_version='simplified-v1'`.
- [ ] **DATA-06**: Dashboard read queries derive fields from `raw_json` via `json_extract` or `JSON.parse` + `normalizeUsagePayload`.
- [ ] **DATA-07**: Nightly at 04:15 UTC, SQLite performs an online `.backup`, gzips the result, and uploads to a GCS bucket.
- [ ] **DATA-08**: GCS lifecycle rule deletes backup objects older than 30 days.

### Dashboard UI

- [ ] **UI-01**: Dashboard renders an Optimal Schedule card showing the detected peak block, today's 5 fires (time + status), and next-fire countdown.
- [ ] **UI-02**: Dashboard renders an Overrides section exposing `schedule_override_start_time`, `peak_window_hours` (3–6), `anchor_offset_minutes` (0–15), `default_seed_time`, `user_timezone` as form inputs.
- [ ] **UI-03**: Saving any override writes to `app_meta` and triggers an immediate schedule recompute.
- [ ] **UI-04**: Dashboard renders a Send History panel showing the last 20 `send_log` rows (fired_at, status, duration, response excerpt).
- [ ] **UI-05**: Dashboard shows a "Send now" button that fires a send immediately.
- [ ] **UI-06**: Dashboard shows a Pause toggle that pauses/resumes automatic sending.
- [ ] **UI-07**: Dashboard renders a Tomorrow's Schedule preview showing the 5 predicted fire times for the next day.
- [ ] **UI-08**: Existing dashboard panels (heatmap, hourly bars, usage timeline, extra-usage card) continue to render correctly under the new read path.

### Installation

- [ ] **INSTALL-01**: A single-command bootstrap shell installer (`curl … | bash`) provisions the VM end-to-end: system packages, 2 GB swap, Node 20, Claude Code CLI, the app, systemd unit, backup timer.
- [ ] **INSTALL-02**: A first-run web wizard collects OAuth token, claude.ai auth (cookie/bearer), user timezone, GCS bucket name; writes env files; starts services.
- [ ] **INSTALL-03**: Bootstrap installer is idempotent — rerunning it is safe.
- [ ] **INSTALL-04**: Installation documentation is concise enough that a non-technical user can complete VM provisioning → running app in under 30 minutes.

### Notifications

- [ ] **NOTIFY-01**: On send failure after retry exhaustion, system sends a notification via ntfy.sh or Discord webhook.
- [ ] **NOTIFY-02**: On scheduler stall (no tick for >5 minutes), system sends a notification.
- [ ] **NOTIFY-03**: Notification destination (webhook URL, channel, provider) is configurable via `app_meta`.

### Deployment

- [ ] **DEPLOY-01**: App runs as a single systemd unit `claude-tracker.service`.
- [ ] **DEPLOY-02**: Next.js server binds to `127.0.0.1:3018` only; never public.
- [ ] **DEPLOY-03**: Authentication uses `CLAUDE_CODE_OAUTH_TOKEN` from `/etc/claude-sender.env`; `--bare` mode is never used.
- [ ] **DEPLOY-04**: Target host is GCP e2-micro Always-Free VM in `us-central1` running Ubuntu 22.04 LTS with 30 GB pd-standard.
- [ ] **DEPLOY-05**: A 2 GB swap file is provisioned to mitigate the 1 GB RAM limit.
- [ ] **DEPLOY-06**: Python sender (`Claude Message Sender/`) and the stale root `claude-usage-tracker/` duplicate are deleted.

### Quality

- [ ] **QUAL-01**: Unit tests cover `peak-detector`, `schedule`, `sender`, `scheduler` modules with synthetic fixtures for ties, midnight wrap, insufficient data, catch-up, override short-circuit.
- [ ] **QUAL-02**: Manual dev-loop verification is documented: seed 7-day synthetic snapshots → dashboard renders → pin override to fire in 2 min → verify `send_log` row.
- [ ] **QUAL-03**: Post-deploy VM verification is documented: service healthy, CLI authenticated, scheduler ticking, first fire lands in `send_log`, nightly backup lands in GCS.
- [ ] **QUAL-04**: `HOSTING-STRATEGY.md` is rewritten to single-service deployment (drops Phase 3.6–3.7 Python steps).

## v2 Requirements

Deferred to future release.

### Scheduling

- **V2-SCHED-01**: Day-of-week-specific schedules (separate peak detection per weekday row of the 7×24 heatmap).
- **V2-SCHED-02**: Lifestyle-change detection / date-range exclusion from peak calc.

### Sending

- **V2-SEND-01**: Per-question customization beyond the existing rotation (user-configurable question list in dashboard).

## Out of Scope

| Feature | Reason |
|---------|--------|
| Multi-user support | Single-user-per-VM architecture; adds secrets-per-account complexity not needed for the individual use case |
| Public dashboard exposure | No auth layer; keeps binding to `127.0.0.1` with SSH tunnel / Tailscale as the only access path |
| API-key authentication via `claude --bare` | Bypasses Pro/Max 5-hour window — the whole mechanism the project exists to manipulate |
| Browser-automation sender (`_with_browser.py`, pyautogui) | Deprecated; hard-coded pixel coordinates are fragile; deleted with the rest of the Python sender |
| Playwright / headless-browser deps | Not needed now that CLI sends hit the same 5-hour window; adds Chromium download weight |
| Day-of-week schedules (v2) | Single global schedule is simpler; revisit once multi-week data reveals meaningful weekday variance |
| Retry logic beyond the current 5-hour window | A retry that fires into the next window defeats the purpose of window alignment |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| (populated by /gsd-plan-phase) | — | Pending |

**Coverage:**
- v1 requirements: 45 total
- Mapped to phases: 0 (pre-roadmap)
- Unmapped: 45 ⚠️ (expected pre-roadmap)

---
*Requirements defined: 2026-04-16*
*Last updated: 2026-04-16 after initial definition*
