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
        seven_day_utilization: 40,
        seven_day_resets_at: "2026-04-13T10:00:00Z",
      }),
    ];

    const result = buildDashboardData(snapshots, mockStorage, mockRuntime);
    assert.equal(result.current?.fiveHour?.utilization, 25);
    assert.equal(result.current?.sevenDay?.utilization, 40);
  });

  it("computes positive delta within same window (same resets_at)", () => {
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

  it("detects window reset (different resets_at) and uses current as delta", () => {
    const snapshots = [
      makeSnapshot({
        id: 1,
        timestamp: "2026-04-06T10:00:00Z",
        five_hour_utilization: 80,
        five_hour_resets_at: "2026-04-06T15:00:00Z",
      }),
      makeSnapshot({
        id: 2,
        timestamp: "2026-04-06T10:05:00Z",
        five_hour_utilization: 5,
        five_hour_resets_at: "2026-04-06T15:05:00Z",
      }),
    ];

    const result = buildDashboardData(snapshots, mockStorage, mockRuntime);
    const hour = new Date("2026-04-06T10:05:00Z").getHours();
    assert.equal(result.activity.hourlyBars[hour].totalDelta, 5);
  });

  it("returns delta 0 when current utilization is null after reset", () => {
    const snapshots = [
      makeSnapshot({
        id: 1,
        timestamp: "2026-04-06T10:00:00Z",
        five_hour_utilization: 50,
        five_hour_resets_at: "2026-04-06T15:00:00Z",
      }),
      makeSnapshot({
        id: 2,
        timestamp: "2026-04-06T10:05:00Z",
        five_hour_utilization: null,
        five_hour_resets_at: null,
      }),
    ];

    const result = buildDashboardData(snapshots, mockStorage, mockRuntime);
    const totalDelta = result.activity.hourlyBars.reduce((sum, b) => sum + b.totalDelta, 0);
    assert.equal(totalDelta, 0);
  });

  it("uses current value as delta when previous utilization is null", () => {
    const snapshots = [
      makeSnapshot({
        id: 1,
        timestamp: "2026-04-06T10:00:00Z",
        five_hour_utilization: null,
        five_hour_resets_at: null,
      }),
      makeSnapshot({
        id: 2,
        timestamp: "2026-04-06T10:05:00Z",
        five_hour_utilization: 15,
        five_hour_resets_at: "2026-04-06T15:05:00Z",
      }),
    ];

    const result = buildDashboardData(snapshots, mockStorage, mockRuntime);
    const hour = new Date("2026-04-06T10:05:00Z").getHours();
    assert.equal(result.activity.hourlyBars[hour].totalDelta, 15);
  });

  it("returns delta 0 when no change in same window", () => {
    const snapshots = [
      makeSnapshot({
        id: 1,
        timestamp: "2026-04-06T10:00:00Z",
        five_hour_utilization: 30,
        five_hour_resets_at: "2026-04-06T15:00:00Z",
      }),
      makeSnapshot({
        id: 2,
        timestamp: "2026-04-06T10:05:00Z",
        five_hour_utilization: 30,
        five_hour_resets_at: "2026-04-06T15:00:00Z",
      }),
    ];

    const result = buildDashboardData(snapshots, mockStorage, mockRuntime);
    const totalDelta = result.activity.hourlyBars.reduce((sum, b) => sum + b.totalDelta, 0);
    assert.equal(totalDelta, 0);
  });
});
