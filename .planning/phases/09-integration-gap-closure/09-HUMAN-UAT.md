---
status: partial
phase: 09-integration-gap-closure
source: [09-VERIFICATION.md]
started: 2026-05-01T00:00:00Z
updated: 2026-05-01T00:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. First visit redirects to /setup when setup_complete is unset
expected: Visiting http://localhost:3017/ on a fresh database (or with setup_complete not set in app_meta) redirects to /setup
result: [pending]

### 2. Dashboard accessible after setup wizard completes
expected: After completing the setup wizard (setup_complete='true' written to app_meta), visiting http://localhost:3017/ loads the dashboard without redirecting to /setup. Also, visiting /setup when already set up redirects to /.
result: [pending]

### 3. Setting peak_window_hours=5 produces a 5-hour detection window
expected: Set peak_window_hours=5 in the Overrides panel, trigger a manual recompute, and observe the Optimal Schedule card shows a 5-hour peak block (endHour = startHour + 5)
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
