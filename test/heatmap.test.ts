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

const mockStorage = { path: "data/usage.db", sizeBytes: 4096, totalSnapshots: 0 };

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
    extra_usage_enabled: null,
    extra_usage_monthly_limit: null,
    extra_usage_used_credits: null,
    extra_usage_utilization: null,
    raw_json: null,
    error_message: null,
    ...overrides,
  };
}

describe("heatmap aggregation", () => {
  it("places delta in the correct dayIndex * 24 + hour cell", () => {
    // 2026-04-06 is a Monday (dayIndex=1), hour depends on local time
    // Use a known UTC timestamp and compute expected cell
    const ts1 = "2026-04-06T14:00:00Z";
    const ts2 = "2026-04-06T14:05:00Z";
    const d = new Date(ts2);
    const expectedDay = d.getDay();
    const expectedHour = d.getHours();

    const snapshots = [
      makeSnapshot({
        id: 1,
        timestamp: ts1,
        five_hour_utilization: 10,
        five_hour_resets_at: "2026-04-06T19:00:00Z",
      }),
      makeSnapshot({
        id: 2,
        timestamp: ts2,
        five_hour_utilization: 18,
        five_hour_resets_at: "2026-04-06T19:00:00Z",
      }),
    ];

    const result = buildDashboardData(snapshots, mockStorage, mockRuntime);
    const cellIndex = expectedDay * 24 + expectedHour;
    const cell = result.activity.heatmap[cellIndex];

    assert.equal(cell.dayIndex, expectedDay);
    assert.equal(cell.hour, expectedHour);
    assert.equal(cell.totalDelta, 8);
    assert.equal(cell.sampleCount, 1);
  });

  it("accumulates multiple deltas in the same cell", () => {
    const ts1 = "2026-04-06T14:00:00Z";
    const ts2 = "2026-04-06T14:02:00Z";
    const ts3 = "2026-04-06T14:04:00Z";
    const d = new Date(ts2);
    const expectedDay = d.getDay();
    const expectedHour = d.getHours();

    const snapshots = [
      makeSnapshot({
        id: 1,
        timestamp: ts1,
        five_hour_utilization: 5,
        five_hour_resets_at: "2026-04-06T19:00:00Z",
      }),
      makeSnapshot({
        id: 2,
        timestamp: ts2,
        five_hour_utilization: 10,
        five_hour_resets_at: "2026-04-06T19:00:00Z",
      }),
      makeSnapshot({
        id: 3,
        timestamp: ts3,
        five_hour_utilization: 17,
        five_hour_resets_at: "2026-04-06T19:00:00Z",
      }),
    ];

    const result = buildDashboardData(snapshots, mockStorage, mockRuntime);
    const cellIndex = expectedDay * 24 + expectedHour;
    const cell = result.activity.heatmap[cellIndex];

    assert.equal(cell.totalDelta, 12); // 5 + 7
    assert.equal(cell.sampleCount, 2);
  });

  it("places deltas in different cells for different days/hours", () => {
    // Monday 14:00 UTC and Tuesday 09:00 UTC
    const monTs1 = "2026-04-06T14:00:00Z";
    const monTs2 = "2026-04-06T14:05:00Z";
    const tueTs1 = "2026-04-07T09:00:00Z";
    const tueTs2 = "2026-04-07T09:05:00Z";

    const monD = new Date(monTs2);
    const tueD = new Date(tueTs2);

    const snapshots = [
      makeSnapshot({
        id: 1,
        timestamp: monTs1,
        five_hour_utilization: 10,
        five_hour_resets_at: "2026-04-06T19:00:00Z",
      }),
      makeSnapshot({
        id: 2,
        timestamp: monTs2,
        five_hour_utilization: 20,
        five_hour_resets_at: "2026-04-06T19:00:00Z",
      }),
      makeSnapshot({
        id: 3,
        timestamp: tueTs1,
        five_hour_utilization: 3,
        five_hour_resets_at: "2026-04-07T14:00:00Z",
      }),
      makeSnapshot({
        id: 4,
        timestamp: tueTs2,
        five_hour_utilization: 8,
        five_hour_resets_at: "2026-04-07T14:00:00Z",
      }),
    ];

    const result = buildDashboardData(snapshots, mockStorage, mockRuntime);

    const monCell = result.activity.heatmap[monD.getDay() * 24 + monD.getHours()];
    const tueCell = result.activity.heatmap[tueD.getDay() * 24 + tueD.getHours()];

    assert.equal(monCell.totalDelta, 10);
    assert.equal(monCell.sampleCount, 1);
    assert.equal(tueCell.totalDelta, 8); // 3 (window reset) + 5 (within window)
    assert.equal(tueCell.sampleCount, 2);
  });

  it("heatmap has exactly 7 * 24 = 168 cells", () => {
    const result = buildDashboardData([], mockStorage, mockRuntime);
    assert.equal(result.activity.heatmap.length, 168);
  });

  it("error snapshots do not contribute to heatmap", () => {
    const snapshots = [
      makeSnapshot({
        id: 1,
        timestamp: "2026-04-06T14:00:00Z",
        five_hour_utilization: 10,
        five_hour_resets_at: "2026-04-06T19:00:00Z",
      }),
      makeSnapshot({
        id: 2,
        timestamp: "2026-04-06T14:05:00Z",
        status: "error",
        five_hour_utilization: 50,
        five_hour_resets_at: "2026-04-06T19:00:00Z",
      }),
      makeSnapshot({
        id: 3,
        timestamp: "2026-04-06T14:10:00Z",
        five_hour_utilization: 15,
        five_hour_resets_at: "2026-04-06T19:00:00Z",
      }),
    ];

    const result = buildDashboardData(snapshots, mockStorage, mockRuntime);
    // Only ok snapshots: 10 -> 15 = delta 5
    const totalDelta = result.activity.heatmap.reduce((s, c) => s + c.totalDelta, 0);
    assert.equal(totalDelta, 5);
  });
});
