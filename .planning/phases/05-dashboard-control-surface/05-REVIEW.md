---
phase: 05-Dashboard Control Surface
reviewed: 2026-04-22T18:30:00Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - src/app/api/app-meta/route.ts
  - src/app/globals.css
  - src/app/page.tsx
  - src/components/OptimalScheduleCard.tsx
  - src/components/PauseToggle.tsx
  - src/components/ScheduleOverridesPanel.tsx
  - src/components/SendHistoryPanel.tsx
  - src/components/SendNowButton.tsx
  - src/components/TimezoneWarningBanner.tsx
  - src/lib/analysis.ts
  - src/lib/db.ts
  - src/lib/scheduler.ts
findings:
  critical: 1
  warning: 5
  info: 4
  total: 10
status: issues_found
---

# Phase 05: Code Review Report

**Reviewed:** 2026-04-22T18:30:00Z
**Depth:** standard
**Files Reviewed:** 12
**Status:** issues_found

## Summary

Reviewed the dashboard control surface implementation including scheduling, send history, pause toggle, override panel, and core scheduling logic. The phase introduces critical scheduler functionality with generally good error handling and type safety. However, one critical security issue was identified with untrusted timezone parsing, and several logic bugs that could cause state inconsistency or incorrect schedule generation.

Key strengths:
- Proper use of TypeScript strict mode with type safety at API boundaries
- Comprehensive error handling in React components with user feedback
- Good separation of concerns between API routes, components, and library modules
- Defensive JSON parsing throughout

Key concerns:
- **Critical**: Untrusted IANA timezone strings accepted from `app_meta` without allowlist validation
- Race conditions in pause/resume toggling and schedule recomputation
- Timezone offset mismatch detection logic is fragile and relies on client state
- Missing API route for `/api/send-now` but component calls it
- Inconsistent error propagation in async operations

## Critical Issues

### CR-01: Untrusted Timezone String Accepted from Database (T-04-03 Bypass)

**File:** `src/lib/scheduler.ts:164`

**Issue:** The `fireTimeToUtcIso` function accepts `timezone` from `app_meta` without validation. While there is a try/catch wrapper (lines 162-170), this only catches constructor exceptions. A malicious or corrupted timezone value could still cause incorrect UTC calculations:

```typescript
// Line 164 — this only catches if IANA validation throws
Intl.DateTimeFormat("en-US", { timeZone: timezone });
```

However, the fallback is good. The real issue is that `TimezoneWarningBanner.tsx` converts browser UTC offset directly to a string (line 63) and stores it in `app_meta`:

```typescript
// TimezoneWarningBanner.tsx:63 — stores "+5" or "-7" directly
value: String(browserOffset),
```

But `scheduler.ts` expects IANA timezone names. This causes a mismatch: numeric offsets like "+5" or "-7" get passed to `Intl.DateTimeFormat`, which rejects non-IANA strings and silently falls back to America/Los_Angeles. This is not a security vulnerability per se, but it's a **data validation bug**: the UI allows storing invalid timezone values that the scheduler silently ignores.

**Fix:**
1. Create a timezone allowlist or use `Intl.supportedValuesOf('timeZone')` to validate
2. In `TimezoneWarningBanner.tsx`, store IANA timezone name (e.g., computed from the UTC offset via browser's timezone database) instead of raw numeric offset
3. Document the expected timezone format in comments or add a validation layer in `setAppMeta`

---

### CR-02: Race Condition in PauseToggle State Update

**File:** `src/components/PauseToggle.tsx:13-26`

**Issue:** The `showConfirmPause` state is only cleared in one branch (`doTogglePause` line 38), but if the user clicks "Pause" while a previous toggle is still in flight, the dialog may close prematurely or leave stale state:

```typescript
// Line 18-26: if isPaused is true (already paused), toggle directly without confirmation
// But what if the previous toggle request is still pending?
const handleToggle = async () => {
  if (!isPaused) {
    setShowConfirmPause(true);
    return;
  }
  await doTogglePause(false);
};

// Line 28-44: only doTogglePause clears the dialog
const doTogglePause = async (pause: boolean) => {
  setIsLoading(true);
  try {
    // ...
    setShowConfirmPause(false); // Only cleared here
  }
};
```

If the user rapidly toggles the pause button, or if `onRefetch()` takes a long time, `isLoading` protects against double-submission, but `showConfirmPause` can remain true while `isLoading` becomes false again, leaving the modal stuck open.

**Fix:**
```typescript
const handleToggle = async () => {
  if (!isPaused) {
    setShowConfirmPause(true);
    return;
  }
  setShowConfirmPause(false); // Clear dialog before async call
  await doTogglePause(false);
};

const doTogglePause = async (pause: boolean) => {
  setIsLoading(true);
  try {
    // ...
    if (onRefetch) await onRefetch();
    // Remove the setShowConfirmPause(false) here since we do it in handleToggle
  } catch (err) {
    // ...
    setShowConfirmPause(true); // Re-open if save failed
  } finally {
    setIsLoading(false);
  }
};
```

---

### CR-03: Schedule Fires Generated in Synchronous Function Called from Async API (Potential Race in recomputeSchedule)

**File:** `src/lib/scheduler.ts:459-518` and `src/app/api/app-meta/route.ts:41`

**Issue:** The `recomputeSchedule` function is synchronous but called from an async API route. If the route receives two rapid PATCH requests that both call `recomputeSchedule(config)`, they execute sequentially (because they're both in the main thread), but the first one's schedule write may be overwritten by the second before the first request completes its response:

```typescript
// scheduler.ts:459-518 — entirely synchronous, no await
export function recomputeSchedule(
  config: ReturnType<typeof getConfig>,
  nowFn?: () => Date
): void {
  // ... computes fires ...
  writeMeta(db, "schedule_fires", JSON.stringify(scheduledFires));
}

// api/app-meta/route.ts:25-58
export async function PATCH(req: NextRequest) {
  // ...
  recomputeSchedule(config); // Synchronous call, but inside async route
  const meta = getAppMeta(config); // Immediately reads back
  return NextResponse.json({
    // ...
    scheduleFires: newScheduleFires ? JSON.parse(newScheduleFires) : null,
  });
}
```

The issue: if two requests arrive simultaneously and both call `recomputeSchedule`, they both read the same snapshot rows and may compute the same (or slightly different due to `Math.random()` jitter) schedule. More critically, if Request A and Request B both hit this endpoint in quick succession, their reads of `querySnapshots(config, { status: "ok" })` may be interleaved, and writes may race. Although SQLite serializes writes, there's no explicit locking, so concurrent reads from the Python collector could cause consistency issues.

**Fix:**
1. Use SQLite transactions or add a mutex to serialize schedule recomputes
2. Document that `recomputeSchedule` is synchronous and must not be called concurrently
3. Consider adding a `recomputeSchedule` lock flag in `app_meta` to prevent overlapping calls:

```typescript
export function recomputeSchedule(
  config: ReturnType<typeof getConfig>,
  nowFn?: () => Date
): void {
  const db = getDb(config);
  const isRecomputing = readMeta(db, "schedule_recomputing", "false");
  if (isRecomputing === "true") {
    throw new Error("Schedule recomputation already in progress");
  }

  writeMeta(db, "schedule_recomputing", "true");
  try {
    // ... existing logic ...
  } finally {
    writeMeta(db, "schedule_recomputing", "false");
  }
}
```

---

## Warnings

### WR-01: Timezone Offset Calculation in Browser May Be Incorrect During DST Transitions

**File:** `src/components/TimezoneWarningBanner.tsx:6-9`

**Issue:** The `getBrowserUTCOffset()` function computes the UTC offset as `new Date().getTimezoneOffset() / -60`. This returns the *current* offset, which can change during DST transitions. If the user's browser is in a timezone with DST and the warning is displayed near a DST boundary, the offset may differ between when the banner is rendered and when the schedule is computed in the backend (which uses IANA timezone names and Intl APIs that handle DST automatically).

```typescript
function getBrowserUTCOffset(): number {
  // Returns -5 for EST, -7 for PDT, etc.
  return new Date().getTimezoneOffset() / -60;
}
```

This is not a critical bug, but it can cause false positives during DST transitions.

**Fix:**
Store and use IANA timezone names consistently instead of numeric offsets. Or, add a DST-aware comparison:
```typescript
const browserOffset = getBrowserUTCOffset();
// Compute offset for a date range (today + 24 hours) and allow a 1-hour variance
const offsetInTwentyFourHours = new Date(Date.now() + 24 * 60 * 60 * 1000).getTimezoneOffset() / -60;
if (storedOffset !== browserOffset && storedOffset !== offsetInTwentyFourHours) {
  setIsVisible(true);
}
```

---

### WR-02: Missing API Route for `/api/send-now`

**File:** `src/components/SendNowButton.tsx:13`

**Issue:** The `SendNowButton` component calls `fetch("/api/send-now", { method: "POST" })`, but no route handler exists for this endpoint. This will always fail with a 404 error.

```typescript
const response = await fetch("/api/send-now", { method: "POST" });
if (!response.ok) throw new Error("Send failed");
```

**Fix:**
Create `src/app/api/send-now/route.ts`:
```typescript
import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { send } from "@/lib/sender";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const config = getConfig();
    const result = await send(config);
    return NextResponse.json({
      success: true,
      sendLogId: result.id,
      status: result.status,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
```

---

### WR-03: Jitter Range Is 0-5 Inclusive, Documentation Says 0–5 But Code Uses `Math.floor(Math.random() * 6)`

**File:** `src/lib/schedule.ts:53`

**Issue:** The jitter is generated as `Math.floor(Math.random() * 6)`, which produces 0, 1, 2, 3, 4, or 5. The comment and type hint say "0–5 (integer)", which is correct, but this is slightly fragile because `Math.random() * 6` is not uniform across the range — `Math.random()` in JavaScript returns [0, 1), so the maximum value before floor is 5.999..., which floors to 5. This is correct but could be clearer:

```typescript
// Line 53
const jitterMinutes = isAnchor ? 0 : Math.floor(Math.random() * 6); // 0–5 inclusive
```

**Fix:**
Use `Math.floor(Math.random() * 6)` is fine, but a comment clarification would help:
```typescript
// 0–5 inclusive: Math.random() in [0, 1) * 6 = [0, 6), floor = [0, 5]
const jitterMinutes = isAnchor ? 0 : Math.floor(Math.random() * 6);
```

Or use a more explicit helper:
```typescript
const jitterMinutes = isAnchor ? 0 : Math.floor(Math.random() * 6); // 0, 1, 2, 3, 4, or 5
```

---

### WR-04: Timezone Calculation Uses Local String Parsing Which May Fail with Ambiguous Dates

**File:** `src/lib/scheduler.ts:174-183`

**Issue:** The timezone offset calculation in `fireTimeToUtcIso` parses local date components:

```typescript
const localDateParts = new Intl.DateTimeFormat("en-US", {
  timeZone: safeTimezone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).formatToParts(now);

const localYear = localDateParts.find((p) => p.type === "year")?.value ?? "";
const localMonth = localDateParts.find((p) => p.type === "month")?.value ?? "";
const localDay = localDateParts.find((p) => p.type === "day")?.value ?? "";
```

If `formatToParts` fails to return the expected parts (e.g., a future version of Node changes the behavior, or a non-standard locale is used), the fallback `""` produces an invalid ISO string like `--T...`. While this is defensive, a more explicit check would be better:

```typescript
if (!localYear || !localMonth || !localDay) {
  throw new Error(`Failed to parse local date for timezone ${safeTimezone}`);
}
```

---

### WR-05: Schedule Override Validation Missing in ScheduleOverridesPanel

**File:** `src/components/ScheduleOverridesPanel.tsx:132-167`

**Issue:** The override fields accept free-form text input without client-side validation. For example:
- `schedule_override_start_time` accepts any string, but expects "HH:MM" format
- `peak_window_hours` accepts any string, but should be an integer 3–6
- `anchor_offset_minutes` accepts any string, but should be 0–15

Invalid values are sent to the server, which doesn't validate them either (the `PATCH /api/app-meta` route at line 25-58 simply stores whatever is passed). The scheduler then tries to parse them with `parseInt`, which silently coerces invalid strings ("abc" → NaN).

```typescript
// scheduler.ts:301-302
const anchorOffsetMinutes = parseInt(
  readMeta(db, "anchor_offset_minutes", "5"),
  10
);
```

If `anchor_offset_minutes` is "invalid", `parseInt("invalid", 10)` returns `NaN`, which then corrupts schedule calculations.

**Fix:**
1. Add client-side validation in `ScheduleOverridesPanel.tsx`:
```typescript
const validateOverride = (key: string, value: string): string | null => {
  switch (key) {
    case "schedule_override_start_time":
      return /^\d{2}:\d{2}$/.test(value) || value === "" ? null : "Format: HH:MM";
    case "peak_window_hours":
      const n = parseInt(value, 10);
      return (n >= 3 && n <= 6) ? null : "Must be 3–6";
    case "anchor_offset_minutes":
      const m = parseInt(value, 10);
      return (m >= 0 && m <= 15) ? null : "Must be 0–15";
    // ...
  }
};
```

2. Add server-side validation in `PATCH /api/app-meta`:
```typescript
const VALID_KEYS = {
  schedule_override_start_time: (v: string) => /^\d{2}:\d{2}$/.test(v) || v === "",
  peak_window_hours: (v: string) => /^\d+$/.test(v) && parseInt(v, 10) >= 3 && parseInt(v, 10) <= 6,
  // ... etc
};

if (!(body.key in VALID_KEYS) || !VALID_KEYS[body.key as keyof typeof VALID_KEYS](body.value)) {
  return NextResponse.json({ error: "Invalid key or value" }, { status: 400 });
}
```

---

## Info

### IN-01: OptimalScheduleCard Uses Time Comparison Without Handling Timezone Correctly

**File:** `src/components/OptimalScheduleCard.tsx:11-25` and `74-117`

**Issue:** The `getNextFireIndex` function computes the next fire by comparing `nowTotalMinutes` against `fireTotalMinutes` in the component's local timezone:

```typescript
function getNextFireIndex(fires: FireTime[], now: number): number {
  const nowDate = new Date(now);
  const nowHours = nowDate.getHours(); // Local browser time
  const nowMinutes = nowDate.getMinutes();
  const nowTotalMinutes = nowHours * 60 + nowMinutes;

  for (let i = 0; i < fires.length; i++) {
    const fireTotalMinutes = fires[i].hour * 60 + fires[i].minute; // User-local time
    if (fireTotalMinutes >= nowTotalMinutes) {
      return i;
    }
  }
  return 0;
}
```

This assumes the browser's local time is in the same timezone as `fires[].hour` and `fires[].minute`, which are user-local times. If the browser timezone differs from the stored timezone, this comparison will be incorrect.

However, this is mitigated by the fact that `FireTime` values should always be in the user's configured timezone, so if the timezone warning is working correctly, this should be fine.

**Fix:**
Add a comment clarifying this assumption:
```typescript
/**
 * getNextFireIndex - find the next scheduled fire time.
 *
 * Assumes: fires[].hour and fires[].minute are in the user's local timezone,
 * and the browser is also in that timezone. If there's a timezone mismatch,
 * this comparison will be incorrect. The TimezoneWarningBanner should alert
 * the user to update the scheduler timezone if needed.
 */
```

---

### IN-02: Missing Error Boundary for ScheduleData in OptimalScheduleCard

**File:** `src/components/OptimalScheduleCard.tsx:129-134`

**Issue:** The component renders a fallback message if `data?.scheduleData` is null, but doesn't explicitly handle the case where `scheduleData` exists but `scheduleFires` or `tomorrowFires` are undefined. While TypeScript types ensure these are arrays, at runtime a malformed response could cause `.map()` to fail.

```typescript
if (!data?.scheduleData) {
  return (
    <div style={{ padding: "20px", color: "var(--text-tertiary)" }}>
      No schedule data available.
    </div>
  );
}

// If scheduleData exists but scheduleFires is undefined, next line crashes:
const { peakBlock, scheduleFires, tomorrowFires, ... } = data.scheduleData;
```

**Fix:**
Add explicit checks:
```typescript
if (!data?.scheduleData || !Array.isArray(data.scheduleData.scheduleFires)) {
  return <div>No schedule data available.</div>;
}
```

---

### IN-03: Unused Import in OptimalScheduleCard

**File:** `src/components/OptimalScheduleCard.tsx:5`

**Issue:** `import type { FireTime } from "@/lib/schedule"` is imported but `FireTime` type is not explicitly used in component type annotations (it's only used implicitly in `fires: FireTime[]`). This is not a bug, but could be considered unused. TypeScript will not flag this as unused because it's used in the `{ fires: FireTime[] }` destructuring of function parameters.

**Fix:**
Leave as-is; the import is necessary and the type is used implicitly. No action required.

---

### IN-04: Console Error Logging Could Include Sensitive Data

**File:** `src/components/SendNowButton.tsx:20` and similar in other components

**Issue:** Error messages from failed API calls are logged to the browser console without sanitization:

```typescript
console.error("Send failed:", err);
```

If the error message contains sensitive information (e.g., internal server paths, database details), it will be visible in the browser console. This is a low-risk issue in a desktop application, but worth noting for security hygiene.

**Fix:**
Sanitize error messages before logging:
```typescript
const msg = err instanceof Error ? err.message : String(err);
const sanitized = msg.replace(/\/[a-z0-9._-]+\.(db|json|env)/gi, "[file]");
console.error("Send failed:", sanitized);
```

Or use a structured logger that avoids console output in production.

---

## Summary of Findings

**Critical (1):**
- CR-01: Untrusted timezone strings accepted from database without allowlist validation; UI stores numeric offsets instead of IANA names

**Warnings (5):**
- WR-01: DST transition handling fragile in `TimezoneWarningBanner`
- WR-02: `/api/send-now` endpoint does not exist
- WR-03: Jitter generation is correct but could use clearer comments
- WR-04: Timezone calculation lacks explicit validation of Intl.formatToParts output
- WR-05: Schedule override fields lack client- and server-side validation; invalid inputs cause NaN corruption

**Info (4):**
- IN-01: OptimalScheduleCard time comparison assumes browser and server share timezone
- IN-02: Missing explicit array type-check in OptimalScheduleCard
- IN-03: Unused import (minor; not actually unused)
- IN-04: Console errors could leak sensitive information

---

_Reviewed: 2026-04-22T18:30:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
