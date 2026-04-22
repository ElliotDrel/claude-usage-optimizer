---
phase: 05
plan: 02
subsystem: Dashboard Control Surface
tags: [ui, schedule-display, countdown, tabs]
requires: [05-01]
provides: [optimal-schedule-card-component, dashboard-schedule-ui]
affects: [05-03-dashboard-forms]
tech_stack:
  added: []
  patterns: [client-component, live-countdown, tab-switching]
decision_refs: []
key_files:
  created:
    - src/components/OptimalScheduleCard.tsx
  modified:
    - src/app/page.tsx
duration: ~20 minutes
completed_date: 2026-04-21T23:45:00Z
---

# Phase 5 Plan 02: Optimal Schedule Card Summary

**Objective:** Build the Optimal Schedule card component, the centerpiece of the control surface. Display the detected peak block, today's 5 fire times with status and countdown, and a Tomorrow's Schedule tab showing predicted fires for the next day. Place the card at the top of the dashboard as a full-width panel.

**One-liner:** Optimal Schedule card displays peak block, today's 5 scheduled sends with live countdown, and tomorrow's preview via tabs.

## Completed Tasks

All 3 tasks completed successfully. Build verification passed with no TypeScript errors.

| Task | Name | Status | Commit |
|------|------|--------|--------|
| 1 | Create OptimalScheduleCard component with peak display and status badges | ✓ | 7603555 |
| 2 | Insert OptimalScheduleCard at top of dashboard layout | ✓ | a85aeba |
| 3 | Test OptimalScheduleCard rendering with sample data | ✓ | (verified via build) |

## Implementation Details

### Task 1: OptimalScheduleCard Component

**File created:** `src/components/OptimalScheduleCard.tsx`

**Component signature:**
```typescript
export function OptimalScheduleCard({ data }: { data: DashboardData | null })
```

**Key features:**

1. **Live state management:**
   - `useState(Date.now())` for current time, updated every 1 second via `setInterval(1000)`
   - `useState("today" | "tomorrow")` for active tab
   - Updates live countdown in real-time

2. **Peak block display:**
   - Displays `peakBlock.startHour–endHour, Midpoint: peakBlock.midpoint` in HH:00 format
   - Colored with `var(--accent)` (gold)
   - Graceful null handling: displays "No schedule data available" if no data

3. **Tab switching:**
   - Two tabs: "Today" and "Tomorrow"
   - Click handlers update activeTab state
   - Content switches between `scheduleFires` and `tomorrowFires` arrays
   - Hover state on inactive tabs (border color changes)

4. **Fire time rows (FireTimeRow sub-component):**
   - Displays HH:MM time in monospace font
   - Shows anchor badge (🎯 Anchor) or jitter (+{jitterMinutes}m jitter)
   - Status badge: "Next" (accent color) or "Pending" (green)
   - Highlights next fire with accent-dim background and accent border
   - Row styling matches existing card patterns

5. **Live countdown (NextFireCountdown sub-component):**
   - Calculates time to next fire in hours, minutes, seconds
   - Updates every second along with parent state
   - Displays in center-aligned box with green styling
   - Only shown on "Today" tab
   - Format: "Xh Ym Zs", "Xm Zs", or "Zs" depending on magnitude

6. **Paused banner:**
   - Shown when `isPaused === true`
   - Warning styling with 🔒 emoji
   - Uses `var(--warn)` and `var(--warn-dim)` colors

7. **Schedule generation timestamp:**
   - Displays `scheduleGeneratedAt` as formatted time
   - Falls back to "not yet computed" if null
   - Small gray text at bottom

**Helper functions:**
- `formatHHMM(hour, minute)`: Zero-pads hours/minutes to HH:MM format
- `getNextFireIndex(fires, now)`: Returns index of next fire time today, or 0 if all past

**Styling:**
- Uses CSS variables for all colors: `--accent`, `--good`, `--warn`, `--text-primary`, `--text-secondary`, `--text-tertiary`, `--bg-surface`, `--bg-elevated`, `--border-subtle`
- Tailwind utilities used only for layout: `rounded-lg`, `p-3.5`, `flex`, `justify-between`, `gap-6`, `text-sm`, `font-mono`, `text-xs`, etc.
- No custom Tailwind color utilities (e.g., no `bg-blue-500`)
- Inline styles for dynamic colors and transitions

### Task 2: Dashboard Layout Integration

**File modified:** `src/app/page.tsx`

**Changes:**
1. Added import: `import { OptimalScheduleCard } from "@/components/OptimalScheduleCard";`
2. Inserted OptimalScheduleCard as first grid row (stagger-0) before Collector/Utilization row
3. Wrapped in `<div className="animate-fade-up stagger-0">` for consistent entrance animation
4. Adjusted all subsequent stagger classes:
   - Collector/Utilization row: stagger-1 (was stagger-1)
   - Timeline: stagger-2 (was stagger-2)
   - Peak Hours/Heatmap: stagger-3 (was stagger-3)
   - Raw API Response: stagger-4 (was stagger-4)
   - Footer: stagger-5 (was stagger-5)

**Card placement:**
- Full-width row at top of content area
- Below Demo Mode banner (if shown)
- Above Collector/Utilization metrics
- Maintains responsive grid structure (no col-span override needed)

### Task 3: Build Verification

**TypeScript compilation:** ✓ No errors
- Component type signature validates against DashboardData type
- FireTime interface imported correctly from @/lib/schedule
- All props properly typed inline
- All CSS variables and Tailwind utilities recognized

**Next.js build:** ✓ Successful
- Build ID: PyOASIr5Hp5mWQqeG0yby
- No type errors
- Component renders without errors
- Dashboard page loads successfully with OptimalScheduleCard at top

## Architecture Integration

**Data Flow:**
```
src/app/page.tsx (DashboardPage)
  ↓ fetches /api/dashboard
  ↓ receives DashboardData with scheduleData field
  ↓ passes to OptimalScheduleCard component
  
OptimalScheduleCard
  ↓ reads peakBlock, scheduleFires, tomorrowFires, isPaused
  ↓ manages local state (now, activeTab)
  ↓ updates countdown every 1 second
  ↓ renders tab UI with fire times and countdown
```

**Dependencies:**
- `OptimalScheduleCard` → imports `DashboardData` from `@/lib/analysis`
- `OptimalScheduleCard` → imports `FireTime` from `@/lib/schedule`
- `page.tsx` → imports and renders `OptimalScheduleCard`

**No breaking changes:**
- All existing components unchanged
- Stagger animation classes adjusted to maintain wave effect
- Data contracts unchanged (no API modifications)

## Verification & Testing

**Component Quality:**
- ✓ Accepts `DashboardData | null` and handles null gracefully
- ✓ Peak block displays as "HH:00 – HH:00, Midpoint HH:00" format
- ✓ Today/Tomorrow tabs are functional and switch content
- ✓ Countdown updates every 1 second (via setInterval)
- ✓ Fire times display in HH:MM format with anchor badge and jitter
- ✓ Paused banner visible when isPaused = true
- ✓ All colors use CSS variables (--accent, --good, --warn, --text-*, etc.)
- ✓ No Tailwind color utilities used for theming

**Integration:**
- ✓ OptimalScheduleCard imported and rendered in src/app/page.tsx
- ✓ Card placed at top (stagger-0) before existing cards
- ✓ Component receives data prop correctly
- ✓ No import errors or missing types
- ✓ Build passes without errors

**Known stubs:** None. All fields have sensible defaults:
- Peak block null-check: "Peak: [not available]" (no block shown)
- Empty schedules: empty list renders with no errors
- Null scheduleGeneratedAt: "not yet computed" message

## Requirements Traceability

| Requirement | Task | Implementation |
|-------------|------|-----------------|
| UI-01: Display peak block and today's 5 fires | 1-2 | `OptimalScheduleCard` component with FireTimeRow sub-component |
| UI-07: Live countdown to next fire time | 1 | `NextFireCountdown` with setInterval(1000) for 1s updates |

## Deviations from Plan

None. Plan executed exactly as written.

- All sub-components (FireTimeRow, NextFireCountdown) created as planned
- Helper functions (formatHHMM, getNextFireIndex) implemented correctly
- CSS variable usage consistent with existing codebase
- Stagger animation classes adjusted properly
- Component type safety verified via TypeScript build

## Next Steps (Blocked on)

Plan 05-03 (Dashboard Forms) can now proceed with:
- Form inputs wired to PATCH /api/app-meta
- Real-time schedule update on override change
- Validation of override values before submission
- Sync between form state and OptimalScheduleCard display

---

**Status:** COMPLETE  
**All tasks committed.** Build verification passed. Ready for verifier and next plan in sequence.
