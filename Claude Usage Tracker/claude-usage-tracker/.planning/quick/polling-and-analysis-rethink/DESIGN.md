# Polling & Analysis Rethink

## Problem

The current collector uses a fixed 5-minute `setInterval` and the analysis layer has complex sliding-window dropoff compensation logic (~50 lines) that requires 5+ hours of historical data to work. Real data confirms the API windows are **fixed, not sliding** — they reset at a specific `resets_at` time. The analysis complexity is unnecessary.

Polling is also dumb — same interval whether you're actively using Claude or asleep.

## Goals

1. Replace dropoff compensation with simple reset-aware delta tracking
2. Replace fixed-interval polling with adaptive 4-tier system
3. Target **1% resolution** — poll fast enough that each snapshot captures ~1% change
4. Switch from `setInterval` to `setTimeout` to prevent overlap
5. Add error backoff so we don't hammer a broken endpoint

---

## Part 1: Analysis — Reset-Aware Delta Tracking

### What changes

Delete `estimateNewUsage()`, `findClosestSnapshot()`, and `FIVE_HOURS_MS` from `src/lib/analysis.ts`.

Replace with a single `computeDelta()` function:

```
computeDelta(prev, curr, windowKey):
    prevUtil = prev[windowKey + '_utilization']
    currUtil = curr[windowKey + '_utilization']

    if currUtil is null → return 0
    if prevUtil is null → return currUtil
    if prev[windowKey + '_resets_at'] !== curr[windowKey + '_resets_at'] → return currUtil
    return max(0, currUtil - prevUtil)
```

Logic:
- **Same window** (`resets_at` unchanged): delta = current - previous
- **Window reset** (`resets_at` changed): delta = current value (it reset to 0, then grew to this)
- **Null utilization** (just reset, no usage yet): delta = 0

Applied independently to both 5-hour and 7-day windows.

### What stays the same

- `buildActivity()` shape — still iterates consecutive snapshot pairs, accumulates into hourly bars and heatmap cells
- `buildDashboardData()` orchestration — unchanged
- All interfaces (`HourlyBar`, `HeatmapCell`, `TimelinePoint`, `DashboardData`) — unchanged

---

## Part 2: Polling — Adaptive 4-Tier System

### Tier definitions

| Tier   | Interval | Enter condition                          | Exit condition                     |
|--------|----------|------------------------------------------|------------------------------------|
| Idle   | 5 min    | No change for 3 consecutive polls        | Default starting tier              |
| Light  | 2.5 min  | Any delta detected                       | No change for 3 polls → Idle      |
| Active | 1 min    | Delta detected while at Light            | No change for 3 polls → Light     |
| Burst  | 30 sec   | Delta >= 3% in one poll while at Active  | Delta < 2% for 3 polls → Active   |

Rules:
- Always step **one tier at a time** in both directions (never jump Burst → Idle)
- Hard minimum of **30 seconds** between polls
- Tier transitions based on **5-hour window delta** (the fast-moving window)

### setTimeout, not setInterval

Replace the current `setInterval` in `src/lib/collector.ts` with self-scheduling `setTimeout`:

```
after each poll completes:
    determine current tier based on result
    schedule next poll with setTimeout(pollOnce, tier.interval)
```

This prevents overlapping polls entirely. The current code has a `this.polling` mutex flag — that becomes unnecessary.

### Runtime state additions

Add to `CollectorState`:
- `currentTier: 'idle' | 'light' | 'active' | 'burst'`
- `nextPollAt: string | null`
- `consecutiveNoChange: number`

Remove:
- `pollIntervalMs` (replaced by tier system)

### Error backoff

On consecutive failures, escalate delay:
- 1st failure: 1 min
- 2nd: 2 min
- 3rd: 5 min
- 4th+: 10 min (cap)

On success, reset to current tier's interval. On auth errors (401/403), hold at 10 min until next manual poll succeeds.

---

## Part 3: Manual Poll & UI Changes

### Manual poll behavior

- If a poll is in flight → return `skipped`
- If last poll was < 30s ago → return `skipped` (unless `force: true` is passed)
- A successful manual poll **resets the setTimeout timer** from now

### UI changes

- Show `currentTier` and `nextPollAt` in the health panel
- Show manual poll cooldown state instead of silently skipping
- Dashboard refresh stays at 15s (no change)

---

## Part 4: Config Changes

### `src/lib/config.ts`

Replace `POLL_INTERVAL_MS` with:
- `POLL_MIN_MS` — hard floor (default: 30000)

The 4 tier intervals are hardcoded constants, not env vars. They're implementation details, not user config. If someone wants to tune them, they change the code.

Keep: `CLAUDE_BEARER_TOKEN`, `CLAUDE_SESSION_COOKIE`, `CLAUDE_USAGE_ENDPOINT`, `DATA_DIR`, `PORT`.

---

## Files Changed

| File | Change |
|------|--------|
| `src/lib/analysis.ts` | Delete ~50 lines (estimateNewUsage, findClosestSnapshot, FIVE_HOURS_MS). Add ~10 line `computeDelta()`. Update `buildActivity()` to call it. |
| `src/lib/collector.ts` | Replace `setInterval` with `setTimeout`. Add tier logic, error backoff, `scheduleNext()`. Update `CollectorState`. |
| `src/lib/config.ts` | Replace `POLL_INTERVAL_MS` / `sanitizeInterval()` with `POLL_MIN_MS`. |
| `src/app/api/poll/route.ts` | Add cooldown check, `force` flag, timer reset on success. |
| `src/app/page.tsx` | Show tier, next poll time, cooldown state in health panel. |
| `src/components/CollectorHealth.tsx` | Display new runtime fields. |

No database schema changes. No new dependencies.

---

## What This Does NOT Change

- Database schema — no new columns
- Snapshot storage format — same `insertSnapshot()` call
- Dashboard components (UsageTimeline, PeakHours, Heatmap) — they consume the same `DashboardData` interface
- Auth logic — untouched
- Normalize logic — untouched
