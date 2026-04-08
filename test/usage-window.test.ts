import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeUsageDelta,
  isSameUsageWindow,
  normalizeResetHour,
} from "../src/lib/usage-window";

describe("normalizeResetHour", () => {
  it("normalizes valid timestamps to the top of the UTC hour", () => {
    assert.equal(
      normalizeResetHour("2026-04-06T15:42:19.123Z"),
      "2026-04-06T15:00:00.000Z"
    );
  });

  it("returns null for missing reset times", () => {
    assert.equal(normalizeResetHour(null), null);
  });

  it("returns invalid date strings unchanged", () => {
    assert.equal(normalizeResetHour("not-a-date"), "not-a-date");
  });
});

describe("isSameUsageWindow", () => {
  it("treats identical reset times as the same window", () => {
    assert.equal(
      isSameUsageWindow("2026-04-06T15:00:00Z", "2026-04-06T15:00:00Z"),
      true
    );
  });

  it("ignores reset jitter within the same hour", () => {
    assert.equal(
      isSameUsageWindow(
        "2026-04-06T15:00:00.738106+00:00",
        "2026-04-06T15:00:01.267402+00:00"
      ),
      true
    );
  });

  it("detects different reset hours as different windows", () => {
    assert.equal(
      isSameUsageWindow("2026-04-06T15:59:59Z", "2026-04-06T16:00:00Z"),
      false
    );
  });

  it("handles null and invalid dates consistently", () => {
    assert.equal(isSameUsageWindow(null, null), true);
    assert.equal(isSameUsageWindow("not-a-date", "not-a-date"), true);
    assert.equal(isSameUsageWindow("not-a-date", null), false);
  });
});

describe("computeUsageDelta", () => {
  it("computes a positive delta within the same window", () => {
    assert.equal(
      computeUsageDelta(10, 22, "2026-04-06T15:00:00Z", "2026-04-06T15:30:00Z"),
      12
    );
  });

  it("uses the current utilization after a window reset", () => {
    assert.equal(
      computeUsageDelta(80, 5, "2026-04-06T15:00:00Z", "2026-04-06T16:00:00Z"),
      5
    );
  });

  it("returns zero when the current utilization is null", () => {
    assert.equal(
      computeUsageDelta(50, null, "2026-04-06T15:00:00Z", null),
      0
    );
  });

  it("uses the current utilization when the previous utilization is null", () => {
    assert.equal(
      computeUsageDelta(null, 15, null, "2026-04-06T15:00:00Z"),
      15
    );
  });

  it("clamps negative deltas to zero within the same window", () => {
    assert.equal(
      computeUsageDelta(30, 10, "2026-04-06T15:00:00Z", "2026-04-06T15:45:00Z"),
      0
    );
  });

  it("treats missing or invalid reset values as different windows when they differ", () => {
    assert.equal(
      computeUsageDelta(25, 7, null, "2026-04-06T15:00:00Z"),
      7
    );
    assert.equal(
      computeUsageDelta(25, 7, "bad-date", "2026-04-06T15:00:00Z"),
      7
    );
  });
});
