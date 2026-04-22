---
phase: 05-Dashboard Control Surface
fixed_at: 2026-04-22T19:15:00Z
review_path: .planning/phases/05-dashboard-control-surface/05-REVIEW.md
fix_scope: critical_warning
findings_in_scope: 8
fixed: 7
skipped: 1
iteration: 1
status: partial
---

# Phase 05: Code Review Fix Report

**Fixed at:** 2026-04-22T19:15:00Z
**Source review:** `.planning/phases/05-dashboard-control-surface/05-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 8 (CR-01, CR-02, CR-03, WR-01, WR-02, WR-03, WR-04, WR-05)
- Fixed: 7
- Skipped: 1 (WR-02 — already resolved in current code)

---

## Fixed Issues

### CR-01 + WR-01: Untrusted Timezone String / DST Fragility in TimezoneWarningBanner

**Files modified:** `src/components/TimezoneWarningBanner.tsx`
**Commit:** `96cfc2e`
**Applied fix:**
- Replaced `getBrowserUTCOffset()` (numeric offset, DST-fragile) with `getBrowserIANATimezone()` using `Intl.DateTimeFormat().resolvedOptions().timeZone`.
- Replaced `parseUTCOffset()` (offset arithmetic, DST-broken) with direct IANA string comparison.
- `handleUpdate` now stores the IANA timezone name instead of a raw numeric offset string like `"+5"`.
- Added `isRawNumericOffset()` helper to detect legacy stored values — treats them as mismatches so user is prompted to overwrite with a valid IANA name.
- Banner now shows IANA timezone names in both browser and stored fields instead of raw offset numbers.
- CR-01 and WR-01 addressed in a single atomic commit since both are entangled in the same component.

**Status:** fixed: requires human verification (logic change)

---

### CR-02: Race Condition in PauseToggle State Update

**Files modified:** `src/components/PauseToggle.tsx`
**Commit:** `6750915`
**Applied fix:**
- In `handleToggle`, added `setShowConfirmPause(false)` before the `await doTogglePause(false)` call when unpausing, so the dialog cannot remain stuck open if `isLoading` cycles back to false before the state update.
- In `doTogglePause`, the `setShowConfirmPause(false)` on success is retained (covers the pause=true path triggered from the modal).
- In the `catch` block, added `if (pause) setShowConfirmPause(true)` to re-open the confirmation dialog when a pause attempt fails, so the user sees the operation did not complete.

**Status:** fixed: requires human verification (logic/state change)

---

### CR-03: Race Condition in recomputeSchedule

**Files modified:** `src/lib/scheduler.ts`
**Commit:** `b59807e`
**Applied fix:**
- Added `schedule_recomputing` to `initializeAppMeta` defaults (inserted via `ON CONFLICT DO NOTHING`).
- Added an explicit UPSERT after the defaults loop in `initializeAppMeta` to force-reset `schedule_recomputing` to `"false"` on every process startup — prevents a prior crash from permanently locking future recomputes.
- Wrapped the body of `recomputeSchedule` in a check: reads `schedule_recomputing`, throws if already `"true"`, sets to `"true"` before computation, and uses `try/finally` to unconditionally reset to `"false"` after completion or on error.

**Status:** fixed: requires human verification (logic change)

---

### WR-03: Jitter Range Comment Clarification

**Files modified:** `src/lib/schedule.ts`
**Commit:** `45eb9e3`
**Applied fix:**
- Replaced the terse `// 0–5 inclusive` inline comment with an explicit explanation: `// 0–5 inclusive: Math.random() in [0,1) * 6 = [0,6), floor = [0,5]`
- Moved comment to a dedicated line above the assignment for clarity.

**Status:** fixed

---

### WR-04: Missing Validation of Intl.formatToParts Output

**Files modified:** `src/lib/scheduler.ts`
**Commit:** `324955c`
**Applied fix:**
- After extracting `localYear`, `localMonth`, `localDay` from `Intl.DateTimeFormat.formatToParts()`, added an explicit guard: if any part is empty string, throws `Error` with the timezone name in the message.
- Prevents silently constructing a malformed ISO string like `--T12:00:00Z` that would corrupt `schedule_fires`.

**Status:** fixed

---

### WR-05: Schedule Override Validation Missing

**Files modified:** `src/components/ScheduleOverridesPanel.tsx`, `src/app/api/app-meta/route.ts`
**Commit:** `2b6d3ba`
**Applied fix:**

Client-side (`ScheduleOverridesPanel.tsx`):
- Added `validateOverrideField(key, value)` function with rules for `schedule_override_start_time` (empty or HH:MM), `peak_window_hours` (3–6), `anchor_offset_minutes` (0–15), `default_seed_time` (HH:MM).
- `OverrideField` now holds `validationError` state; `handleBlur` runs validation and blocks save if invalid.
- Input border turns red on invalid value; error message shown below input; hint shown only when no error.
- Renamed `key` prop to `fieldKey` to avoid collision with React's reserved `key` prop.

Server-side (`route.ts`):
- Added `OVERRIDE_VALIDATORS` map with the same rules.
- PATCH handler checks the validator before writing to DB; returns 400 with descriptive error if invalid.
- Prevents NaN corruption from strings like `"abc"` reaching `parseInt` in the scheduler.

**Status:** fixed: requires human verification (logic change)

---

## Skipped Issues

### WR-02: Missing API Route for `/api/send-now`

**File:** `src/components/SendNowButton.tsx:13`
**Reason:** Already resolved in current code — `src/app/api/send-now/route.ts` exists and implements a working POST handler that calls `send(config)` and returns the result. No action required.
**Original issue:** SendNowButton called `/api/send-now` but no route existed.

---

_Fixed: 2026-04-22T19:15:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
