# Phase 5: Dashboard Control Surface - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Transform the existing dashboard from a passive observer into an operational control surface. Add: Optimal Schedule card (peak block + today's 5 fires + countdown + tomorrow's preview via tab), Overrides form, Send History panel, Send Now button, Pause toggle. No new backend modules — this phase is purely wiring the Phase 4 scheduler state into the UI.

</domain>

<decisions>
## Implementation Decisions

### API — Data reads
- **D-01:** Extend the existing `GET /api/dashboard` response to include schedule data and send history. Add `scheduleData` (parsed from `app_meta`) and `sendHistory` (last 20 `send_log` rows) to the `DashboardData` shape. One fetch, one 15s refresh cycle — no new read endpoint.

### API — Data writes
- **D-02:** Single generic `PATCH /api/app-meta` endpoint: `{ key: string, value: string }`. Handles all override field saves and the pause toggle. Matches the `app_meta` key-value structure directly. After any write, the endpoint triggers an immediate schedule recompute (reads all snapshots → peak-detector → schedule-generator → writes new `schedule_fires` to `app_meta`).

### Layout & panel placement
- **D-03 (Claude's Discretion):** Optimal Schedule card is a new full-width row at the top of the dashboard, above the existing Collector/Utilization row. "Always visible, near the top" per design spec §6.1.
- **D-04 (Claude's Discretion):** Tomorrow's Schedule preview is a tab inside the Optimal Schedule card (Today / Tomorrow tabs), not a separate card. Saves vertical space and keeps schedule information co-located.

### Override form UX
- **D-05:** Overrides section is collapsed by default; expands on click (per design spec §6.2). Each field saves immediately on change (not a batch-save button) — writing through to `app_meta` and triggering recompute. Per-field save confirmed by an inline "Saved ✓" toast/flash notification.

### Action feedback — Send Now
- **D-06:** After Send Now button click: button shows loading state, then on success immediately re-fetches dashboard data (same as `fetchData()` call) so the new `send_log` row appears in Send History without waiting for the 15s auto-refresh.

### Action feedback — Pause toggle
- **D-07:** Pause toggle requires a confirm dialog before pausing ("Pause automatic sending? Scheduled fires will be skipped until you resume."). No confirm needed to un-pause (resuming is safe). Toggle shows visual paused state (amber/warning color, "Paused" label) while `app_meta.paused = 'true'`.

### Action feedback — Override saves
- **D-08:** Saving any override field shows a brief toast/flash notification ("Schedule updated"). The Optimal Schedule card re-renders with new fire times within seconds as the dashboard auto-refresh picks up the recomputed schedule.

### Timezone display
- **D-09:** Fire times are displayed in the browser's local timezone by default (not `app_meta.user_timezone`). On page load, compare the browser's UTC offset (e.g. `-5`) to the UTC offset implied by `app_meta.user_timezone`. If they differ, show a **persistent** (non-blocking) notification banner: "Your scheduler timezone (-5 UTC) differs from your browser (-7 UTC). [Update scheduler] [Dismiss]". Clicking "Update scheduler" calls `PATCH /api/app-meta` with the new UTC offset. Clicking "Dismiss" hides it for the session. The notification does NOT auto-update `app_meta` — user must approve. Store/compare as UTC offset integer (e.g. `-5`), not IANA name string. Do not compare two different UTC-offset values against each other — only compare browser offset vs. stored offset.

### Claude's Discretion
- Exact tab component for Today/Tomorrow within the Schedule card
- Whether override fields use `<input>` blur-to-save or an explicit per-field save button
- Exact toast library or inline flash implementation (no new dependency needed — simple CSS transition is fine)
- Whether the confirm-before-pause uses a native `window.confirm` or a small inline modal
- Column widths and responsive breakpoints for the Send History table

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design spec (primary source of truth)
- `2026-04-16-tracker-sender-merge-design.md` §6 — Dashboard additions: Optimal Schedule card (§6.1), Overrides section (§6.2), Send History panel (§6.3)
- `2026-04-16-tracker-sender-merge-design.md` §5.3 — `app_meta` key list: `schedule_fires`, `schedule_fires_done`, `peak_block`, `schedule_override_start_time`, `peak_window_hours`, `anchor_offset_minutes`, `default_seed_time`, `user_timezone`, `paused`
- `2026-04-16-tracker-sender-merge-design.md` §5.2 — `send_log` schema: columns available for Send History panel

### Requirements
- `.planning/REQUIREMENTS.md` — UI-01 through UI-07 (the 7 requirements this phase covers)

### Prior phase context (data contracts)
- `.planning/phases/04-scheduler-wiring/04-CONTEXT.md` — D-04: `initializeAppMeta` defaults; all `app_meta` keys are pre-initialized so dashboard never sees null values
- `.planning/phases/03-sender-module/03-CONTEXT.md` — D-05: `send_log` rows from manual fires have `scheduled_for=NULL` and `is_anchor=0`

### Existing code to read before implementing
- `src/app/page.tsx` — existing dashboard layout, `Section` component, `fetchData` pattern, 15s poll loop
- `src/app/api/dashboard/route.ts` — existing `GET` handler to extend with schedule + send history data
- `src/components/CollectorHealth.tsx` — live countdown pattern (`useEffect` + `setInterval(1000)`) to reuse for next-fire countdown
- `src/lib/db.ts` — `app_meta` table helpers, `send_log` schema

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `Section` component (`src/app/page.tsx`): wraps every dashboard panel — new panels use this exact wrapper
- `Metric` component (`src/components/CollectorHealth.tsx`): small data card pattern, reuse for fire-time status rows
- `fetchData` + `useCallback` pattern (`src/app/page.tsx`): call after Send Now success to immediate-refresh
- Live countdown logic (`src/components/CollectorHealth.tsx` `formatCountdown`): copy for next-fire countdown in Schedule card
- CSS variable design system: `var(--accent)`, `var(--bg-surface)`, `var(--border-subtle)`, `var(--good)`, `var(--danger)` — all status colors already defined

### Established Patterns
- All components are named exports, no default exports in `src/components/`
- Inline style via `style={{}}` for CSS variables (not Tailwind for color/border — Tailwind for layout only)
- `"use client"` directive on interactive components
- `DashboardData` type lives in `src/lib/analysis.ts` — extend this type for schedule fields

### Integration Points
- `GET /api/dashboard` → extend return type with `scheduleData` + `sendHistory`
- `PATCH /api/app-meta` → new endpoint (create `src/app/api/app-meta/route.ts`)
- `POST /api/send-now` → already exists (Phase 3); Send Now button calls this, then re-fetches on success
- `src/lib/schedule.ts` + `src/lib/peak-detector.ts` → called inside `PATCH /api/app-meta` handler after each write to recompute schedule

</code_context>

<specifics>
## Specific Ideas

- Timezone mismatch notification: compare UTC offset as an integer (e.g. `new Date().getTimezoneOffset() / -60` → `-5` for EST). Store in `app_meta.user_timezone` as the offset value. If browser offset ≠ stored offset, show persistent banner. User-approved update writes the new offset. Dismiss hides for the session only.
- Pause confirmation wording: "Pause automatic sending? Scheduled fires will be skipped until you resume." Two buttons: "Pause" (danger color) and "Cancel".
- Tomorrow's Schedule tab: shows the 5 predicted fire times for the next day (computed from the same schedule with date +1). If schedule hasn't been computed yet (no `schedule_generated_at`), tab shows "Schedule not yet computed — runs at 03:00 UTC."
- Send History table columns: fired_at (local time), status (ok/error/timeout with color), duration (ms), question (truncated), response excerpt (truncated). Manual fires distinguished by "Manual" badge in the scheduled_for column.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 05-dashboard-control-surface*
*Context gathered: 2026-04-21*
