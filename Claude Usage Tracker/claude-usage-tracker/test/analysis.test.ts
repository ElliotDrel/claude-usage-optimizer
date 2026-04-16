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
    extra_usage_enabled: null,
    extra_usage_monthly_limit: null,
    extra_usage_used_credits: null,
    extra_usage_utilization: null,
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

  it("detects window reset across different reset hours and uses current as delta", () => {
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
        five_hour_resets_at: "2026-04-06T16:00:00Z",
      }),
    ];

    const result = buildDashboardData(snapshots, mockStorage, mockRuntime);
    const hour = new Date("2026-04-06T10:05:00Z").getHours();
    assert.equal(result.activity.hourlyBars[hour].totalDelta, 5);
  });

  it("ignores resets_at jitter within the same hour", () => {
    const snapshots = [
      makeSnapshot({
        id: 1,
        timestamp: "2026-04-06T10:00:00Z",
        five_hour_utilization: 1,
        five_hour_resets_at: "2026-04-06T15:00:00.738106+00:00",
      }),
      makeSnapshot({
        id: 2,
        timestamp: "2026-04-06T10:05:00Z",
        five_hour_utilization: 1,
        five_hour_resets_at: "2026-04-06T15:00:01.267402+00:00",
      }),
    ];

    const result = buildDashboardData(snapshots, mockStorage, mockRuntime);
    const totalDelta = result.activity.hourlyBars.reduce((sum, b) => sum + b.totalDelta, 0);
    assert.equal(totalDelta, 0);
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

  it("tracks the timestamp of the last detected usage change", () => {
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
        five_hour_utilization: 25,
        five_hour_resets_at: "2026-04-06T15:00:00Z",
      }),
      makeSnapshot({
        id: 3,
        timestamp: "2026-04-06T10:10:00Z",
        five_hour_utilization: 25,
        five_hour_resets_at: "2026-04-06T15:00:00Z",
      }),
    ];

    const result = buildDashboardData(snapshots, mockStorage, mockRuntime);
    assert.equal(result.usageInsights.lastUsageAt, "2026-04-06T10:05:00Z");
    assert.equal(result.usageInsights.lastUsageWindow, "5H");
  });

  it("tracks the largest usage delta change", () => {
    const snapshots = [
      makeSnapshot({
        id: 1,
        timestamp: "2026-04-06T10:00:00Z",
        five_hour_utilization: 10,
        five_hour_resets_at: "2026-04-06T15:00:00Z",
        seven_day_utilization: 40,
        seven_day_resets_at: "2026-04-13T10:00:00Z",
      }),
      makeSnapshot({
        id: 2,
        timestamp: "2026-04-06T10:05:00Z",
        five_hour_utilization: 30,
        five_hour_resets_at: "2026-04-06T15:00:00Z",
        seven_day_utilization: 41,
        seven_day_resets_at: "2026-04-13T10:00:00Z",
      }),
    ];

    const result = buildDashboardData(snapshots, mockStorage, mockRuntime);
    assert.equal(result.usageInsights.largestDelta?.delta, 20);
    assert.equal(result.usageInsights.largestDelta?.window, "5H");
    assert.equal(result.usageInsights.largestDelta?.at, "2026-04-06T10:05:00Z");
  });

  it("uses dollar-valued extra usage fields from the database", () => {
    const snapshots = [
      makeSnapshot({
        timestamp: "2026-04-06T10:00:00Z",
        extra_usage_enabled: 1,
        extra_usage_monthly_limit: 3,
        extra_usage_used_credits: 1.2,
        extra_usage_utilization: 40,
      }),
    ];

    const result = buildDashboardData(snapshots, mockStorage, mockRuntime);
    assert.equal(result.current?.extraUsage?.monthlyLimit, 3);
    assert.equal(result.current?.extraUsage?.usedCredits, 1.2);
    assert.equal(result.current?.extraUsage?.balance, 1.8);
    assert.equal(result.timeline[0].extraUsageUsedCredits, 1.2);
    assert.equal(result.timeline[0].extraUsageBalance, 1.8);
  });

  it("tracks extra usage top-ups and spend events", () => {
    const snapshots = [
      makeSnapshot({
        id: 1,
        timestamp: "2026-04-06T10:00:00Z",
        extra_usage_enabled: 1,
        extra_usage_monthly_limit: 1,
        extra_usage_used_credits: 0.1,
      }),
      makeSnapshot({
        id: 2,
        timestamp: "2026-04-06T10:05:00Z",
        extra_usage_enabled: 1,
        extra_usage_monthly_limit: 2,
        extra_usage_used_credits: 0.1,
      }),
      makeSnapshot({
        id: 3,
        timestamp: "2026-04-06T10:10:00Z",
        extra_usage_enabled: 1,
        extra_usage_monthly_limit: 2,
        extra_usage_used_credits: 0.45,
      }),
      makeSnapshot({
        id: 4,
        timestamp: "2026-04-06T10:15:00Z",
        extra_usage_enabled: 1,
        extra_usage_monthly_limit: 3,
        extra_usage_used_credits: 0.6,
      }),
    ];

    const result = buildDashboardData(snapshots, mockStorage, mockRuntime);
    assert.equal(result.extraUsageInsights.currentBalance, 2.4);
    assert.equal(result.extraUsageInsights.totalBudget, 3);
    assert.equal(result.extraUsageInsights.totalSpent, 0.6);
    assert.equal(result.extraUsageInsights.topUpCount, 2);
    assert.equal(result.extraUsageInsights.totalTopUps, 2);
    assert.equal(result.extraUsageInsights.spendEventCount, 2);
    assert.equal(result.extraUsageInsights.trackedSpend, 0.5);
    assert.equal(result.extraUsageInsights.lastTopUpAt, "2026-04-06T10:15:00Z");
    assert.equal(result.extraUsageInsights.lastSpendAt, "2026-04-06T10:15:00Z");
    assert.equal(result.extraUsageInsights.largestTopUp?.amount, 1);
    assert.equal(result.extraUsageInsights.largestSpend?.amount, 0.35);
  });

  it("weights extra usage activity in dollars instead of cents", () => {
    const snapshots = [
      makeSnapshot({
        id: 1,
        timestamp: "2026-04-06T10:00:00Z",
        extra_usage_enabled: 1,
        extra_usage_monthly_limit: 5,
        extra_usage_used_credits: 1,
      }),
      makeSnapshot({
        id: 2,
        timestamp: "2026-04-06T10:05:00Z",
        extra_usage_enabled: 1,
        extra_usage_monthly_limit: 5,
        extra_usage_used_credits: 3,
      }),
    ];

    const result = buildDashboardData(snapshots, mockStorage, mockRuntime);
    const hour = new Date("2026-04-06T10:05:00Z").getHours();
    assert.equal(result.activity.hourlyBars[hour].totalDelta, 2);
  });

  it("counts post-reset extra usage spend in activity and insights", () => {
    const snapshots = [
      makeSnapshot({
        id: 1,
        timestamp: "2026-04-30T23:55:00Z",
        extra_usage_enabled: 1,
        extra_usage_monthly_limit: 10,
        extra_usage_used_credits: 9.8,
      }),
      makeSnapshot({
        id: 2,
        timestamp: "2026-05-01T00:05:00Z",
        extra_usage_enabled: 1,
        extra_usage_monthly_limit: 10,
        extra_usage_used_credits: 0.2,
      }),
    ];

    const result = buildDashboardData(snapshots, mockStorage, mockRuntime);
    const hour = new Date("2026-05-01T00:05:00Z").getHours();
    assert.equal(result.activity.hourlyBars[hour].totalDelta, 0.2);
    assert.equal(result.extraUsageInsights.spendEventCount, 1);
    assert.equal(result.extraUsageInsights.trackedSpend, 0.2);
    assert.equal(result.extraUsageInsights.lastSpendAt, "2026-05-01T00:05:00Z");
    assert.equal(result.extraUsageInsights.largestSpend?.amount, 0.2);
  });
});
