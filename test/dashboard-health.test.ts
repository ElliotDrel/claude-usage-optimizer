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

const mockStorage = { path: "data/usage.db", sizeBytes: 4096, totalSnapshots: 4 };

function makeSnapshot(
  overrides: Partial<SnapshotRow> & { timestamp: string; status?: string }
): SnapshotRow {
  return {
    id: 1,
    timestamp: overrides.timestamp,
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

describe("buildDashboardData health", () => {
  it("counts mixed ok and error snapshots while keeping timeline data success-only", () => {
    const snapshots = [
      makeSnapshot({
        id: 1,
        timestamp: "2026-04-06T10:00:00Z",
        status: "ok",
        five_hour_utilization: 10,
        five_hour_resets_at: "2026-04-06T15:00:00Z",
      }),
      makeSnapshot({
        id: 2,
        timestamp: "2026-04-06T10:01:00Z",
        status: "error",
        response_status: 500,
        error_message: "upstream failed",
      }),
      makeSnapshot({
        id: 3,
        timestamp: "2026-04-06T10:05:00Z",
        status: "ok",
        five_hour_utilization: 15,
        five_hour_resets_at: "2026-04-06T15:00:00Z",
      }),
      makeSnapshot({
        id: 4,
        timestamp: "2026-04-06T10:06:00Z",
        status: "error",
        response_status: 502,
        error_message: "timeout",
      }),
    ];

    const result = buildDashboardData(snapshots, mockStorage, mockRuntime);

    assert.equal(result.health.totalSnapshots, 4);
    assert.equal(result.health.successCount, 2);
    assert.equal(result.health.errorCount, 2);
    assert.equal(result.health.lastSnapshot?.status, "error");
    assert.equal(result.health.lastSuccess?.timestamp, "2026-04-06T10:05:00Z");

    assert.deepEqual(result.timeline, [
      {
        timestamp: "2026-04-06T10:00:00Z",
        fiveHourUtilization: 10,
        sevenDayUtilization: null,
        extraUsageUsedCredits: null,
      },
      {
        timestamp: "2026-04-06T10:05:00Z",
        fiveHourUtilization: 15,
        sevenDayUtilization: null,
        extraUsageUsedCredits: null,
      },
    ]);

    const hour = new Date("2026-04-06T10:05:00Z").getHours();
    assert.equal(result.activity.hourlyBars[hour].totalDelta, 5);
    assert.equal(result.activity.hourlyBars[hour].sampleCount, 1);
    assert.equal(result.current?.timestamp, "2026-04-06T10:05:00Z");
  });
});
