import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseSnapshot, parseSnapshots } from "../src/lib/queries";
import type { SnapshotRow } from "../src/lib/db";

function makeRawRow(overrides: Partial<SnapshotRow> & { timestamp: string }): SnapshotRow {
  return {
    id: 1,
    timestamp: overrides.timestamp,
    status: "ok",
    endpoint: "test",
    response_status: 200,
    raw_json: null,
    error_message: null,
    ...overrides,
  };
}

const bearerRaw = JSON.stringify({
  five_hour: { utilization: 55.0, resets_at: "2026-04-19T15:00:00.000Z" },
  seven_day: { utilization: 20.0, resets_at: "2026-04-26T10:00:00.000Z" },
});

const cookieRaw = JSON.stringify({
  usage: {
    five_hour: { utilization: 42.5, resets_at: "2026-04-19T15:00:00.000Z" },
    seven_day: { utilization: 30.0, resets_at: "2026-04-26T10:00:00.000Z" },
  },
  overage_spend_limit: null,
});

const demoRaw = JSON.stringify({
  five_hour: { utilization: 30.0, resets_at: "2026-04-19T15:00:00.000Z" },
  seven_day: { utilization: 25.0, resets_at: "2026-04-26T10:00:00.000Z" },
});

const extraUsageRaw = JSON.stringify({
  five_hour: { utilization: 80.0, resets_at: "2026-04-19T15:00:00.000Z" },
  extra_usage: {
    is_enabled: true,
    monthly_limit: 1000,
    used_credits: 283,
    utilization: 28.3,
  },
});

const noExtraUsageRaw = JSON.stringify({
  five_hour: { utilization: 50.0, resets_at: "2026-04-19T15:00:00.000Z" },
});

describe("parseSnapshot", () => {
  it("null raw_json -> all derived fields are null; identity fields passthrough", () => {
    const row = makeRawRow({ timestamp: "2026-04-19T10:00:00.000Z", id: 42, status: "ok", raw_json: null });
    const result = parseSnapshot(row);
    assert.equal(result.id, 42);
    assert.equal(result.timestamp, "2026-04-19T10:00:00.000Z");
    assert.equal(result.status, "ok");
    assert.equal(result.five_hour_utilization, null);
    assert.equal(result.five_hour_resets_at, null);
    assert.equal(result.seven_day_utilization, null);
    assert.equal(result.seven_day_resets_at, null);
    assert.equal(result.extra_usage_enabled, null);
    assert.equal(result.extra_usage_monthly_limit, null);
    assert.equal(result.extra_usage_used_credits, null);
    assert.equal(result.extra_usage_utilization, null);
  });

  it("bearer-auth payload (bare five_hour/seven_day at root) -> correct utilization values", () => {
    const row = makeRawRow({ timestamp: "2026-04-19T10:00:00.000Z", raw_json: bearerRaw });
    const result = parseSnapshot(row);
    assert.equal(result.five_hour_utilization, 55.0);
    assert.equal(result.five_hour_resets_at, "2026-04-19T15:00:00.000Z");
    assert.equal(result.seven_day_utilization, 20.0);
  });

  it("cookie-auth payload (usage key wraps inner object) -> correct utilization values", () => {
    const row = makeRawRow({ timestamp: "2026-04-19T10:00:00.000Z", raw_json: cookieRaw });
    const result = parseSnapshot(row);
    assert.equal(result.five_hour_utilization, 42.5);
    assert.equal(result.five_hour_resets_at, "2026-04-19T15:00:00.000Z");
    assert.equal(result.seven_day_utilization, 30.0);
  });

  it("demo payload (same shape as bearer) -> correct utilization values", () => {
    const row = makeRawRow({ timestamp: "2026-04-19T10:00:00.000Z", raw_json: demoRaw });
    const result = parseSnapshot(row);
    assert.equal(result.five_hour_utilization, 30.0);
    assert.equal(result.seven_day_utilization, 25.0);
  });

  it("extra_usage cents-to-dollars: monthly_limit=1000 cents -> 10.00, used_credits=283 cents -> 2.83", () => {
    const row = makeRawRow({ timestamp: "2026-04-19T10:00:00.000Z", raw_json: extraUsageRaw });
    const result = parseSnapshot(row);
    assert.equal(result.extra_usage_monthly_limit, 10.00);
    assert.equal(result.extra_usage_used_credits, 2.83);
  });

  it("no extra_usage key in payload -> all extra_usage derived fields are null", () => {
    const row = makeRawRow({ timestamp: "2026-04-19T10:00:00.000Z", raw_json: noExtraUsageRaw });
    const result = parseSnapshot(row);
    assert.equal(result.extra_usage_enabled, null);
    assert.equal(result.extra_usage_monthly_limit, null);
    assert.equal(result.extra_usage_used_credits, null);
    assert.equal(result.extra_usage_utilization, null);
  });

  it("malformed JSON string -> all derived fields are null, no throw", () => {
    const row = makeRawRow({ timestamp: "2026-04-19T10:00:00.000Z", raw_json: "not-json" });
    let result: ReturnType<typeof parseSnapshot> | undefined;
    assert.doesNotThrow(() => {
      result = parseSnapshot(row);
    });
    assert.equal(result!.five_hour_utilization, null);
    assert.equal(result!.seven_day_utilization, null);
    assert.equal(result!.extra_usage_enabled, null);
  });

  it("extra_usage with is_enabled=true -> extra_usage_enabled is boolean true", () => {
    const row = makeRawRow({ timestamp: "2026-04-19T10:00:00.000Z", raw_json: extraUsageRaw });
    const result = parseSnapshot(row);
    assert.equal(result.extra_usage_enabled, true);
    assert.equal(typeof result.extra_usage_enabled, "boolean");
  });
});

describe("parseSnapshots", () => {
  it("empty array -> returns []", () => {
    const result = parseSnapshots([]);
    assert.deepEqual(result, []);
  });

  it("array of 2 rows -> returns array of 2 ParsedSnapshot objects", () => {
    const rows = [
      makeRawRow({ timestamp: "2026-04-19T10:00:00.000Z", id: 1, raw_json: bearerRaw }),
      makeRawRow({ timestamp: "2026-04-19T11:00:00.000Z", id: 2, raw_json: cookieRaw }),
    ];
    const result = parseSnapshots(rows);
    assert.equal(result.length, 2);
    assert.equal(result[0].id, 1);
    assert.equal(result[0].five_hour_utilization, 55.0);
    assert.equal(result[1].id, 2);
    assert.equal(result[1].five_hour_utilization, 42.5);
  });
});
