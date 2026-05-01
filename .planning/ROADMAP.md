# Roadmap: Claude Usage Optimizer

---

## v1.0 (Complete) — [Archived milestone](milestones/v1.0-ROADMAP.md)

**Status:** ✓ Shipped 2026-05-01  
**Scope:** 9 phases, 51 requirements, all satisfied  
**E2E Flows:** Setup → Collection → Detection → Scheduling → Sending → Logging → Display (all verified)  
**Build:** Passing (129/129 tests, 0 errors)  
**Deliverable:** Single Next.js app with SQLite backend, peak-detection algorithm, scheduled sending via `claude` CLI, dashboard control surface, GCS backups, systemd deployment, non-technical-user installer.

### v1.0 Phase Summary

- [x] Phase 1: Foundation & DB Refactor (schema simplification, legacy cleanup)
- [x] Phase 2: Algorithm Core (peak detector, schedule generator)
- [x] Phase 3: Sender Module (node-side `claude -p` spawning)
- [x] Phase 4: Scheduler Wiring (60s tick loop, recompute, catch-up)
- [x] Phase 5: Dashboard Control Surface (UI panels, real-time control)
- [x] Phase 6: VM Deployment (systemd service, GCS backup, notifications)
- [x] Phase 7: Installer & Onboarding (one-command bootstrap, setup wizard)
- [x] Phase 8: Quality & Acceptance (unit tests, dev-loop verification)
- [x] Phase 9: Integration Gap Closure (middleware mount, peak_window_hours param)

**Requirements:** All 51 satisfied. [Full requirements archive](milestones/v1.0-REQUIREMENTS.md)

---

## Upcoming Milestones

### v1.1 (Planned)

Defer to `/gsd-new-milestone` workflow when ready. Next phase will address:
- Multi-day data collection maturity
- Peak detection refinement based on live usage patterns
- Expand dashboard analytics (heatmap time-to-drain, window efficiency metrics)
- Optional: day-of-week schedules (v2-SCHED-01)

---

## Historical Overview

Rebuild the two-subproject (Python sender + Next.js tracker) system into a single Next.js application that observes Claude.ai usage, computes an optimal daily send schedule from detected 4-hour peak blocks, and automatically fires sends via the `claude` CLI so one 5-hour window boundary lands at the midpoint of the peak — letting the user drain two consecutive 5-hour budgets across their peak period. The rebuild proceeded in the sequence prescribed by the design spec §8: DB foundation first (schema simplification + migrator), then pure algorithm modules, then the sender, then scheduler wiring, then dashboard panels, then VM deployment and hardening, then the non-technical-user installer/onboarding wizard, and finally a dedicated quality/acceptance phase. Each phase was a committable checkpoint; the system was usable (at progressively higher fidelity) after every phase.

## Archived Phases

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

---

*Roadmap created: 2026-04-16*  
*v1.0 Shipped: 2026-05-01*  
*See [v1.0 Milestone Archive](milestones/v1.0-ROADMAP.md) for full phase details, plans, and requirements.*
