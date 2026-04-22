---
status: complete
phase: 05-dashboard-control-surface
source:
  - 05-01-SUMMARY.md
  - 05-02-SUMMARY.md
  - 05-03-SUMMARY.md
started: 2026-04-22T19:20:00Z
updated: 2026-04-22T19:30:00Z
---

## Current Test

number: done
name: testing complete
awaiting: n/a

## Tests

### 1. Optimal Schedule Card at top of dashboard
expected: |
  Open the dashboard (npm run dev → localhost:3017). The Optimal Schedule card
  should appear as the first full-width panel — above the Collector/Utilization
  metrics. It should show a peak block line (e.g. "08:00 – 12:00, Midpoint: 10:00")
  or "Peak: [not available]" if no snapshot data exists yet. Today/Tomorrow tabs
  should be visible.
result: pass

### 2. Today / Tomorrow tab switching
expected: |
  In the Optimal Schedule card, click the "Tomorrow" tab. The fire-time rows
  should switch to tomorrow's schedule. Click "Today" — rows switch back. Both
  tabs show 5 fire times (or "No schedule data" if none computed yet).
result: pass

### 3. Live countdown ticks in real time
expected: |
  On the "Today" tab, a countdown box (e.g. "2h 14m 37s until next fire") should
  be visible. Watch it for 3–5 seconds — the seconds digit should decrement live
  without a page reload. Format shortens as time approaches: "Xh Ym Zs" → "Xm Zs" → "Zs".
result: pass

### 4. Send History panel shows past sends
expected: |
  Below the control surface, a Send History panel should list the last 20 send
  attempts. Each row should show: time (HH:MM:SS), a colored status badge
  (green = ok, red = error, amber = timeout), duration in ms, and a response
  excerpt. If no sends have occurred yet, it should show an empty-state message
  rather than crashing.
result: pass

### 5. Send Now button fires a send and refreshes
expected: |
  Click "Send Now". The button should go disabled and show "Sending…" while the
  request is in flight. On completion (success or error), the button re-enables.
  On success, the Send History panel should refresh and show the new send at the
  top of the list without a manual page reload.
result: pass

### 6. Pause toggle — confirmation dialog and pause state
expected: |
  Click the Pause button. A modal dialog should appear with the text "Pause
  automatic sending? Scheduled fires will be skipped until you resume." and two
  buttons: "Cancel" and "Pause". Clicking "Cancel" dismisses the dialog with no
  change. Clicking "Pause" confirms and the component switches to showing
  "🔒 Paused" in warning color. The OptimalScheduleCard should also show a
  "Paused" banner.
result: pass

### 7. Resume (unpause) — no confirmation required
expected: |
  While the scheduler is paused, click the Resume button. It should immediately
  toggle back to active state ("▶️ Active") with no confirmation dialog. The
  paused banner in OptimalScheduleCard should disappear.
result: pass

### 8. Schedule Overrides panel — expand, edit, save on blur
expected: |
  Click the expand button on the Schedule Overrides panel to open it. Five fields
  should appear: Override Start Time, Peak Window Hours, Anchor Offset Minutes,
  Default Seed Time, and Timezone. Edit one field (e.g. change Peak Window Hours
  to "4"), then click outside the field (blur). A "✓ Saved" inline toast should
  appear for ~2 seconds and disappear. The OptimalScheduleCard's schedule should
  eventually reflect the change (may need a few seconds for recompute).
result: pass

## Summary

total: 8
passed: 8
issues: 0
pending: 0
skipped: 0

## Gaps

[none yet]
