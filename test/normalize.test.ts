import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeUsagePayload } from "../src/lib/normalize";

describe("normalizeUsagePayload", () => {
  it("extracts standard windows", () => {
    const payload = {
      five_hour: { utilization: 35, resets_at: "2026-04-06T20:00:00Z" },
      seven_day: { utilization: 18, resets_at: "2026-04-12T20:00:00Z" },
    };

    const result = normalizeUsagePayload(payload);
    assert.equal(result.windows.length, 2);
    assert.equal(result.windows[0].key, "five_hour");
    assert.equal(result.windows[0].utilization, 35);
    assert.equal(result.windows[0].resetsAt, "2026-04-06T20:00:00Z");
  });

  it("handles extra_usage as extras", () => {
    const payload = {
      five_hour: { utilization: 10, resets_at: "2026-04-06T20:00:00Z" },
      extra_usage: { is_enabled: true, monthly_limit: 100000 },
    };

    const result = normalizeUsagePayload(payload);
    assert.equal(result.windows.length, 1);
    assert.equal(result.extras.length, 1);
    assert.equal(result.extras[0].key, "extra_usage");
  });

  it("puts unknown keys in unknownKeys", () => {
    const payload = {
      five_hour: { utilization: 10, resets_at: "2026-04-06T20:00:00Z" },
      mysterious_field: { foo: "bar" },
    };

    const result = normalizeUsagePayload(payload);
    assert.equal(result.windows.length, 1);
    assert.deepEqual(result.unknownKeys, { mysterious_field: { foo: "bar" } });
  });

  it("handles empty payload", () => {
    const result = normalizeUsagePayload({});
    assert.equal(result.windows.length, 0);
    assert.equal(result.extras.length, 0);
  });
});
