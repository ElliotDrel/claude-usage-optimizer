---
phase: 5
reviewers: [gemini, codex]
reviewed_at: 2026-04-23T00:00:00Z
plans_reviewed: [05-01-PLAN.md, 05-02-PLAN.md, 05-03-PLAN.md]
---

# Cross-AI Plan Review — Phase 5: Dashboard Control Surface

## Gemini Review

Here is the structured review of the implementation plans for Phase 5 (Dashboard Control Surface).

### Overall Assessment
The plans are well-structured and directly address the phase requirements, successfully shifting the app from a passive observer to an active control surface. However, there is a critical stack violation in Plan 02, and Plan 01 lacks important validation details that could lead to invalid schedule states.

---

### Plan 01 (Wave 1) — API Layer Extension

**Summary**
This plan effectively extends the existing data layer to support the new UI components by enriching the dashboard payload and creating a generic mechanism for saving configuration overrides. It correctly identifies the need to trigger scheduler recalculations immediately upon state changes.

**Strengths**
- Consolidating data into a single `GET /api/dashboard` fetch prevents race conditions and UI tearing across different dashboard components.
- Key allowlist on the `PATCH /api/app-meta` endpoint is a crucial security step.
- `SendLogEntry` interface properly distinguishes between manual and scheduled sends via the `scheduledFor` nullable field.

**Concerns**
- **HIGH:** Missing *value* validation on `PATCH /api/app-meta`. The plan mentions an allowlist for keys, but `peak_window_hours` must strictly be 3-6, and `anchor_offset_minutes` must be 0-15. Allowing out-of-bounds values here will crash the `recomputeSchedule()` logic.
- **MEDIUM:** Race conditions during rapid saves. If a user quickly tabs through the override form triggering multiple `PATCH` requests, concurrent `recomputeSchedule()` calls might race to write to the database.
- **LOW:** Shifting `tomorrowFires` by exactly +24h is a slight approximation. It works fine as a preview, but if the user changes timezone offsets, a naive +24h shift might show confusing preview times.

**Suggestions**
- Add strict type and bounds checking for the `value` payload in `PATCH /api/app-meta` based on the requested `key`.
- Consider adding a simple debounce or lock around `recomputeSchedule()` if it is triggered by API calls.
- Ensure `tomorrowFires` computation explicitly uses the updated `user_timezone` offset rather than just a naive `+ 1000 * 60 * 60 * 24` math on today's timestamps.

**Risk Assessment:** **MEDIUM**
The core logic is sound, but missing payload validation poses a significant risk to the integrity of the scheduling algorithm.

---

### Plan 02 (Wave 2) — Optimal Schedule Card

**Summary**
This plan outlines a comprehensive component for visualizing the core value proposition of the app. It covers all necessary states (pending, fired, failed, paused) and correctly implements a live countdown for immediate user feedback.

**Strengths**
- Centralizing the core metrics (Peak Block, Today's Fires, Countdown) at the top of the UI aligns perfectly with the operational focus of the dashboard.
- Explicit amber warning state for "Paused" ensures the user is never confused about why sends aren't firing.
- Live countdown (via `setInterval`) is a great UX touch for an automated background system.

**Concerns**
- **HIGH:** Stack violation. The plan explicitly states: *"CSS variables for colors (not Tailwind), inline styles."* This directly contradicts the project constraints which specify **Tailwind v4**.
- **MEDIUM:** Status badge matching logic needs precision. Relying on "proximity matching" between `send_log.firedAt` and `scheduleFires` is brittle.
- **LOW:** Countdown timer edge case. When the countdown hits 0, it might display negative numbers or flip to the next fire time before the dashboard polling interval catches the updated `send_log`.

**Suggestions**
- **Crucial:** Discard the "CSS variables/inline styles" approach. Strictly use Tailwind v4 utility classes for all styling to maintain project consistency.
- Ensure the status badge logic strictly matches `send_log.scheduledFor` against the `scheduleFires` array elements.
- Add a "Firing..." or "Processing..." text state to the countdown when `time <= 0` but the status is still "pending", holding that state until the next dashboard polling cycle refreshes the data.
- Ensure `setInterval` is properly cleared in the `useEffect` cleanup function to prevent memory leaks.

**Risk Assessment:** **HIGH** (Due to Stack Violation)
If implemented as written, the styling approach would violate core architectural constraints. Once corrected to use Tailwind, the risk drops to LOW.

---

### Plan 03 (Wave 2) — Control Surface Panels

**Summary**
This plan details the interactive elements of the dashboard, mapping out the forms, tables, and buttons needed for full operational control. It sensibly relies on native web patterns (blur-to-save) and handles timezone complexities via a dedicated banner.

**Strengths**
- Blur-to-save on inputs is a good balance between explicit "Save" buttons and complex debounced auto-saving.
- The Send History panel correctly highlights manual vs. scheduled runs.
- Timezone mismatch logic is handled gracefully (persistent but non-blocking) rather than forcing an immediate override.

**Concerns**
- **HIGH:** Assumption of `/api/send-now` existence. The plan specifies POSTing to this route, but does not explicitly state if it needs to be created in this phase or if it was built in Phase 3. If missing, the "Send Now" button will 404.
- **MEDIUM:** Timezone logic is notoriously tricky. Browsers' `new Date().getTimezoneOffset()` returns inverted values (e.g., UTC+2 is `-120`). Comparing this against the stored `app_meta.user_timezone` integer requires careful sign alignment.
- **MEDIUM:** UX during network latency. With blur-to-save, if the `PATCH` request takes 500ms and the user clicks "Send Now" in that window, the send might fire with the *old* schedule settings.

**Suggestions**
- Verify `POST /api/send-now` is fully implemented and correctly triggers the singleton sender from Phase 4. If not, explicitly add its creation to this plan.
- Implement a global or field-level UI disable state (or spinner) during the `PATCH` request to prevent conflicting actions while the schedule is recomputing.
- Write a dedicated, testable helper function for the timezone comparison (`browserOffsetInMinutes` vs `storedOffsetInteger`) to ensure signs are handled correctly before displaying the mismatch banner.

**Risk Assessment:** **LOW**
Standard UI implementation tasks with well-understood edge cases. Assuming the backend endpoints are robust, these components will integrate smoothly.

---

## Codex Review

## Plan 01 — API Layer Extension

### Summary
This is the most important plan and the current summary is directionally right, but it has two major contract problems: it assumes the wrong shape for `schedule_fires`, and it recomputes after every `app_meta` write without accounting for scheduler side effects. As written, it is likely to produce a UI API that looks complete on paper but cannot reliably drive the dashboard behavior required in UI-01 through UI-03.

### Strengths
- It puts all dashboard reads behind the existing `GET /api/dashboard`, which matches the locked one-fetch decision (D-01).
- It correctly uses a single generic `PATCH /api/app-meta` endpoint for override writes and pause state.
- It includes send history in the same payload, which supports the "no `journalctl`" phase goal.
- The allowlist idea is good; a generic key-value endpoint without one would be too open.

### Concerns
- **HIGH**: The plan assumes `schedule_fires` is `FireTime[]`, but the scheduler persists UTC timestamp objects, not local `{ hour, minute }` fire times. The proposed `ScheduleData` contract is therefore wrong at the storage boundary.
- **HIGH**: Recomputing after every `app_meta` write is unsafe with the current scheduler behavior because `recomputeSchedule()` resets `schedule_fires_done` to `[]` on every recompute. A pause toggle or timezone update could re-enable already-fired sends later the same day.
- **HIGH**: The plan does not include value validation, only key allowlisting. Invalid `peak_window_hours`, `anchor_offset_minutes`, or malformed time strings can corrupt recompute behavior or produce `NaN` flows.
- **MEDIUM**: `buildDashboardData` currently reads like an analysis/transform function. Moving `app_meta` and `send_log` I/O into it increases hidden coupling and makes route-level testing harder. A cleaner plan would fetch data in the route and pass it in.
- **MEDIUM**: `tomorrowFires` as "shifted +24h" is underspecified. If the API returns local display times, DST/date rollover matters. If it returns stored UTC timestamps, a simple hour wrap is wrong.

### Suggestions
- Redefine the API contract so `scheduleData` exposes display-ready schedule rows derived from stored UTC timestamps, not raw `FireTime[]`.
- Split "schedule-affecting writes" from "state-only writes." At minimum, `paused` should not trigger a recompute that clears done markers.
- Add strict server-side value validation for all editable keys, not just the key name.
- Return enough schedule row data for the frontend to map status reliably: scheduled timestamp, local display label, anchor flag, done state, and derived status.
- Keep DB reads in the route layer unless there is a strong reason to make `analysis.ts` stateful.

### Risk Assessment
**HIGH**. The plan has the right endpoint count and broad structure, but the stored-schedule contract and recompute side effect are both substantial correctness risks.

---

## Plan 02 — Optimal Schedule Card

### Summary
This plan captures the visible UI well, but it is too optimistic about where per-fire status comes from and how schedule times are represented. It can produce a card, but not a reliable one, unless Plan 01 exposes a stronger schedule-row API than currently described.

### Strengths
- The full-width top placement matches the locked decision (D-03).
- The Today/Tomorrow tab structure matches the locked decision (D-04).
- A live countdown is appropriate for the operational-control-surface goal.
- The paused visual state is correctly included.

### Concerns
- **HIGH**: The plan says status badges come from matching `scheduleFires[]` with `send_log`, but it never defines a stable join key. `send_log` has `scheduled_for` UTC timestamps; the proposed `scheduleFires` shape is local clock fields. That match is not reliable.
- **HIGH**: The plan displays fire times as if the API already has local `hour/minute` values. That conflicts with the scheduler's stored UTC ISO timestamps and with the timezone-display decision (D-09).
- **MEDIUM**: The countdown logic is underspecified for "all today's fires already passed." It should clearly choose tomorrow's first fire without mislabeling today's last slot.
- **MEDIUM**: The plan uses "pending/fired/failed" badges, but the data model in Plan 01 only exposes raw `sendHistory`; it does not define slot-level derived statuses.
- **LOW**: "CSS variables only, inline styles" is a presentation choice, not a planning risk reducer. It takes space that would be better spent specifying schedule-row data contracts.

### Suggestions
- Change the card input from raw `scheduleFires` to a backend-derived array like `scheduleRows: { scheduledForUtc, displayTime, isAnchor, status, isNext }[]`.
- Make timezone conversion explicit in the API or in the component contract. Right now the plan assumes it away.
- Define exact slot-status rules: `pending`, `ok`, `error`, `timeout`, `missed`, `skipped-paused`, or keep it simpler and specify how each is derived.
- Add one focused test case for countdown rollover after the last fire of the day.

### Risk Assessment
**MEDIUM-HIGH**. The component itself is straightforward, but it depends on data semantics that Plan 01 does not actually provide.

---

## Plan 03 — Control Surface Panels

### Summary
This plan is mostly well-scoped for the UI panels, but it has one serious architecture conflict and one delivery-risk issue. The biggest problem is the timezone design: storing a UTC offset integer conflicts with the scheduler's IANA-timezone expectation.

### Strengths
- The panel set maps cleanly to UI-02, UI-04, UI-05, and UI-06.
- Collapsed-by-default overrides with save-on-blur matches the locked decision (D-05).
- Send-now loading then refetch is a good UX fit for the single-dashboard control surface.
- Confirm-on-pause but not on unpause matches the phase decision (D-07).
- The panel decomposition is reasonable and avoids over-engineering.

### Concerns
- **HIGH**: The timezone banner design conflicts with the scheduler contract. The scheduler reads `user_timezone` as an IANA name and validates it. Writing raw offsets into `user_timezone` is a spec and implementation conflict.
- **HIGH**: Plan 03 and Plan 02 both modify `src/app/page.tsx` while both are Wave 2 and only depend on 05-01. That is a sequencing/merge-conflict risk; they should not be parallelized as written.
- **MEDIUM**: The summary assumes the override panel already has current raw values from `scheduleData`, but Plan 01's stated `ScheduleData` shape does not include them. That dependency is missing.
- **MEDIUM**: `Send now` has no explicit duplicate-click protection beyond client loading state. If the request hangs or the page rerenders, accidental double sends are still possible.
- **LOW**: The plan mentions "toast" but only needs a small inline success state. A global toast mechanism would be unnecessary scope.

### Suggestions
- Keep `user_timezone` as IANA. If you still want a mismatch banner, compare browser offset against the offset implied by the stored IANA name, but do not overwrite the stored value with a raw integer.
- Serialize Plans 02 and 03, or split page integration into a separate follow-up task with one owner.
- Explicitly add the override raw values to the API contract in Plan 01 if Plan 03 depends on them.
- Add a simple server-side guard or client-side disabled state strong enough to prevent duplicate manual sends during an in-flight request.
- Keep the success feedback local and lightweight; avoid adding a toast system for one panel.

### Risk Assessment
**MEDIUM-HIGH**. Most of the UI work is fine, but the timezone model is incompatible with the scheduler, and the file-ownership/dependency plan is weak.

---

### Cross-Plan Risks (Codex)
- The main contract gap is schedule representation: the plans talk about `FireTime[]`, but the scheduler persists UTC timestamp rows.
- The main behavior gap is recompute side effects: "recompute after any write" is unsafe if recompute clears `schedule_fires_done`.
- The main dependency gap is Wave 2 ownership: Plan 02 and Plan 03 should not both edit `src/app/page.tsx` in parallel.
- The main spec gap is timezone handling: the plans mix "IANA timezone" and "UTC offset integer" in a way that will break either peak detection or display consistency.

---

## Consensus Summary

Both reviewers agree the plans are directionally correct and cover the required phase goals. The primary concerns cluster around three systemic issues that both reviewers independently flagged.

### Agreed Strengths
- Single `GET /api/dashboard` fetch (D-01) is the right design — prevents race conditions and UI tearing.
- Key allowlist on `PATCH /api/app-meta` is a necessary security control.
- `SendLogEntry.scheduledFor` nullable field correctly distinguishes manual vs. scheduled sends.
- Live countdown via `setInterval` is appropriate UX for an operational control surface.
- Amber paused state, confirm-on-pause, and collapsed overrides all match the phase decisions correctly.
- Blur-to-save with inline flash is a well-judged interaction pattern.

### Agreed Concerns
These are the highest-priority issues to address before implementation:

1. **[HIGH] Missing value validation on `PATCH /api/app-meta`** — Both reviewers flagged that key allowlisting alone is insufficient. `peak_window_hours` (3–6) and `anchor_offset_minutes` (0–15) require strict bounds checking. Invalid values will corrupt `recomputeSchedule()` and produce NaN flows or crashes.

2. **[HIGH] `recomputeSchedule()` side effect on `schedule_fires_done`** — Codex identified (and Gemini's race condition concern aligns with) that calling `recomputeSchedule()` after every `app_meta` write resets which sends have already fired. A `paused` toggle or timezone update mid-day could re-enable already-completed sends. "State-only writes" (e.g., `paused`) should not trigger a full recompute.

3. **[HIGH] Schedule data contract mismatch — `FireTime[]` vs. UTC timestamps** — Both reviewers flagged that the proposed `ScheduleData.scheduleFires: FireTime[]` shape does not match what the scheduler actually persists (UTC ISO timestamps). The status badge join between `scheduleFires` and `send_log.scheduled_for` is unreliable without a stable UTC-based key. The API needs to expose display-ready rows with `scheduledForUtc`, `displayTime`, derived `status`, and anchor flags.

### Divergent Views
- **Timezone storage format:** Codex raised a HIGH concern that writing UTC offset integers into `user_timezone` breaks the scheduler's IANA-name validation. Gemini flagged timezone sign-alignment as MEDIUM. Codex's concern is more fundamental — this is a spec conflict, not just an arithmetic risk. The `user_timezone` field must remain an IANA name; the banner comparison logic should derive an offset from that name rather than overwrite it.
- **Plan 02 styling:** Gemini rated the "CSS variables / inline styles" directive as a HIGH stack violation given the Tailwind v4 constraint. Codex noted it as a LOW presentation-choice issue. Gemini's read is more aligned with the hard constraints — all new components should use Tailwind v4 classes.
- **Plan 03 risk level:** Gemini rated it LOW overall; Codex rated it MEDIUM-HIGH. The delta is the IANA timezone conflict, which Codex weighted heavily. Resolving the timezone design brings both assessments into alignment at LOW-MEDIUM.
- **Wave 2 parallelism:** Codex flagged Plans 02 and 03 both editing `src/app/page.tsx` simultaneously as a merge-conflict risk. Gemini did not raise this. Worth serializing page integration or giving one plan ownership of that file.
