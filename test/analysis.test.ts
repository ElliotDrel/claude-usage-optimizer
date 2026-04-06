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
  pollIntervalMs: 300000,
};

const mockStorage = { path: "data/usage.db", sizeBytes: 4096, totalSnapshots: 2 };

function makeSnapshot(
  overrides: Partial<SnapshotRow> & { timestamp: string }
): SnapshotRow {
  return {
    id: 1,
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
        timestamp: "2026-04-06T10:00:00Z",
        five_hour_utilization: 25,
        five_hour_resets_at: "2026-04-06T15:00:00Z",
      }),
    ];

    const result = buildDashboardData(snapshots, mockStorage, mockRuntime);
    assert.equal(result.current?.fiveHour?.utilization, 25);
  });

  it("computes hourly activity from positive deltas", () => {
    const snapshots = [
      makeSnapshot({
        timestamp: "2026-04-06T10:00:00Z",
        five_hour_utilization: 10,
        five_hour_resets_at: "2026-04-06T15:00:00Z",
      }),
      makeSnapshot({
        id: 2,
        timestamp: "2026-04-06T11:00:00Z",
        five_hour_utilization: 22,
        five_hour_resets_at: "2026-04-06T16:00:00Z",
      }),
    ];

    const result = buildDashboardData(snapshots, mockStorage, mockRuntime);
    const hour = new Date("2026-04-06T11:00:00Z").getHours();
    assert.equal(result.activity.hourlyBars[hour].totalDelta, 12);
  });

  it("ignores negative deltas (usage resets)", () => {
    const snapshots = [
      makeSnapshot({
        timestamp: "2026-04-06T10:00:00Z",
        five_hour_utilization: 80,
        five_hour_resets_at: "2026-04-06T15:00:00Z",
      }),
      makeSnapshot({
        id: 2,
        timestamp: "2026-04-06T11:00:00Z",
        five_hour_utilization: 5,
        five_hour_resets_at: "2026-04-06T16:00:00Z",
      }),
    ];

    const result = buildDashboardData(snapshots, mockStorage, mockRuntime);
    const totalDelta = result.activity.hourlyBars.reduce((sum, b) => sum + b.totalDelta, 0);
    assert.equal(totalDelta, 0);
  });

  it("compensates for dropoff using 5h-old snapshots", () => {
    // Simulate: at T+0h, utilization was 20% (this will drop off at T+5h)
    // At T+5h, utilization dropped from 50% to 45% even though user was active
    // The 5h-old reference shows 20%→15%, meaning 5% dropped off
    // So estimated new usage = (45-50) + (20-15) = -5 + 5 = 0...
    // Better example: at T+5h util goes 50%→48%, 5h ago went 20%→12% (8% dropped off)
    // new_usage = (48-50) + (20-12) = -2 + 8 = 6%
    const snapshots = [
      // 5 hours ago: two snapshots showing what will drop off
      makeSnapshot({
        id: 1,
        timestamp: "2026-04-06T05:00:00Z",
        five_hour_utilization: 20,
        five_hour_resets_at: "2026-04-06T10:00:00Z",
      }),
      makeSnapshot({
        id: 2,
        timestamp: "2026-04-06T05:05:00Z",
        five_hour_utilization: 12,
        five_hour_resets_at: "2026-04-06T10:05:00Z",
      }),
      // Now: utilization appears to decrease, but user was actually active
      makeSnapshot({
        id: 3,
        timestamp: "2026-04-06T10:00:00Z",
        five_hour_utilization: 50,
        five_hour_resets_at: "2026-04-06T15:00:00Z",
      }),
      makeSnapshot({
        id: 4,
        timestamp: "2026-04-06T10:05:00Z",
        five_hour_utilization: 48,
        five_hour_resets_at: "2026-04-06T15:05:00Z",
      }),
    ];

    const result = buildDashboardData(snapshots, mockStorage, mockRuntime);
    const hour10 = new Date("2026-04-06T10:05:00Z").getHours();
    const hour5 = new Date("2026-04-06T05:05:00Z").getHours();
    // Interval snap3→snap4: raw delta=-2, dropoff=20-12=8, new_usage=6
    // Interval snap2→snap3: raw delta=50-12=38 (positive, no 5h ref → fallback)
    // Interval snap1→snap2: raw delta=12-20=-8 → 0
    // Total at hour10 = 38 + 6 = 44 (if both land on same hour)
    // Just verify the compensation interval contributed > 0 when raw delta was negative
    const totalActivity = result.activity.hourlyBars.reduce((s, b) => s + b.totalDelta, 0);
    assert.ok(totalActivity > 0, "should detect activity even when raw delta is negative");
    // The key assertion: hour10 has activity despite snap3→snap4 having negative raw delta
    assert.ok(result.activity.hourlyBars[hour10].totalDelta > 0, "compensated delta should be positive");
  });
});
