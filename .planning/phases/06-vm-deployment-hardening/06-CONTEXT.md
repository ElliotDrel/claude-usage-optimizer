# Phase 6: VM Deployment & Hardening - Context

**Gathered:** 2026-04-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the app production-ready on the GCP e2-micro VM: single `claude-tracker.service` systemd unit bound to `127.0.0.1:3018`, OAuth token auth, nightly GCS backup running in-process, Discord webhook failure notifications, and a fully rewritten `HOSTING-STRATEGY.md` that gives a non-technical user a seamless path from zero to running.

No new product features. No new UI panels beyond what Phase 5 shipped. This phase is ops, hardening, and documentation only.

</domain>

<decisions>
## Implementation Decisions

### Nightly GCS Backup
- **D-01:** Backup runs **in-process inside the Node.js scheduler** (same pattern as the 03:00 UTC recompute already registered in `instrumentation.ts`). No separate systemd timer or shell script. Target time: 04:15 UTC daily.
- **D-02:** Backup sequence: `sqlite3` online `.backup` → gzip → `@google-cloud/storage` upload to configured GCS bucket. If the upload fails, log the error to `send_log` (or a dedicated `app_meta` error key) — do NOT crash the process.
- **D-03:** GCS lifecycle rule (delete objects older than 30 days) is configured separately via `gsutil lifecycle set` or the GCS console — not managed by the app at runtime. The installer (Phase 7) will automate this; Phase 6 just documents the manual step.

### Failure Notifications
- **D-04:** Provider: **Discord webhook only**. User pastes a webhook URL into `app_meta.notification_webhook_url` after deploy. No ntfy.sh in v1.
- **D-05:** Trigger for send-failure alert: **any single send** that lands `status='error'` or `status='timeout'` in `send_log`. Since there are no retries (design spec §10 / Phase 3 D-01), each failure IS exhaustion — alert immediately.
- **D-06:** Trigger for scheduler-stall alert: no tick recorded in >5 minutes. Scheduler tracks `app_meta.last_tick_at` (ISO timestamp written on every 60s tick); a watchdog check inside the same tick function compares against `Date.now()` and fires the webhook if the gap exceeds 300s.
- **D-07:** If `app_meta.notification_webhook_url` is absent or empty, skip all webhook calls silently — notifications are opt-in, not required for the app to run.
- **D-08:** Webhook payload is a minimal Discord embed: title, description (which send/what stall), timestamp. No fancy formatting required.

### Systemd Unit
- **D-09:** Single unit file: `claude-tracker.service`. `EnvironmentFile=/etc/claude-sender.env`. Runs as a dedicated non-root user (e.g., `claude-tracker`). `Restart=always`, `RestartSec=5`.
- **D-10:** `CLAUDE_CODE_OAUTH_TOKEN` is read from `/etc/claude-sender.env` at service start. No changes to how the app reads it — Next.js picks it up from the environment automatically.
- **D-11:** Next.js server must bind to `127.0.0.1:3018`. This requires `HOSTNAME=127.0.0.1` and `PORT=3018` in the env file (or the start script). Verify with `ss -tlnp | grep 3018` in the post-deploy checklist.

### HOSTING-STRATEGY.md Rewrite
- **D-12:** **Full rewrite of the existing `HOSTING-STRATEGY.md` file** (no archive, no new file). The goal is seamless non-technical-user experience: a reader who has never deployed a Node.js app should be able to follow it top-to-bottom and end up with a working service in under 30 minutes.
- **D-13:** The rewrite must reflect single-service reality throughout: one systemd unit, no Python, no `claude-sender.service`, no Tailscale. Drop all references to the Python sender or the old two-service architecture. Historical context is not preserved — the old doc lives in git history.
- **D-14:** Structure the rewrite around the user journey, not the architectural explanation: Prerequisites → Provision VM → Deploy app → Configure secrets → Start service → Verify → Configure backups → Configure notifications (optional). Each step should be copy-pasteable commands.
- **D-15:** The post-deploy verification checklist (QUAL-03) lives **inside `HOSTING-STRATEGY.md`** as a dedicated section — not a separate file. Checklist items: service healthy (`systemctl status claude-tracker`), CLI authenticated (first scheduler tick appears in `journalctl`), scheduler ticking (check `app_meta.last_tick_at`), first fire lands in `send_log`, nightly backup object appears in GCS.

### Claude's Discretion
- Exact Node.js package for GCS upload (`@google-cloud/storage` is the standard choice, but if a simpler `gsutil` subprocess call is more appropriate given the in-process constraint, use that)
- Whether `app_meta.last_tick_at` is a new key or reuses an existing key for stall detection
- Exact Discord embed field names and message text
- Whether the in-process backup uses `better-sqlite3`'s `.backup()` method or spawns `sqlite3` CLI

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Primary design spec
- `2026-04-16-tracker-sender-merge-design.md` §10 — Out of scope for v1: no retry logic, no notifications (v1 decision; Phase 6 adds notifications as a deliberate extension)
- `2026-04-16-tracker-sender-merge-design.md` §8 — Migration plan steps 6–7: deprecate Python sender, update hosting doc

### Current hosting doc (to be rewritten)
- `HOSTING-STRATEGY.md` §6 — Current deployment playbook (Phases 1–5). Phase 6 replaces this with a single-service playbook.
- `HOSTING-STRATEGY.md` §5.4 — Current backup strategy (manual shell script). Phase 6 moves this in-process.
- `HOSTING-STRATEGY.md` §3.1 — OAuth headless auth constraint (preserve in rewrite — still load-bearing)
- `HOSTING-STRATEGY.md` §3.2 — 1 GB RAM / swap mitigation (preserve in rewrite — still load-bearing)

### Requirements
- `REQUIREMENTS.md` — DATA-07, DATA-08, DEPLOY-01–05, NOTIFY-01–03, QUAL-03, QUAL-04

### Prior phase decisions
- `.planning/phases/03-sender-module/03-CONTEXT.md` — D-01 (no retries), D-02 (QUESTIONS constant)
- `.planning/phases/04-scheduler-wiring/04-CONTEXT.md` — scheduler architecture, instrumentation.ts registration pattern

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/instrumentation.ts` — already registers the scheduler; backup job plugs in as a second registered task using the same pattern
- `src/lib/scheduler.ts` — nightly 03:00 UTC recompute shows the pattern for time-triggered in-process tasks; 04:15 UTC backup follows the same shape
- `src/lib/db.ts` — has `better-sqlite3` instance already open; `.backup()` method available on the same db instance

### Established Patterns
- `app_meta` key-value store: all runtime config lives here; `notification_webhook_url`, `last_tick_at`, backup status keys follow the same pattern
- `send_log` for all send attempts: notification send attempts could optionally log there or to a separate `app_meta` error key

### Integration Points
- `instrumentation.ts` → registers scheduler → backup job registers here too (after scheduler init)
- `app_meta.paused` is read by scheduler on every tick; notification logic reads `app_meta.notification_webhook_url` on each alert event

</code_context>

<specifics>
## Specific Ideas

- The Discord webhook URL in `app_meta` means it survives restarts and can be updated without redeploying — user edits it in the dashboard's existing Override panel or directly in the DB.
- HOSTING-STRATEGY.md rewrite goal: "a reader who has never deployed a Node.js app should be able to follow it top-to-bottom in under 30 minutes." This is the UX bar for the doc, not just a nice-to-have.
- The post-deploy checklist should be runnable as a sequence of commands, not just prose — copy-pasteable verification steps.

</specifics>

<deferred>
## Deferred Ideas

- ntfy.sh support — noted for v2 if the user prefers a no-Discord option
- Slack webhook — same pattern as Discord, easy to add later
- GCS lifecycle rule automation — deferred to Phase 7 installer (Phase 6 documents the manual step)
- Tailscale / public exposure — explicitly out of scope; dashboard stays `127.0.0.1` only

</deferred>

---

*Phase: 06-vm-deployment-hardening*
*Context gathered: 2026-04-22*
