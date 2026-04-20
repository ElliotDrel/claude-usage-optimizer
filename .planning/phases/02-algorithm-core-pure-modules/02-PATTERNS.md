# Phase 2: Algorithm Core (Pure Modules) - Pattern Map

**Mapped:** 2026-04-20
**Files analyzed:** 4 (new)
**Analogs found:** 3 / 4

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `claude-usage-tracker/src/lib/peak-detector.ts` | library (pure function) | CRUD (hourly bucketing + aggregation) | `src/lib/analysis.ts` / `src/lib/usage-window.ts` | exact (role) + partial (data flow) |
| `claude-usage-tracker/test/peak-detector.test.ts` | test | N/A | `test/usage-window.test.ts` + `test/analysis.test.ts` | exact (test pattern) |
| `claude-usage-tracker/src/lib/schedule.ts` | library (pure function) | CRUD (fire time generation) | `src/lib/analysis.ts` | role-match |
| `claude-usage-tracker/test/schedule.test.ts` | test | N/A | `test/usage-window.test.ts` + `test/analysis.test.ts` | exact (test pattern) |

---

## Pattern Assignments

### `claude-usage-tracker/src/lib/peak-detector.ts` (library, CRUD)

**Analogs:** `src/lib/usage-window.ts` (input interface, computeUsageDelta), `src/lib/analysis.ts` (hourly bucketing pattern)

**Input interface** — from `src/lib/queries.ts:4-20`:
```typescript
export interface ParsedSnapshot {
  id: number;
  timestamp: string;
  status: string;
  endpoint: string | null;
  response_status: number | null;
  error_message: string | null;
  raw_json: string | null;
  five_hour_utilization: number | null;
  five_hour_resets_at: string | null;
  seven_day_utilization: number | null;
  seven_day_resets_at: string | null;
  extra_usage_enabled: boolean | null;
  extra_usage_monthly_limit: number | null;
  extra_usage_used_credits: number | null;
  extra_usage_utilization: number | null;
}
```

**computeUsageDelta function** — from `src/lib/usage-window.ts:19-33` (reuse this via import):
```typescript
export function computeUsageDelta(
  prevUtil: number | null,
  currUtil: number | null,
  prevResetAt: string | null,
  currResetAt: string | null
): number {
  if (currUtil == null) return 0;
  if (prevUtil == null) return currUtil;

  if (!isSameUsageWindow(prevResetAt, currResetAt)) {
    return currUtil;
  }

  return Math.max(0, currUtil - prevUtil);
}
```

**Hourly bucketing pattern** — from `src/lib/analysis.ts:130-174`:
- Filter snapshots to `status === "ok"` (line 144)
- Iterate pairwise through consecutive snapshots (line 146: `for (let i = 1; i < okSnapshots.length; i++)`)
- Extract timestamp's hour via `new Date(curr.timestamp).getHours()` and day via `.getDay()` (lines 158-160)
- Accumulate deltas into bucketed array indexed by hour (lines 162-167)
- Round values to 2 decimals at output (line 171: `round2(b.totalDelta)`)

**Example bucketing setup** (lines 131-142):
```typescript
const hourlyBars: HourlyBar[] = Array.from({ length: 24 }, (_, h) => ({
  hour: h,
  totalDelta: 0,
  sampleCount: 0,
}));

const heatmap: HeatmapCell[] = [];
for (let d = 0; d < 7; d++) {
  for (let h = 0; h < 24; h++) {
    heatmap.push({ dayIndex: d, hour: h, totalDelta: 0, sampleCount: 0 });
  }
}
```

**Imports pattern** — from `src/lib/analysis.ts:1-3`:
```typescript
import type { CollectorState } from "./collector";
import { computeUsageDelta } from "./usage-window";
import { type ParsedSnapshot } from "./queries";
```

**Recommended imports for peak-detector.ts:**
```typescript
import { computeUsageDelta } from "./usage-window";
import type { ParsedSnapshot } from "./queries";
```

**Function naming** — verb-first named export per CONVENTIONS.md:22:
- Top-level exported functions use `function` keyword (not arrow functions)
- Names: `peakDetector()` or `detectPeak()` (not `PeakDetector`, not default export)

---

### `claude-usage-tracker/test/peak-detector.test.ts` (test)

**Analog:** `test/usage-window.test.ts` + `test/analysis.test.ts`

**Test structure** — from `test/usage-window.test.ts:1-8`:
```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeUsageDelta,
  isSameUsageWindow,
  normalizeResetHour,
} from "../src/lib/usage-window";
```

**Describe + it blocks** — standard nested structure (lines 9-24):
```typescript
describe("normalizeResetHour", () => {
  it("normalizes valid timestamps to the top of the UTC hour", () => {
    assert.equal(
      normalizeResetHour("2026-04-06T15:42:19.123Z"),
      "2026-04-06T15:00:00.000Z"
    );
  });
  // more tests...
});
```

**Test data setup** — from `test/analysis.test.ts:24-44`:
```typescript
function makeSnapshot(
  overrides: Partial<ParsedSnapshot> & { timestamp: string }
): ParsedSnapshot {
  return {
    id: 1,
    status: "ok",
    endpoint: "test",
    response_status: 200,
    five_hour_utilization: null,
    five_hour_resets_at: null,
    seven_day_utilization: null,
    seven_day_resets_at: null,
    extra_usage_enabled: null,
    extra_usage_monthly_limit: null,
    extra_usage_used_credits: null,
    extra_usage_utilization: null,
    raw_json: null,
    error_message: null,
    ...overrides,
  };
}
```

**Assertion patterns** — from `test/usage-window.test.ts:59-64, 87-92`:
```typescript
// Positive tests
assert.equal(
  computeUsageDelta(10, 22, "2026-04-06T15:00:00Z", "2026-04-06T15:30:00Z"),
  12
);

// Edge cases
assert.equal(
  computeUsageDelta(30, 10, "2026-04-06T15:00:00Z", "2026-04-06T15:45:00Z"),
  0
);

// Array tests (from analysis.test.ts)
assert.equal(result.activity.hourlyBars[hour].totalDelta, 12);
```

---

### `claude-usage-tracker/src/lib/schedule.ts` (library, CRUD)

**Analog:** `src/lib/analysis.ts` (pure data transformation function)

**Function signature pattern** — from `src/lib/analysis.ts:300-304`:
```typescript
export function buildDashboardData(
  snapshots: ParsedSnapshot[],
  storageMeta: { path: string; sizeBytes: number; totalSnapshots: number },
  runtime: CollectorState
): DashboardData {
  // implementation
}
```

**Recommended signature for schedule.ts:**
```typescript
export function generateSchedule(
  peakBlock: PeakBlock | null,
  options: ScheduleOptions
): ScheduleResult {
  // implementation
}
```

**Imports pattern** — follow `src/lib/analysis.ts:1-3`:
```typescript
import type { ParsedSnapshot } from "./queries";
// other internal imports as needed
```

**Return type pattern** — from `src/lib/analysis.ts:53-87` (interface):
```typescript
export interface DashboardData {
  generatedAt: string;
  health: { ... };
  current: { ... } | null;
  timeline: TimelinePoint[];
  activity: { ... };
  usageInsights: { ... };
  extraUsageInsights: ExtraUsageInsights;
  runtime: CollectorState;
  storage: { path: string; sizeBytes: number; totalSnapshots: number };
}
```

**Named interfaces for types** — CONVENTIONS.md:32-35:
- Use `PascalCase` for all interfaces and type aliases
- Prefer `interface` for object shapes, `type` for unions
- Examples: `type Tier = "idle" | "light" | "active" | "burst"` (unions), `interface Config { ... }` (objects)

---

### `claude-usage-tracker/test/schedule.test.ts` (test)

**Analog:** `test/analysis.test.ts`

**Same test structure as peak-detector.test.ts:**
```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateSchedule } from "../src/lib/schedule";
```

**Test organization** — from `test/analysis.test.ts:46-52`:
```typescript
describe("buildDashboardData", () => {
  it("returns empty state with no snapshots", () => {
    const result = buildDashboardData([], mockStorage, mockRuntime);
    assert.equal(result.current, null);
    // assertions...
  });
});
```

**Setup fixtures** — `test/analysis.test.ts:7-22` shows how to create reusable mock objects:
```typescript
const mockRuntime: CollectorState = {
  startedAt: "2026-04-06T10:00:00Z",
  isConfigured: true,
  isPolling: false,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null,
  consecutiveFailures: 0,
  endpoint: "https://api.anthropic.com/api/oauth/usage",
  authMode: "bearer",
  currentTier: "idle" as const,
  nextPollAt: null,
  consecutiveNoChange: 0,
};

const mockStorage = { path: "data/usage.db", sizeBytes: 4096, totalSnapshots: 2 };
```

---

## Shared Patterns

### Named Exports + No Default Exports
**Source:** `src/lib/analysis.ts`, `src/lib/usage-window.ts`, `src/lib/queries.ts`
**Apply to:** All new `src/lib/*.ts` files

Per CONVENTIONS.md:144, all library functions use named exports:
```typescript
export function peakDetector(snapshots: ParsedSnapshot[]): PeakBlock | null {
  // ...
}

export function generateSchedule(peakBlock: PeakBlock | null, opts: ScheduleOptions): FireTime[] {
  // ...
}

export interface PeakBlock {
  // ...
}
```

### Function Keyword for Top-Level Named Functions
**Source:** `src/lib/analysis.ts`, `src/lib/usage-window.ts`
**Apply to:** All new lib functions

```typescript
// ✓ Correct
export function computeUsageDelta(...): number {
  // ...
}

// ✗ Incorrect (arrow function at top level)
export const peakDetector = (...) => {
  // ...
};
```

### Test File Pattern (node:test + node:assert/strict)
**Source:** `test/usage-window.test.ts`, `test/analysis.test.ts`, `test/queries.test.ts`
**Apply to:** Both new test files

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { functionToTest } from "../src/lib/module";
```

No external test framework (Jest, Vitest, etc.). Use only Node's built-in `node:test` module. Assertions use `node:assert/strict` (not loose `assert`).

### Naming Conventions
**Source:** CONVENTIONS.md:21-35
**Apply to:** All new interfaces and functions

- **Interfaces:** `PascalCase` (e.g., `PeakBlock`, `ScheduleOptions`, `FireTime`, `PeakDetectorResult`)
- **Functions:** `camelCase` verb-first (e.g., `peakDetector()` or `detectPeak()`, `generateSchedule()`)
- **Type aliases (unions):** `PascalCase` (e.g., `type Status = "ok" | "error"`)
- **Constants:** `UPPER_SNAKE_CASE` (e.g., `const WINDOW_HOURS = 4`)
- **Variables:** `camelCase` (e.g., `okSnapshots`, `hourlyDelta`)

### Import Organization
**Source:** CONVENTIONS.md:64-76
**Apply to:** All new lib modules

1. Node built-ins with `node:` prefix
2. Third-party packages (if any)
3. Internal absolute imports via `@/*` (rarely used in lib/)
4. Relative imports from same package (e.g., `./usage-window`, `./queries`)
5. Use `import type { ... }` for types

Example for peak-detector.ts:
```typescript
// ✓ Correct (no node builtins needed, but if there were:)
import { computeUsageDelta } from "./usage-window";
import type { ParsedSnapshot } from "./queries";

// ✗ Incorrect
import type { ParsedSnapshot } from "./queries";
import { computeUsageDelta } from "./usage-window";  // relative import before internal path
```

### Pure Functions
**Source:** CONVENTIONS.md:137-139
**Apply to:** All functions in peak-detector.ts and schedule.ts

Both modules are pure: no I/O, no side effects, deterministic given the same inputs. No database access, no randomness (except jitter in schedule.ts via `Math.random()`, which is inherent to the algorithm and testable via range assertions per D-02).

---

## No Analog Found

None. All file roles have direct analogs in the existing codebase.

---

## Metadata

**Analog search scope:**
- `claude-usage-tracker/src/lib/*.ts` (8 files)
- `claude-usage-tracker/test/*.test.ts` (10 files)

**Files scanned:** 18

**Key insights:**
1. **buildActivity in analysis.ts** provides hourly bucketing reference; peak-detector reimplements independently per D-04
2. **computeUsageDelta in usage-window.ts** is reusable; peak-detector imports and calls it
3. **Test pattern is uniform** across all existing modules: `node:test` + `node:assert/strict`, `describe/it`, factory functions for test data
4. **Named exports only**; no default exports in lib files
5. **Function keyword required** for top-level named functions (not arrow functions)
