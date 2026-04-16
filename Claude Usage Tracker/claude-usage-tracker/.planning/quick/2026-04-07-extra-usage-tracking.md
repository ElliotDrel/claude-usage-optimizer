# Extra Usage Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track Claude's paid extra usage (credits spent beyond plan limits) as a first-class metric — stored in dedicated DB columns, surfaced in the dashboard, and weighted into analytics so periods of extra usage show their true intensity.

**Architecture:** Add dedicated `extra_usage_*` columns to the database schema via migration. Extract extra usage fields during normalization alongside the existing `five_hour`/`seven_day` extraction. Add a new `ExtraUsageCard` component for the paid-credits dashboard display, keep the existing `ExtraUsage` component for raw API response display, and integrate extra usage into the timeline chart and activity analytics.

**Tech Stack:** Next.js 15, TypeScript, better-sqlite3, Recharts, date-fns

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/db.ts` | Modify | Add `extra_usage_*` columns via migration, update `SnapshotRow` and `insertSnapshot` |
| `src/lib/normalize.ts` | Modify | Add `ExtraUsageData` type, extract structured extra usage from payload |
| `src/lib/collector.ts` | Modify | Pass extracted extra usage fields to `insertSnapshot` |
| `src/lib/analysis.ts` | Modify | Add `extraUsage` to `DashboardData`, include extra credits in timeline and activity |
| `src/components/ExtraUsageCard.tsx` | Create | Dashboard card showing extra usage status, credits spent, and budget utilization |
| `src/components/UsageTimeline.tsx` | Modify | Add extra usage credit line to timeline chart |
| `src/components/ExtraUsage.tsx` | Modify | Rename section label from "Extra Data" to "Raw API Response" for clarity |
| `src/app/page.tsx` | Modify | Add `ExtraUsageCard` to dashboard layout, rename raw section |

---

### Task 1: Database Schema Migration

**Files:**
- Modify: `src/lib/db.ts:7-28` (SCHEMA), `src/lib/db.ts:40-53` (SnapshotRow), `src/lib/db.ts:55-92` (insertSnapshot)

- [ ] **Step 1: Add migration columns to SCHEMA**

In `src/lib/db.ts`, add a migration block after the existing `SCHEMA` constant. SQLite doesn't error on `ALTER TABLE ... ADD COLUMN` if we guard with a helper. Add a new `MIGRATIONS` constant and apply it in `getDb`:

```typescript
const MIGRATIONS = `
ALTER TABLE usage_snapshots ADD COLUMN extra_usage_enabled INTEGER;
ALTER TABLE usage_snapshots ADD COLUMN extra_usage_monthly_limit REAL;
ALTER TABLE usage_snapshots ADD COLUMN extra_usage_used_credits REAL;
ALTER TABLE usage_snapshots ADD COLUMN extra_usage_utilization REAL;
`;
```

In `getDb()`, after `db.exec(SCHEMA)`, add:

```typescript
for (const stmt of MIGRATIONS.trim().split("\n").filter(Boolean)) {
  try {
    db.exec(stmt);
  } catch {
    // Column already exists — safe to ignore
  }
}
```

- [ ] **Step 2: Update SnapshotRow interface**

Add these fields to the `SnapshotRow` interface at line 40:

```typescript
export interface SnapshotRow {
  id: number;
  timestamp: string;
  status: string;
  endpoint: string | null;
  auth_mode: string | null;
  response_status: number | null;
  five_hour_utilization: number | null;
  five_hour_resets_at: string | null;
  seven_day_utilization: number | null;
  seven_day_resets_at: string | null;
  extra_usage_enabled: number | null;       // 0 or 1 (SQLite boolean)
  extra_usage_monthly_limit: number | null;
  extra_usage_used_credits: number | null;
  extra_usage_utilization: number | null;
  raw_json: string | null;
  error_message: string | null;
}
```

- [ ] **Step 3: Update insertSnapshot to accept and store extra usage**

Update the `insertSnapshot` function's `data` parameter and SQL:

```typescript
export function insertSnapshot(
  config: Config,
  data: {
    timestamp: string;
    status: string;
    endpoint: string;
    authMode: string;
    responseStatus: number;
    fiveHourUtilization: number | null;
    fiveHourResetsAt: string | null;
    sevenDayUtilization: number | null;
    sevenDayResetsAt: string | null;
    extraUsageEnabled: boolean | null;
    extraUsageMonthlyLimit: number | null;
    extraUsageUsedCredits: number | null;
    extraUsageUtilization: number | null;
    rawJson: string | null;
    errorMessage: string | null;
  }
): void {
  const db = getDb(config);
  db.prepare(`
    INSERT INTO usage_snapshots
      (timestamp, status, endpoint, auth_mode, response_status,
       five_hour_utilization, five_hour_resets_at,
       seven_day_utilization, seven_day_resets_at,
       extra_usage_enabled, extra_usage_monthly_limit,
       extra_usage_used_credits, extra_usage_utilization,
       raw_json, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.timestamp,
    data.status,
    data.endpoint,
    data.authMode,
    data.responseStatus,
    data.fiveHourUtilization,
    data.fiveHourResetsAt,
    data.sevenDayUtilization,
    data.sevenDayResetsAt,
    data.extraUsageEnabled != null ? (data.extraUsageEnabled ? 1 : 0) : null,
    data.extraUsageMonthlyLimit,
    data.extraUsageUsedCredits,
    data.extraUsageUtilization,
    data.rawJson,
    data.errorMessage
  );
}
```

- [ ] **Step 4: Verify the app starts without errors**

Run: `npm run dev` (or check the already-running dev server logs)
Expected: No errors. Existing snapshots still load (new columns are nullable).

- [ ] **Step 5: Commit**

```bash
git add src/lib/db.ts
git commit -m "feat: add extra_usage columns to database schema"
```

---

### Task 2: Normalize Extra Usage from API Payload

**Files:**
- Modify: `src/lib/normalize.ts:1-67`

- [ ] **Step 1: Add ExtraUsageData type**

Add this interface after the existing `NormalizedExtra` interface (line 17):

```typescript
export interface ExtraUsageData {
  isEnabled: boolean;
  monthlyLimit: number | null;
  usedCredits: number | null;
  utilization: number | null;
}
```

- [ ] **Step 2: Add extraUsage to NormalizedPayload**

Update the `NormalizedPayload` interface:

```typescript
export interface NormalizedPayload {
  windows: NormalizedWindow[];
  extras: NormalizedExtra[];
  extraUsage: ExtraUsageData | null;
  unknownKeys: Record<string, unknown>;
}
```

- [ ] **Step 3: Extract extra usage in normalizeUsagePayload**

Update the function to parse `extra_usage` into the structured type instead of just passing it through to extras:

```typescript
export function normalizeUsagePayload(
  payload: Record<string, unknown>
): NormalizedPayload {
  const windows: NormalizedWindow[] = [];
  const extras: NormalizedExtra[] = [];
  const unknownKeys: Record<string, unknown> = {};
  let extraUsage: ExtraUsageData | null = null;

  for (const [key, value] of Object.entries(payload)) {
    if (isUsageBucket(value)) {
      windows.push({
        key,
        label: toLabel(key),
        utilization: value.utilization,
        resetsAt: value.resets_at,
      });
    } else if (key === "extra_usage" && value && typeof value === "object") {
      const eu = value as Record<string, unknown>;
      extraUsage = {
        isEnabled: eu.is_enabled === true,
        monthlyLimit: typeof eu.monthly_limit === "number" ? eu.monthly_limit : null,
        usedCredits: typeof eu.used_credits === "number" ? eu.used_credits : null,
        utilization: typeof eu.utilization === "number" ? eu.utilization : null,
      };
      // Still push to extras for raw display
      extras.push({ key, label: toLabel(key), value });
    } else {
      unknownKeys[key] = value;
    }
  }

  windows.sort((a, b) => a.label.localeCompare(b.label));
  return { windows, extras, extraUsage, unknownKeys };
}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/normalize.ts
git commit -m "feat: extract structured extra usage data from API payload"
```

---

### Task 3: Pass Extra Usage Through Collector to DB

**Files:**
- Modify: `src/lib/collector.ts:264-290` (the pollOnce success path)

- [ ] **Step 1: Read the current collector insertSnapshot call**

The relevant section is around line 264-290 in collector.ts where `insertSnapshot` is called after normalization.

- [ ] **Step 2: Update the insertSnapshot call to include extra usage fields**

After `const normalized = normalizeUsagePayload(payload);` (line 264), update the `insertSnapshot` call:

```typescript
      const normalized = normalizeUsagePayload(payload);
      const fiveHour = normalized.windows.find((w) => w.key === "five_hour");
      const sevenDay = normalized.windows.find((w) => w.key === "seven_day");

      insertSnapshot(this.config, {
        timestamp: new Date().toISOString(),
        status: "ok",
        endpoint: this.config.endpoint,
        authMode: this.config.authMode,
        responseStatus: response.status,
        fiveHourUtilization: fiveHour?.utilization ?? null,
        fiveHourResetsAt: fiveHour?.resetsAt ?? null,
        sevenDayUtilization: sevenDay?.utilization ?? null,
        sevenDayResetsAt: sevenDay?.resetsAt ?? null,
        extraUsageEnabled: normalized.extraUsage?.isEnabled ?? null,
        extraUsageMonthlyLimit: normalized.extraUsage?.monthlyLimit ?? null,
        extraUsageUsedCredits: normalized.extraUsage?.usedCredits ?? null,
        extraUsageUtilization: normalized.extraUsage?.utilization ?? null,
        rawJson: JSON.stringify(payload),
        errorMessage: null,
      });
```

- [ ] **Step 3: Update the error insertSnapshot call too**

Find the error path's `insertSnapshot` call (around line 305-320) and add the four null extra usage fields:

```typescript
        extraUsageEnabled: null,
        extraUsageMonthlyLimit: null,
        extraUsageUsedCredits: null,
        extraUsageUtilization: null,
```

- [ ] **Step 4: Update the demo mode insertSnapshot call**

Find the demo/simulated poll path (around line 389+) and add the four null extra usage fields there too.

- [ ] **Step 5: Verify the app compiles**

Check the dev server for TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/collector.ts
git commit -m "feat: pass extra usage fields from collector to database"
```

---

### Task 4: Add Extra Usage to Dashboard Data and Analytics

**Files:**
- Modify: `src/lib/analysis.ts:18-56` (types), `src/lib/analysis.ts:184-239` (buildDashboardData)

- [ ] **Step 1: Add ExtraUsageSnapshot type and update TimelinePoint**

Add after the existing `TimelinePoint` interface:

```typescript
export interface ExtraUsageSnapshot {
  isEnabled: boolean;
  monthlyLimit: number | null;
  usedCredits: number | null;
  utilization: number | null;
}
```

Update `TimelinePoint`:

```typescript
export interface TimelinePoint {
  timestamp: string;
  fiveHourUtilization: number | null;
  sevenDayUtilization: number | null;
  extraUsageUsedCredits: number | null;
}
```

- [ ] **Step 2: Add extraUsage to DashboardData**

Add to the `DashboardData` interface, inside `current`:

```typescript
  current: {
    timestamp: string;
    fiveHour: { utilization: number; resetsAt: string } | null;
    sevenDay: { utilization: number; resetsAt: string } | null;
    extraUsage: ExtraUsageSnapshot | null;
    rawJson: Record<string, unknown> | null;
  } | null;
```

- [ ] **Step 3: Populate extraUsage in buildDashboardData**

In the `buildDashboardData` function, update the `current` block (around line 194-214):

```typescript
  let current: DashboardData["current"] = null;
  if (lastSuccess) {
    current = {
      timestamp: lastSuccess.timestamp,
      fiveHour:
        lastSuccess.five_hour_utilization != null
          ? {
              utilization: lastSuccess.five_hour_utilization,
              resetsAt: lastSuccess.five_hour_resets_at!,
            }
          : null,
      sevenDay:
        lastSuccess.seven_day_utilization != null
          ? {
              utilization: lastSuccess.seven_day_utilization,
              resetsAt: lastSuccess.seven_day_resets_at!,
            }
          : null,
      extraUsage:
        lastSuccess.extra_usage_enabled != null
          ? {
              isEnabled: lastSuccess.extra_usage_enabled === 1,
              monthlyLimit: lastSuccess.extra_usage_monthly_limit,
              usedCredits: lastSuccess.extra_usage_used_credits,
              utilization: lastSuccess.extra_usage_utilization,
            }
          : null,
      rawJson: safeParseJson(lastSuccess.raw_json),
    };
  }
```

- [ ] **Step 4: Add extra usage credits to timeline**

Update the timeline mapping:

```typescript
  const timeline: TimelinePoint[] = successSnapshots.map((s) => ({
    timestamp: s.timestamp,
    fiveHourUtilization: s.five_hour_utilization,
    sevenDayUtilization: s.seven_day_utilization,
    extraUsageUsedCredits: s.extra_usage_used_credits,
  }));
```

- [ ] **Step 5: Weight extra usage into activity analytics**

In `buildActivity` (line 87-126), after the existing `newUsage` delta calculation, also factor in extra usage credit changes. Update the loop body:

```typescript
  for (let i = 1; i < okSnapshots.length; i++) {
    const prev = okSnapshots[i - 1];
    const curr = okSnapshots[i];

    const newUsage = computeDelta(prev, curr, "five_hour");

    // Extra usage credit delta — spending credits = high-priority usage
    const prevCredits = prev.extra_usage_used_credits ?? 0;
    const currCredits = curr.extra_usage_used_credits ?? 0;
    const creditDelta = Math.max(0, currCredits - prevCredits);

    // Weight extra usage: $1 spent ≈ 1% utilization point for activity weighting
    const totalActivity = newUsage + creditDelta;
    if (totalActivity <= 0) continue;

    const ts = new Date(curr.timestamp);
    const dayIndex = ts.getDay();
    const hour = ts.getHours();

    hourlyBars[hour].totalDelta += totalActivity;
    hourlyBars[hour].sampleCount++;

    const cell = heatmap[dayIndex * 24 + hour];
    cell.totalDelta += totalActivity;
    cell.sampleCount++;
  }
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/analysis.ts
git commit -m "feat: add extra usage to dashboard data and weight into analytics"
```

---

### Task 5: Create Extra Usage Dashboard Card

**Files:**
- Create: `src/components/ExtraUsageCard.tsx`

- [ ] **Step 1: Create the ExtraUsageCard component**

Create `src/components/ExtraUsageCard.tsx`:

```tsx
"use client";

import type { DashboardData } from "@/lib/analysis";

function budgetColor(pct: number): string {
  if (pct >= 80) return "var(--danger)";
  if (pct >= 50) return "var(--warn)";
  return "var(--accent)";
}

function budgetBg(pct: number): string {
  if (pct >= 80) return "var(--danger-dim)";
  if (pct >= 50) return "var(--warn-dim)";
  return "var(--accent-dim)";
}

export function ExtraUsageCard({ data }: { data: DashboardData | null }) {
  const extra = data?.current?.extraUsage;

  if (!extra) {
    return (
      <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
        No extra usage data available.
      </p>
    );
  }

  if (!extra.isEnabled) {
    return (
      <div
        className="rounded-lg p-4"
        style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <div className="flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: "var(--text-tertiary)" }}
          />
          <span
            className="text-[10px] tracking-[0.15em] uppercase"
            style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}
          >
            Extra Usage Disabled
          </span>
        </div>
      </div>
    );
  }

  const pct = extra.utilization ?? 0;
  const color = budgetColor(pct);
  const bg = budgetBg(pct);

  return (
    <div className="grid grid-cols-1 gap-3">
      {/* Budget utilization bar */}
      <div
        className="rounded-lg p-4 relative overflow-hidden"
        style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <div
          className="absolute inset-0 opacity-100 transition-all duration-700"
          style={{
            background: `linear-gradient(to right, ${bg} ${pct}%, transparent ${pct}%)`,
          }}
        />
        <div className="relative flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span
                className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                style={{
                  fontFamily: "var(--font-mono)",
                  color,
                  background: bg,
                  letterSpacing: "0.05em",
                }}
              >
                EXTRA
              </span>
              <span
                className="text-[10px] tracking-[0.15em] uppercase"
                style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}
              >
                Monthly Budget
              </span>
            </div>
          </div>
          <div
            className="text-3xl font-bold tabular-nums"
            style={{ fontFamily: "var(--font-mono)", color }}
          >
            {pct.toFixed(1)}
            <span className="text-lg opacity-60">%</span>
          </div>
        </div>
      </div>

      {/* Credits detail */}
      <div
        className="rounded-lg p-4"
        style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p
              className="text-[10px] tracking-[0.15em] uppercase mb-1"
              style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}
            >
              Credits Used
            </p>
            <p
              className="text-sm font-semibold"
              style={{ color: "var(--text-accent)", fontFamily: "var(--font-mono)" }}
            >
              ${extra.usedCredits?.toFixed(2) ?? "0.00"}
            </p>
          </div>
          <div>
            <p
              className="text-[10px] tracking-[0.15em] uppercase mb-1"
              style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}
            >
              Monthly Limit
            </p>
            <p
              className="text-sm font-semibold"
              style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}
            >
              ${extra.monthlyLimit?.toFixed(2) ?? "---"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ExtraUsageCard.tsx
git commit -m "feat: add ExtraUsageCard component for paid usage tracking"
```

---

### Task 6: Add Extra Usage Credits to Timeline Chart

**Files:**
- Modify: `src/components/UsageTimeline.tsx:17-20` (COLORS), `src/components/UsageTimeline.tsx:39-45` (chartData), `src/components/UsageTimeline.tsx:80-176` (chart)

- [ ] **Step 1: Add color for extra usage**

Add to the `COLORS` constant:

```typescript
const COLORS = {
  fiveHour: "#d4a056",
  sevenDay: "#7ba3c9",
  extraCredits: "#c97bb5",
};
```

- [ ] **Step 2: Add extra credits to chart data mapping**

Update the `.map()` in the `chartData` memo:

```typescript
      .map((point) => ({
        time: new Date(point.timestamp).getTime(),
        "5-Hour": point.fiveHourUtilization,
        "7-Day": point.sevenDayUtilization,
        "Extra Credits ($)": point.extraUsageUsedCredits,
      }));
```

- [ ] **Step 3: Add gradient definition for extra credits**

Add after the existing `grad7d` gradient definition (around line 86-89):

```tsx
              <linearGradient id="gradExtra" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={COLORS.extraCredits} stopOpacity={0.2} />
                <stop offset="100%" stopColor={COLORS.extraCredits} stopOpacity={0} />
              </linearGradient>
```

- [ ] **Step 4: Add a second YAxis for credits and the Area component**

Add a right-side YAxis for dollar amounts. After the existing `<YAxis>` (line 106-113), add:

```tsx
            <YAxis
              yAxisId="credits"
              orientation="right"
              stroke="transparent"
              tick={{ fill: "var(--text-tertiary)", fontFamily: "var(--font-mono)", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `$${v}`}
            />
```

Update the existing `<YAxis>` to have `yAxisId="utilization"`:

```tsx
            <YAxis
              yAxisId="utilization"
              domain={[0, 100]}
              ...
```

Update the existing two `<Area>` components to include `yAxisId="utilization"`:

```tsx
            <Area
              yAxisId="utilization"
              type="monotone"
              dataKey="5-Hour"
              ...
            <Area
              yAxisId="utilization"
              type="monotone"
              dataKey="7-Day"
              ...
```

Add the extra credits Area after the 7-Day Area:

```tsx
            <Area
              yAxisId="credits"
              type="monotone"
              dataKey="Extra Credits ($)"
              stroke={COLORS.extraCredits}
              fill="url(#gradExtra)"
              strokeWidth={2}
              dot={range === "1d" ? {
                r: 2,
                fill: COLORS.extraCredits,
                stroke: "var(--bg-surface)",
                strokeWidth: 1,
              } : false}
              connectNulls
              activeDot={{
                r: 4,
                fill: COLORS.extraCredits,
                stroke: "var(--bg-surface)",
                strokeWidth: 2,
              }}
            />
```

- [ ] **Step 5: Update tooltip formatter to handle both units**

Update the `formatter` prop on the Tooltip:

```tsx
              formatter={(value, name) => {
                if (name === "Extra Credits ($)") return [`$${Number(value).toFixed(2)}`];
                return [`${Number(value).toFixed(1)}%`];
              }}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/UsageTimeline.tsx
git commit -m "feat: show extra usage credits on timeline chart"
```

---

### Task 7: Update Dashboard Layout

**Files:**
- Modify: `src/app/page.tsx:10` (imports), `src/app/page.tsx:176-209` (layout)
- Modify: `src/components/ExtraUsage.tsx` (rename section label context)

- [ ] **Step 1: Add import for ExtraUsageCard**

Add after the existing ExtraUsage import (line 10):

```typescript
import { ExtraUsageCard } from "@/components/ExtraUsageCard";
```

- [ ] **Step 2: Add ExtraUsageCard section to dashboard**

Insert a new section after the Utilization section (after line 188, before the Timeline section). Update the grid to give extra usage its own spot alongside utilization:

Replace the existing grid (lines 177-188):

```tsx
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 animate-fade-up stagger-1">
          <div className="lg:col-span-2">
            <Section title="Collector" label="System Health">
              <CollectorHealth data={data} />
            </Section>
          </div>
          <div className="lg:col-span-1">
            <Section title="Utilization" label="Current">
              <UsageCards data={data} />
            </Section>
          </div>
          <div className="lg:col-span-2">
            <Section title="Extra Usage" label="Paid Credits">
              <ExtraUsageCard data={data} />
            </Section>
          </div>
        </div>
```

- [ ] **Step 3: Rename the raw API section**

Update the existing Extra Data section label (around line 206-208):

```tsx
        <div className="animate-fade-up stagger-4">
          <Section title="Raw API Response" label="All Fields">
            <ExtraUsage data={data} />
          </Section>
        </div>
```

- [ ] **Step 4: Verify the dashboard renders correctly**

Open `http://localhost:3017` in a browser.
Expected: New "Extra Usage / Paid Credits" section appears. If extra usage is disabled, shows "Extra Usage Disabled" pill. If enabled, shows budget bar and credit details. Raw API Response section still shows all fields. Timeline chart still renders.

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx src/components/ExtraUsage.tsx
git commit -m "feat: add extra usage card to dashboard, rename raw section"
```

---

## Summary

| Task | What it does |
|------|-------------|
| 1 | DB schema migration — new columns for extra usage fields |
| 2 | Normalize API payload — structured `ExtraUsageData` extraction |
| 3 | Collector — pipe extra usage fields from API to DB |
| 4 | Analysis — add extra usage to dashboard data, timeline, and weight into activity |
| 5 | ExtraUsageCard component — visual display of paid credits |
| 6 | Timeline chart — extra credits as a third line with right-side $ axis |
| 7 | Dashboard layout — wire everything together, rename raw section |
