# Polling & Analysis Rethink Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace sliding-window compensation with simple reset detection, and replace fixed-interval polling with adaptive 4-tier system targeting 1% resolution.

**Architecture:** Two independent changes. First, simplify analysis to use `resets_at` comparison for delta calculation. Second, replace `setInterval` with self-scheduling `setTimeout` driven by a 4-tier state machine (Idle/Light/Active/Burst). Error backoff is layered on top.

**Tech Stack:** TypeScript, Node.js `node:test`, Next.js API routes, better-sqlite3

---

## File Structure

| File | Responsibility | Change Type |
|------|---------------|-------------|
| `src/lib/analysis.ts` | Delta calculation, activity aggregation, dashboard data | Modify |
| `test/analysis.test.ts` | Tests for delta calculation and activity | Rewrite |
| `src/lib/collector.ts` | Polling scheduler, tier state machine, error backoff | Modify |
| `test/collector.test.ts` | Tests for tier transitions, delay computation | Create |
| `src/lib/config.ts` | Config loading | Modify |
| `src/app/api/poll/route.ts` | Manual poll endpoint with cooldown | Modify |
| `src/app/page.tsx` | Dashboard page, poll button state | Modify |
| `src/components/CollectorHealth.tsx` | Health panel showing tier + next poll | Modify |

---

### Task 1: Simplify Analysis — Replace Dropoff Compensation with Reset Detection

**Files:**
- Modify: `src/lib/analysis.ts:48-162`
- Rewrite: `test/analysis.test.ts`

- [ ] **Step 1: Write failing tests for `computeDelta`**

Replace the entire content of `test/analysis.test.ts` with:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDashboardData } from "../src/lib/analysis";
import type { SnapshotRow } from "../src/lib/db";
import type { CollectorState } from "../src/lib/collector";

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

function makeSnapshot(
  overrides: Partial<SnapshotRow> & { id: number; timestamp: string }
): SnapshotRow {
  return {
    status: "ok",
    endpoint: "test",
    auth_mode: "bearer",
    response_status: 200,
    five_hour_utilization: null,
    five_hour_resets_at: null,
    seven_day_utilization: null,
    seven_day_resets_at: null,
    raw_json: null,
    error_message: null,
    ...overrides,
  };
}

describe("buildDashboardData", () => {
  it("returns empty state with no snapshots", () => {
    const result = buildDashboardData([], mockStorage, mockRuntime);
    assert.equal(result.current, null);
    assert.equal(result.timeline.length, 0);
    assert.equal(result.health.totalSnapshots, 0);
  });

  it("computes current from latest successful snapshot", () => {
    const snapshots = [
      makeSnapshot({
        id: 1,
        timestamp: "2026-04-06T10:00:00Z",
        five_hour_utilization: 25,
        five_hour_resets_at: "2026-04-06T15:00:00Z",
      }),
    ];

    const result = buildDashboardData(snapshots, mockStorage, mockRuntime);
    assert.equal(result.current?.fiveHour?.utilization, 25);
  });

  it("computes positive delta within same window", () => {
    const snapshots = [
      makeSnapshot({
        id: 1,
        timestamp: "2026-04-06T10:00:00Z",
        five_hour_utilization: 10,
        five_hour_resets_at: "2026-04-06T15:00:00Z",
      }),
      makeSnapshot({
        id: 2,
        timestamp: "2026-04-06T10:05:00Z",
        five_hour_utilization: 22,
        five_hour_resets_at: "2026-04-06T15:00:00Z",
      }),
    ];

    const result = buildDashboardData(snapshots, mockStorage, mockRuntime);
    const hour = new Date("2026-04-06T10:05:00Z").getHours();
    assert.equal(result.activity.hourlyBars[hour].totalDelta, 12);
  });

  it("treats window reset as delta from zero", () => {
    const snapshots = [
      makeSnapshot({
        id: 1,
        timestamp: "2026-04-06T14:55:00Z",
        five_hour_utilization: 80,
        five_hour_resets_at: "2026-04-06T15:00:00Z",
      }),
      makeSnapshot({
        id: 2,
        timestamp: "2026-04-06T15:05:00Z",
        five_hour_utilization: 5,
        five_hour_resets_at: "2026-04-06T20:00:00Z",
      }),
    ];

    const result = buildDashboardData(snapshots, mockStorage, mockRuntime);
    const hour = new Date("2026-04-06T15:05:00Z").getHours();
    // Window reset: delta = 5 (from 0), not -75 or 0
    assert.equal(result.activity.hourlyBars[hour].totalDelta, 5);
  });

  it("returns zero delta when current utilization is null after reset", () => {
    const snapshots = [
      makeSnapshot({
        id: 1,
        timestamp: "2026-04-06T14:55:00Z",
        five_hour_utilization: 80,
        five_hour_resets_at: "2026-04-06T15:00:00Z",
      }),
      makeSnapshot({
        id: 2,
        timestamp: "2026-04-06T15:01:00Z",
        five_hour_utilization: null,
        five_hour_resets_at: null,
      }),
    ];

    const result = buildDashboardData(snapshots, mockStorage, mockRuntime);
    const totalDelta = result.activity.hourlyBars.reduce((s, b) => s + b.totalDelta, 0);
    assert.equal(totalDelta, 0);
  });

  it("handles previous utilization null (first snapshot with data)", () => {
    const snapshots = [
      makeSnapshot({
        id: 1,
        timestamp: "2026-04-06T15:01:00Z",
        five_hour_utilization: null,
        five_hour_resets_at: null,
      }),
      makeSnapshot({
        id: 2,
        timestamp: "2026-04-06T15:06:00Z",
        five_hour_utilization: 3,
        five_hour_resets_at: "2026-04-06T20:00:00Z",
      }),
    ];

    const result = buildDashboardData(snapshots, mockStorage, mockRuntime);
    const hour = new Date("2026-04-06T15:06:00Z").getHours();
    assert.equal(result.activity.hourlyBars[hour].totalDelta, 3);
  });

  it("no change in same window produces zero delta", () => {
    const snapshots = [
      makeSnapshot({
        id: 1,
        timestamp: "2026-04-06T10:00:00Z",
        five_hour_utilization: 40,
        five_hour_resets_at: "2026-04-06T15:00:00Z",
      }),
      makeSnapshot({
        id: 2,
        timestamp: "2026-04-06T10:05:00Z",
        five_hour_utilization: 40,
        five_hour_resets_at: "2026-04-06T15:00:00Z",
      }),
    ];

    const result = buildDashboardData(snapshots, mockStorage, mockRuntime);
    const totalDelta = result.activity.hourlyBars.reduce((s, b) => s + b.totalDelta, 0);
    assert.equal(totalDelta, 0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test test/analysis.test.ts`
Expected: Failures — `computeDelta` doesn't exist yet, and `CollectorState` has wrong shape (missing `currentTier`, `nextPollAt`, `consecutiveNoChange`).

- [ ] **Step 3: Replace analysis logic**

Replace lines 48-162 of `src/lib/analysis.ts` (everything between the interfaces and `buildDashboardData`) with:

```typescript
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Compute the usage delta between two snapshots for a given window.
 * Uses resets_at to detect window boundaries:
 * - Same window: delta = current - previous
 * - Window reset: delta = current (it reset to 0, then grew to this)
 * - Null utilization: delta = 0
 */
function computeDelta(
  prev: SnapshotRow,
  curr: SnapshotRow,
  windowKey: "five_hour" | "seven_day"
): number {
  const currUtil = curr[`${windowKey}_utilization`];
  const prevUtil = prev[`${windowKey}_utilization`];

  if (currUtil == null) return 0;
  if (prevUtil == null) return currUtil;

  const currReset = curr[`${windowKey}_resets_at`];
  const prevReset = prev[`${windowKey}_resets_at`];

  if (currReset !== prevReset) return currUtil;

  return Math.max(0, currUtil - prevUtil);
}

function buildActivity(snapshots: SnapshotRow[]) {
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

  const okSnapshots = snapshots.filter((s) => s.status === "ok");

  for (let i = 1; i < okSnapshots.length; i++) {
    const prev = okSnapshots[i - 1];
    const curr = okSnapshots[i];

    const newUsage = computeDelta(prev, curr, "five_hour");
    if (newUsage <= 0) continue;

    const ts = new Date(curr.timestamp);
    const dayIndex = ts.getDay();
    const hour = ts.getHours();

    hourlyBars[hour].totalDelta += newUsage;
    hourlyBars[hour].sampleCount++;

    const cell = heatmap[dayIndex * 24 + hour];
    cell.totalDelta += newUsage;
    cell.sampleCount++;
  }

  return {
    hourlyBars: hourlyBars.map((b) => ({ ...b, totalDelta: round2(b.totalDelta) })),
    heatmap: heatmap.map((c) => ({ ...c, totalDelta: round2(c.totalDelta) })),
  };
}
```

This deletes `estimateNewUsage`, `findClosestSnapshot`, and `FIVE_HOURS_MS`. The `buildDashboardData` function at the bottom of the file stays unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test test/analysis.test.ts`
Expected: Tests will still fail because `CollectorState` doesn't have the new fields yet. That's fine — we'll fix that in Task 2. For now, verify the analysis logic compiles correctly by checking for syntax errors only.

- [ ] **Step 5: Commit**

```bash
git add src/lib/analysis.ts test/analysis.test.ts
git commit -m "refactor: replace sliding window compensation with reset-aware delta tracking"
```

---

### Task 2: Add Tier State Machine to Collector

**Files:**
- Modify: `src/lib/collector.ts`
- Create: `test/collector.test.ts`

- [ ] **Step 1: Write failing tests for tier logic**

Create `test/collector.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeNextDelay, type TierState, type PollResult } from "../src/lib/collector";

describe("computeNextDelay", () => {
  const base: TierState = {
    currentTier: "idle",
    consecutiveNoChange: 0,
  };

  it("stays idle when no delta", () => {
    const result = computeNextDelay(base, { delta: 0, success: true });
    assert.equal(result.currentTier, "idle");
    assert.equal(result.delayMs, 5 * 60 * 1000);
  });

  it("steps up to light when delta detected from idle", () => {
    const result = computeNextDelay(base, { delta: 2, success: true });
    assert.equal(result.currentTier, "light");
    assert.equal(result.delayMs, 2.5 * 60 * 1000);
  });

  it("steps up to active when delta detected from light", () => {
    const state: TierState = { currentTier: "light", consecutiveNoChange: 0 };
    const result = computeNextDelay(state, { delta: 2, success: true });
    assert.equal(result.currentTier, "active");
    assert.equal(result.delayMs, 60 * 1000);
  });

  it("steps up to burst when large delta from active", () => {
    const state: TierState = { currentTier: "active", consecutiveNoChange: 0 };
    const result = computeNextDelay(state, { delta: 3, success: true });
    assert.equal(result.currentTier, "burst");
    assert.equal(result.delayMs, 30 * 1000);
  });

  it("does not jump from idle to burst", () => {
    const result = computeNextDelay(base, { delta: 10, success: true });
    assert.equal(result.currentTier, "light");
  });

  it("steps down one tier after 3 polls with no change", () => {
    const state: TierState = { currentTier: "burst", consecutiveNoChange: 2 };
    const result = computeNextDelay(state, { delta: 0, success: true });
    assert.equal(result.consecutiveNoChange, 3);
    assert.equal(result.currentTier, "active");
  });

  it("does not step down until 3 consecutive no-change polls", () => {
    const state: TierState = { currentTier: "active", consecutiveNoChange: 1 };
    const result = computeNextDelay(state, { delta: 0, success: true });
    assert.equal(result.currentTier, "active");
    assert.equal(result.consecutiveNoChange, 2);
  });

  it("resets consecutiveNoChange when delta detected", () => {
    const state: TierState = { currentTier: "active", consecutiveNoChange: 2 };
    const result = computeNextDelay(state, { delta: 1, success: true });
    assert.equal(result.consecutiveNoChange, 0);
  });

  it("uses error backoff on failure", () => {
    const result = computeNextDelay(
      { ...base, consecutiveFailures: 0 },
      { delta: 0, success: false, consecutiveFailures: 1 }
    );
    assert.equal(result.delayMs, 60 * 1000);
  });

  it("escalates error backoff", () => {
    const result = computeNextDelay(
      { ...base, consecutiveFailures: 3 },
      { delta: 0, success: false, consecutiveFailures: 4 }
    );
    assert.equal(result.delayMs, 10 * 60 * 1000);
  });

  it("caps error backoff at 10 minutes", () => {
    const result = computeNextDelay(
      { ...base, consecutiveFailures: 10 },
      { delta: 0, success: false, consecutiveFailures: 11 }
    );
    assert.equal(result.delayMs, 10 * 60 * 1000);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test test/collector.test.ts`
Expected: FAIL — `computeNextDelay` and `TierState` don't exist yet.

- [ ] **Step 3: Implement tier state machine and adaptive scheduling**

Replace the full content of `src/lib/collector.ts` with:

```typescript
import type { Config } from "./config";
import { insertSnapshot } from "./db";
import { normalizeUsagePayload } from "./normalize";

export type Tier = "idle" | "light" | "active" | "burst";

export interface TierState {
  currentTier: Tier;
  consecutiveNoChange: number;
  consecutiveFailures?: number;
}

export interface PollResult {
  delta: number;
  success: boolean;
  consecutiveFailures?: number;
}

const TIER_DELAYS: Record<Tier, number> = {
  idle: 5 * 60 * 1000,
  light: 2.5 * 60 * 1000,
  active: 60 * 1000,
  burst: 30 * 1000,
};

const TIER_ORDER: Tier[] = ["idle", "light", "active", "burst"];

const ERROR_BACKOFF = [60_000, 120_000, 300_000, 600_000]; // 1m, 2m, 5m, 10m cap

const STEP_DOWN_THRESHOLD = 3;
const BURST_ENTRY_DELTA = 3;

export function computeNextDelay(
  state: TierState,
  result: PollResult
): TierState & { delayMs: number } {
  // Error backoff takes priority
  if (!result.success) {
    const failures = result.consecutiveFailures ?? 1;
    const backoffIndex = Math.min(failures - 1, ERROR_BACKOFF.length - 1);
    return {
      ...state,
      consecutiveFailures: failures,
      delayMs: ERROR_BACKOFF[backoffIndex],
    };
  }

  const tierIndex = TIER_ORDER.indexOf(state.currentTier);
  let newTier = state.currentTier;
  let noChange = state.consecutiveNoChange;

  if (result.delta > 0) {
    // Usage detected — step up one tier
    noChange = 0;
    const nextIndex = tierIndex + 1;
    if (nextIndex < TIER_ORDER.length) {
      // Only enter burst if delta is large enough and we're at active
      if (TIER_ORDER[nextIndex] === "burst" && result.delta < BURST_ENTRY_DELTA) {
        // Stay at active
      } else {
        newTier = TIER_ORDER[nextIndex];
      }
    }
  } else {
    // No change — count toward step down
    noChange++;
    if (noChange >= STEP_DOWN_THRESHOLD && tierIndex > 0) {
      newTier = TIER_ORDER[tierIndex - 1];
      noChange = 0;
    }
  }

  return {
    currentTier: newTier,
    consecutiveNoChange: noChange,
    consecutiveFailures: 0,
    delayMs: TIER_DELAYS[newTier],
  };
}

export interface CollectorState {
  startedAt: string;
  isConfigured: boolean;
  isPolling: boolean;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  endpoint: string;
  authMode: string;
  currentTier: Tier;
  nextPollAt: string | null;
  consecutiveNoChange: number;
}

export class UsageCollector {
  private config: Config;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private polling = false;
  private lastFiveHourUtil: number | null = null;
  private tierState: TierState = {
    currentTier: "idle",
    consecutiveNoChange: 0,
    consecutiveFailures: 0,
  };
  private state: CollectorState;

  constructor(config: Config) {
    this.config = config;
    this.state = {
      startedAt: new Date().toISOString(),
      isConfigured: config.hasAuth,
      isPolling: false,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastError: null,
      consecutiveFailures: 0,
      endpoint: config.endpoint,
      authMode: config.authMode,
      currentTier: "idle",
      nextPollAt: null,
      consecutiveNoChange: 0,
    };
  }

  getState(): CollectorState {
    return { ...this.state };
  }

  private scheduleNext(delayMs: number) {
    if (this.timeout) clearTimeout(this.timeout);
    const nextTime = new Date(Date.now() + delayMs).toISOString();
    this.state.nextPollAt = nextTime;
    this.timeout = setTimeout(() => void this.pollOnce(), delayMs);
  }

  async pollOnce(): Promise<{ status: string; error?: string }> {
    if (!this.config.hasAuth) {
      const msg = "No auth configured. Set CLAUDE_BEARER_TOKEN or CLAUDE_SESSION_COOKIE.";
      this.state.lastError = msg;
      this.state.consecutiveFailures++;
      insertSnapshot(this.config, {
        timestamp: new Date().toISOString(),
        status: "error",
        endpoint: this.config.endpoint,
        authMode: this.config.authMode,
        responseStatus: 0,
        fiveHourUtilization: null,
        fiveHourResetsAt: null,
        sevenDayUtilization: null,
        sevenDayResetsAt: null,
        rawJson: null,
        errorMessage: msg,
      });
      this.scheduleNext(600_000); // 10m when no auth
      return { status: "error", error: msg };
    }

    if (this.polling) return { status: "skipped" };

    this.polling = true;
    this.state.isPolling = true;
    this.state.lastAttemptAt = new Date().toISOString();

    try {
      const headers: Record<string, string> = {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
        "Referer": "https://claude.ai/settings/usage",
        "Origin": "https://claude.ai",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Ch-Ua-Platform": '"Windows"',
      };

      if (this.config.authMode === "bearer") {
        headers.Authorization = `Bearer ${this.config.bearerToken}`;
        headers["anthropic-beta"] = "oauth-2025-04-20";
      } else if (this.config.authMode === "cookie") {
        headers.Cookie = this.config.sessionCookie;
      }

      const response = await fetch(this.config.endpoint, { headers });
      const rawBody = await response.text();

      let payload: Record<string, unknown> | null = null;
      try {
        payload = rawBody ? JSON.parse(rawBody) : null;
      } catch {
        payload = null;
      }

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}: ${(payload ? JSON.stringify(payload) : rawBody).slice(0, 500)}`
        );
      }

      if (!payload) {
        throw new Error(`HTTP ${response.status} with non-JSON body`);
      }

      const normalized = normalizeUsagePayload(payload);
      const fiveHour = normalized.windows.find((w) => w.key === "five_hour");
      const sevenDay = normalized.windows.find((w) => w.key === "seven_day");

      const currentUtil = fiveHour?.utilization ?? null;
      const delta = (currentUtil != null && this.lastFiveHourUtil != null)
        ? Math.max(0, currentUtil - this.lastFiveHourUtil)
        : 0;
      this.lastFiveHourUtil = currentUtil;

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
        rawJson: JSON.stringify(payload),
        errorMessage: null,
      });

      this.state.lastSuccessAt = new Date().toISOString();
      this.state.lastError = null;
      this.state.consecutiveFailures = 0;

      // Compute next tier and schedule
      const next = computeNextDelay(this.tierState, { delta, success: true });
      this.tierState = {
        currentTier: next.currentTier,
        consecutiveNoChange: next.consecutiveNoChange,
        consecutiveFailures: 0,
      };
      this.state.currentTier = next.currentTier;
      this.state.consecutiveNoChange = next.consecutiveNoChange;
      this.scheduleNext(next.delayMs);

      return { status: "ok" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.state.lastError = msg;
      this.state.consecutiveFailures++;

      insertSnapshot(this.config, {
        timestamp: new Date().toISOString(),
        status: "error",
        endpoint: this.config.endpoint,
        authMode: this.config.authMode,
        responseStatus: 0,
        fiveHourUtilization: null,
        fiveHourResetsAt: null,
        sevenDayUtilization: null,
        sevenDayResetsAt: null,
        rawJson: null,
        errorMessage: msg,
      });

      // Error backoff
      const next = computeNextDelay(this.tierState, {
        delta: 0,
        success: false,
        consecutiveFailures: this.state.consecutiveFailures,
      });
      this.scheduleNext(next.delayMs);

      console.warn(`[collector] Poll failed: ${msg}`);
      return { status: "error", error: msg };
    } finally {
      this.polling = false;
      this.state.isPolling = false;
    }
  }

  /** Reset the scheduled timer from now (used after manual poll). */
  reschedule() {
    this.scheduleNext(TIER_DELAYS[this.tierState.currentTier]);
  }

  start() {
    if (this.timeout) return;
    console.log(
      `[collector] Starting (tier: ${this.tierState.currentTier}, auth: ${this.config.authMode})`
    );
    void this.pollOnce();
  }

  stop() {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
  }
}
```

- [ ] **Step 4: Run collector tests**

Run: `npx tsx --test test/collector.test.ts`
Expected: All 10 tests PASS.

- [ ] **Step 5: Run analysis tests**

Run: `npx tsx --test test/analysis.test.ts`
Expected: All 7 tests PASS (now that `CollectorState` has the right shape).

- [ ] **Step 6: Run all tests**

Run: `npx tsx --test test/*.test.ts`
Expected: All tests pass (analysis + collector + normalize).

- [ ] **Step 7: Commit**

```bash
git add src/lib/collector.ts test/collector.test.ts
git commit -m "feat: adaptive 4-tier polling with setTimeout and error backoff"
```

---

### Task 3: Update Config

**Files:**
- Modify: `src/lib/config.ts`

- [ ] **Step 1: Simplify config**

Replace the `sanitizeInterval` function and `pollIntervalMs` field. The full updated `src/lib/config.ts`:

```typescript
import fs from "node:fs";
import path from "node:path";

export interface Config {
  port: number;
  pollMinMs: number;
  dataDir: string;
  dbPath: string;
  endpoint: string;
  bearerToken: string;
  sessionCookie: string;
  authMode: "bearer" | "cookie" | "none";
  hasAuth: boolean;
}

function tryReadClaudeCredentials(): string {
  try {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    const credPath = path.join(home, ".claude", ".credentials.json");
    if (!fs.existsSync(credPath)) return "";
    const creds = JSON.parse(fs.readFileSync(credPath, "utf8"));
    return creds?.claudeAiOauth?.accessToken ?? "";
  } catch {
    return "";
  }
}

function sanitizeMinInterval(raw: string | undefined): number {
  const parsed = parseInt(raw ?? "30000", 10);
  if (!Number.isFinite(parsed) || parsed < 30_000) return 30_000;
  return parsed;
}

export function getConfig(): Config {
  const bearerToken =
    process.env.CLAUDE_BEARER_TOKEN?.trim() || tryReadClaudeCredentials();
  const sessionCookie = process.env.CLAUDE_SESSION_COOKIE?.trim() ?? "";

  const authMode: Config["authMode"] = bearerToken
    ? "bearer"
    : sessionCookie
      ? "cookie"
      : "none";

  const dataDir = path.resolve(
    process.cwd(), /*turbopackIgnore: true*/ process.env.DATA_DIR ?? "data"
  );

  return {
    port: parseInt(process.env.PORT ?? "3000", 10),
    pollMinMs: sanitizeMinInterval(process.env.POLL_MIN_MS),
    dataDir,
    dbPath: path.join(dataDir, "usage.db"),
    endpoint:
      process.env.CLAUDE_USAGE_ENDPOINT?.trim() ??
      "https://api.anthropic.com/api/oauth/usage",
    bearerToken,
    sessionCookie,
    authMode,
    hasAuth: authMode !== "none",
  };
}
```

Changes: `pollIntervalMs` → `pollMinMs`, `sanitizeInterval` → `sanitizeMinInterval`, default 30000, min 30000, env var `POLL_MIN_MS`.

- [ ] **Step 2: Run all tests to check for breakage**

Run: `npx tsx --test test/*.test.ts`
Expected: All pass. The collector no longer reads `pollIntervalMs` from config (tier delays are hardcoded).

- [ ] **Step 3: Commit**

```bash
git add src/lib/config.ts
git commit -m "refactor: replace POLL_INTERVAL_MS with POLL_MIN_MS"
```

---

### Task 4: Update Manual Poll Endpoint with Cooldown

**Files:**
- Modify: `src/app/api/poll/route.ts`

- [ ] **Step 1: Add cooldown and reschedule**

Replace `src/app/api/poll/route.ts` with:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getCollector } from "@/lib/collector-singleton";

export const dynamic = "force-dynamic";

const COOLDOWN_MS = 30_000;

export async function POST(request: NextRequest) {
  const collector = getCollector();
  const state = collector.getState();

  // Check cooldown unless force flag is set
  const body = await request.json().catch(() => ({}));
  const force = (body as Record<string, unknown>)?.force === true;

  if (!force && state.lastAttemptAt) {
    const elapsed = Date.now() - new Date(state.lastAttemptAt).getTime();
    if (elapsed < COOLDOWN_MS) {
      const retryIn = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
      return NextResponse.json(
        { ok: false, status: "cooldown", retryInSeconds: retryIn },
        { status: 429 }
      );
    }
  }

  const result = await collector.pollOnce();
  if (result.status === "ok") {
    collector.reschedule();
  }
  return NextResponse.json({ ok: result.status === "ok", ...result });
}
```

- [ ] **Step 2: Verify build compiles**

Run: `npx next build 2>&1 | head -20`
Expected: No type errors related to the poll route.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/poll/route.ts
git commit -m "feat: add 30s cooldown to manual poll endpoint with force override"
```

---

### Task 5: Update Dashboard UI to Show Tier and Cooldown

**Files:**
- Modify: `src/components/CollectorHealth.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Update CollectorHealth to show tier and next poll**

Replace `src/components/CollectorHealth.tsx` with:

```typescript
"use client";

import type { DashboardData } from "@/lib/analysis";
import { formatDistanceToNow } from "date-fns";

function Metric({
  label,
  value,
  detail,
  accent,
}: {
  label: string;
  value: string;
  detail: string;
  accent?: boolean;
}) {
  return (
    <div
      className="rounded-lg p-3.5 transition-colors duration-200"
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-subtle)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--border-default)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--border-subtle)";
      }}
    >
      <p
        className="text-[10px] tracking-[0.15em] uppercase mb-2"
        style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}
      >
        {label}
      </p>
      <p
        className="text-xl font-semibold mb-1"
        style={{
          fontFamily: "var(--font-mono)",
          color: accent ? "var(--text-accent)" : "var(--text-primary)",
        }}
      >
        {value}
      </p>
      <p
        className="text-[11px] truncate"
        style={{ color: "var(--text-tertiary)" }}
      >
        {detail}
      </p>
    </div>
  );
}

function formatDelay(tier: string): string {
  switch (tier) {
    case "burst": return "30s";
    case "active": return "1m";
    case "light": return "2.5m";
    default: return "5m";
  }
}

export function CollectorHealth({ data }: { data: DashboardData | null }) {
  if (!data) {
    return (
      <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
        No data available.
      </p>
    );
  }

  const { runtime, health, storage } = data;

  const lastSuccess = runtime.lastSuccessAt
    ? formatDistanceToNow(new Date(runtime.lastSuccessAt), { addSuffix: true })
    : "Never";

  const nextPoll = runtime.nextPollAt
    ? formatDistanceToNow(new Date(runtime.nextPollAt), { addSuffix: true })
    : "—";

  return (
    <div>
      {/* Status bar */}
      <div
        className="flex items-center gap-4 text-[11px] mb-4 pb-3"
        style={{
          color: "var(--text-tertiary)",
          fontFamily: "var(--font-mono)",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        <span>
          Last success:{" "}
          <span style={{ color: "var(--text-secondary)" }}>{lastSuccess}</span>
        </span>
        <span style={{ color: "var(--border-default)" }}>|</span>
        <span>
          Storage:{" "}
          <span style={{ color: "var(--text-secondary)" }}>
            {(storage.sizeBytes / 1024).toFixed(1)} KB
          </span>
        </span>
        <span style={{ color: "var(--border-default)" }}>|</span>
        <span>
          <span style={{ color: "var(--text-secondary)" }}>
            {storage.totalSnapshots}
          </span>{" "}
          snapshots
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric
          label="Auth"
          value={runtime.authMode}
          detail={runtime.isConfigured ? "Configured" : "Missing credentials"}
          accent
        />
        <Metric
          label="Tier"
          value={runtime.currentTier}
          detail={`Interval: ${formatDelay(runtime.currentTier)}`}
        />
        <Metric
          label="Next Poll"
          value={nextPoll}
          detail={`${health.successCount} ok / ${health.errorCount} err`}
        />
        <Metric
          label="Failures"
          value={String(runtime.consecutiveFailures)}
          detail={runtime.lastError ?? "No errors"}
        />
      </div>
    </div>
  );
}
```

Key changes: "Interval" metric replaced with "Tier" (shows current tier + interval). "Snapshots" replaced with "Next Poll" (shows countdown). Snapshot count moved to the detail line of Next Poll.

- [ ] **Step 2: Update page.tsx poll button to handle cooldown**

In `src/app/page.tsx`, replace the `handlePoll` function (lines 31-38) with:

```typescript
  const [pollCooldown, setPollCooldown] = useState<number | null>(null);

  const handlePoll = async () => {
    setPolling(true);
    try {
      const res = await fetch("/api/poll", { method: "POST" });
      const json = await res.json();
      if (json.status === "cooldown") {
        setPollCooldown(json.retryInSeconds);
        setTimeout(() => setPollCooldown(null), json.retryInSeconds * 1000);
      } else {
        setPollCooldown(null);
      }
      await fetchData();
    } finally {
      setPolling(false);
    }
  };
```

And update the button text (line 132) from:

```typescript
              {polling ? "Polling..." : "Poll Now"}
```

to:

```typescript
              {polling ? "Polling..." : pollCooldown ? `Wait ${pollCooldown}s` : "Poll Now"}
```

Also update the `disabled` prop on the button (line 117) from:

```typescript
              disabled={polling}
```

to:

```typescript
              disabled={polling || pollCooldown !== null}
```

And update the footer auto-refresh text (line 205) from:

```typescript
          Auto-refresh 15s
```

to:

```typescript
          Auto-refresh 15s &middot; Adaptive polling
```

- [ ] **Step 3: Verify build compiles**

Run: `npx next build 2>&1 | tail -5`
Expected: Build succeeds with no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/CollectorHealth.tsx src/app/page.tsx
git commit -m "feat: show polling tier, next poll time, and cooldown state in dashboard"
```

---

### Task 6: Update .env.example and Final Verification

**Files:**
- Modify: `.env.example` (if it exists)

- [ ] **Step 1: Update env example if it exists**

If `.env.example` exists, replace any `POLL_INTERVAL_MS` reference with `POLL_MIN_MS=30000`.

- [ ] **Step 2: Run full test suite**

Run: `npx tsx --test test/*.test.ts`
Expected: All tests pass.

- [ ] **Step 3: Run build**

Run: `npx next build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "chore: update env config for adaptive polling"
```
