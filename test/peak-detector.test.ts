import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { peakDetector } from "../src/lib/peak-detector";
import type { ParsedSnapshot } from "../src/lib/queries";

// Local makeSnapshot factory — same shape as analysis.test.ts
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

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * makeDay builds a pair of snapshots for a given day at the given UTC hour:
 * - baseline snapshot at :00 with utilization 0
 * - spike snapshot at :30 with the given utilization
 * This gives computeUsageDelta a clean delta = utilization for that hour.
 */
function makeDay(
  dateStr: string,
  hour: number,
  utilization: number,
  resetStr: string
): ParsedSnapshot[] {
  return [
    makeSnapshot({
      timestamp: `${dateStr}T${pad(hour)}:00:00Z`,
      five_hour_utilization: 0,
      five_hour_resets_at: resetStr,
    }),
    makeSnapshot({
      timestamp: `${dateStr}T${pad(hour)}:30:00Z`,
      five_hour_utilization: utilization,
      five_hour_resets_at: resetStr,
    }),
  ];
}

describe("peakDetector — insufficient data", () => {
  it("returns null with 0 snapshots", () => {
    assert.equal(peakDetector([], "UTC"), null);
  });

  it("returns null with 1 day of ok snapshots", () => {
    const snaps = [...makeDay("2026-01-01", 14, 50, "2026-01-01T15:00:00Z")];
    assert.equal(peakDetector(snaps, "UTC"), null);
  });

  it("returns null with 2 days of ok snapshots", () => {
    const snaps = [
      ...makeDay("2026-01-01", 14, 50, "2026-01-01T15:00:00Z"),
      ...makeDay("2026-01-02", 14, 50, "2026-01-02T15:00:00Z"),
    ];
    assert.equal(peakDetector(snaps, "UTC"), null);
  });

  it("returns non-null with 3 days of ok snapshots", () => {
    const snaps = [
      ...makeDay("2026-01-01", 14, 50, "2026-01-01T15:00:00Z"),
      ...makeDay("2026-01-02", 14, 50, "2026-01-02T15:00:00Z"),
      ...makeDay("2026-01-03", 14, 50, "2026-01-03T15:00:00Z"),
    ];
    assert.notEqual(peakDetector(snaps, "UTC"), null);
  });

  it("ignores non-ok snapshots for day count", () => {
    // 2 ok days + 1 error day — should still return null
    const snaps = [
      ...makeDay("2026-01-01", 14, 50, "2026-01-01T15:00:00Z"),
      ...makeDay("2026-01-02", 14, 50, "2026-01-02T15:00:00Z"),
      makeSnapshot({ timestamp: "2026-01-03T14:00:00Z", status: "error" }),
    ];
    assert.equal(peakDetector(snaps, "UTC"), null);
  });
});

describe("peakDetector — basic peak detection", () => {
  // 7 days of snapshots, large delta at peak hour each day
  function makeSevenDayFixture(peakHour: number): ParsedSnapshot[] {
    const dates = [
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
      "2026-01-04",
      "2026-01-05",
      "2026-01-06",
      "2026-01-07",
    ];
    return dates.flatMap((d, i) =>
      makeDay(
        d,
        peakHour,
        80,
        `2026-01-0${i + 1}T${pad(peakHour + 1)}:00:00Z`
      )
    );
  }

  it("detects peak block when activity concentrates at hour 14 (UTC)", () => {
    const result = peakDetector(makeSevenDayFixture(14), "UTC");
    assert.notEqual(result, null);
    // peak block must contain hour 14 within the 4-hour window
    const { startHour } = result!.peakBlock;
    const inBlock = [
      startHour,
      (startHour + 1) % 24,
      (startHour + 2) % 24,
      (startHour + 3) % 24,
    ];
    assert.ok(
      inBlock.includes(14),
      `hour 14 not in block starting at ${startHour}`
    );
  });

  it("midpoint is startHour + 2 (mod 24)", () => {
    const result = peakDetector(makeSevenDayFixture(14), "UTC");
    assert.notEqual(result, null);
    const { startHour, midpoint } = result!.peakBlock;
    assert.equal(midpoint, (startHour + 2) % 24);
  });

  it("result.midpoint equals result.peakBlock.midpoint", () => {
    const result = peakDetector(makeSevenDayFixture(14), "UTC");
    assert.notEqual(result, null);
    assert.equal(result!.midpoint, result!.peakBlock.midpoint);
  });
});

describe("peakDetector — midnight wrap", () => {
  it("detects peak block starting at hour 22 when activity spans hours 22–01", () => {
    // Generate 7 days; each day has deltas at hours 22 and 23 of day N
    // and hours 0 and 1 of day N+1 (spanning midnight)
    const snaps: ParsedSnapshot[] = [];
    for (let d = 0; d < 7; d++) {
      const dayNum = d + 1;
      const dateStr = `2026-01-${pad(dayNum)}`;
      // spike at h22 and h23 of this day
      snaps.push(
        makeSnapshot({
          timestamp: `${dateStr}T22:00:00Z`,
          five_hour_utilization: 0,
          five_hour_resets_at: `${dateStr}T22:00:00Z`,
        })
      );
      snaps.push(
        makeSnapshot({
          timestamp: `${dateStr}T22:30:00Z`,
          five_hour_utilization: 80,
          five_hour_resets_at: `${dateStr}T22:00:00Z`,
        })
      );
      snaps.push(
        makeSnapshot({
          timestamp: `${dateStr}T23:00:00Z`,
          five_hour_utilization: 0,
          five_hour_resets_at: `${dateStr}T23:00:00Z`,
        })
      );
      snaps.push(
        makeSnapshot({
          timestamp: `${dateStr}T23:30:00Z`,
          five_hour_utilization: 80,
          five_hour_resets_at: `${dateStr}T23:00:00Z`,
        })
      );

      // spike at h0 and h1 of the next day
      const nextDay = d + 2;
      if (nextDay <= 8) {
        const nextDateStr = `2026-01-${pad(nextDay)}`;
        snaps.push(
          makeSnapshot({
            timestamp: `${nextDateStr}T00:00:00Z`,
            five_hour_utilization: 0,
            five_hour_resets_at: `${nextDateStr}T00:00:00Z`,
          })
        );
        snaps.push(
          makeSnapshot({
            timestamp: `${nextDateStr}T00:30:00Z`,
            five_hour_utilization: 80,
            five_hour_resets_at: `${nextDateStr}T00:00:00Z`,
          })
        );
        snaps.push(
          makeSnapshot({
            timestamp: `${nextDateStr}T01:00:00Z`,
            five_hour_utilization: 0,
            five_hour_resets_at: `${nextDateStr}T01:00:00Z`,
          })
        );
        snaps.push(
          makeSnapshot({
            timestamp: `${nextDateStr}T01:30:00Z`,
            five_hour_utilization: 80,
            five_hour_resets_at: `${nextDateStr}T01:00:00Z`,
          })
        );
      }
    }

    const result = peakDetector(snaps, "UTC");
    assert.notEqual(result, null);
    assert.equal(result!.peakBlock.startHour, 22);
    assert.equal(result!.peakBlock.midpoint, 0);
    assert.equal(result!.midpoint, 0);
  });
});

describe("peakDetector — tiebreaking", () => {
  it("prefers block whose midpoint is closest to noon", () => {
    // Two 4-hour blocks with equal sums:
    // Block A: hours 2–5 (midpoint 4)  — distance from 12: |4-12|=8
    // Block B: hours 8–11 (midpoint 10) — distance from 12: |10-12|=2
    // Block B should win
    const snaps: ParsedSnapshot[] = [];
    const dates = [
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
      "2026-01-04",
      "2026-01-05",
      "2026-01-06",
      "2026-01-07",
    ];
    dates.forEach((d) => {
      // Block A hours (2, 3, 4, 5) — delta 20 each
      [2, 3, 4, 5].forEach((h) => {
        const base = `${d}T${pad(h)}:00:00Z`;
        const ts = `${d}T${pad(h)}:30:00Z`;
        snaps.push(
          makeSnapshot({
            timestamp: base,
            five_hour_utilization: 0,
            five_hour_resets_at: base,
          })
        );
        snaps.push(
          makeSnapshot({
            timestamp: ts,
            five_hour_utilization: 20,
            five_hour_resets_at: base,
          })
        );
      });
      // Block B hours (8, 9, 10, 11) — delta 20 each (equal sum)
      [8, 9, 10, 11].forEach((h) => {
        const base = `${d}T${pad(h)}:00:00Z`;
        const ts = `${d}T${pad(h)}:30:00Z`;
        snaps.push(
          makeSnapshot({
            timestamp: base,
            five_hour_utilization: 0,
            five_hour_resets_at: base,
          })
        );
        snaps.push(
          makeSnapshot({
            timestamp: ts,
            five_hour_utilization: 20,
            five_hour_resets_at: base,
          })
        );
      });
    });
    const result = peakDetector(snaps, "UTC");
    assert.notEqual(result, null);
    assert.equal(
      result!.peakBlock.startHour,
      8,
      "Block B (startHour=8, midpoint=10) should win tiebreak"
    );
  });

  it("prefers earliest startHour when midpoints are equidistant from noon", () => {
    // Block A: hours 4–7  (midpoint 6, distance |6-12|=6)
    // Block C: hours 16–19 (midpoint 18, distance |18-12|=6)
    // Both equidistant; earliest startHour=4 wins
    const snaps: ParsedSnapshot[] = [];
    const dates = [
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
      "2026-01-04",
      "2026-01-05",
      "2026-01-06",
      "2026-01-07",
    ];
    dates.forEach((d) => {
      [4, 5, 6, 7].forEach((h) => {
        const base = `${d}T${pad(h)}:00:00Z`;
        const ts = `${d}T${pad(h)}:30:00Z`;
        snaps.push(
          makeSnapshot({
            timestamp: base,
            five_hour_utilization: 0,
            five_hour_resets_at: base,
          })
        );
        snaps.push(
          makeSnapshot({
            timestamp: ts,
            five_hour_utilization: 20,
            five_hour_resets_at: base,
          })
        );
      });
      [16, 17, 18, 19].forEach((h) => {
        const base = `${d}T${pad(h)}:00:00Z`;
        const ts = `${d}T${pad(h)}:30:00Z`;
        snaps.push(
          makeSnapshot({
            timestamp: base,
            five_hour_utilization: 0,
            five_hour_resets_at: base,
          })
        );
        snaps.push(
          makeSnapshot({
            timestamp: ts,
            five_hour_utilization: 20,
            five_hour_resets_at: base,
          })
        );
      });
    });
    const result = peakDetector(snaps, "UTC");
    assert.notEqual(result, null);
    assert.equal(
      result!.peakBlock.startHour,
      4,
      "Earliest startHour=4 should win when midpoints equidistant from noon"
    );
  });
});

describe("peakDetector — variable window size (windowHours parameter)", () => {
  it("peakDetector with non-default windowHours=5", () => {
    // Build a fixture with distinct hourly usage: hours 10–14 have high activity
    const snapshots: ParsedSnapshot[] = [
      // Day 1
      makeSnapshot({ timestamp: "2026-01-01T09:00:00Z", five_hour_utilization: 10, five_hour_resets_at: "2026-01-01T05:00:00Z" }),
      makeSnapshot({ timestamp: "2026-01-01T10:00:00Z", five_hour_utilization: 30, five_hour_resets_at: "2026-01-01T05:00:00Z" }),
      makeSnapshot({ timestamp: "2026-01-01T11:00:00Z", five_hour_utilization: 50, five_hour_resets_at: "2026-01-01T05:00:00Z" }),
      makeSnapshot({ timestamp: "2026-01-01T12:00:00Z", five_hour_utilization: 70, five_hour_resets_at: "2026-01-01T05:00:00Z" }),
      makeSnapshot({ timestamp: "2026-01-01T13:00:00Z", five_hour_utilization: 85, five_hour_resets_at: "2026-01-01T05:00:00Z" }),
      makeSnapshot({ timestamp: "2026-01-01T14:00:00Z", five_hour_utilization: 95, five_hour_resets_at: "2026-01-01T05:00:00Z" }),
      makeSnapshot({ timestamp: "2026-01-01T15:00:00Z", five_hour_utilization: 100, five_hour_resets_at: "2026-01-01T05:00:00Z" }),
      // Day 2 (repeat pattern)
      makeSnapshot({ timestamp: "2026-01-02T09:00:00Z", five_hour_utilization: 10, five_hour_resets_at: "2026-01-02T05:00:00Z" }),
      makeSnapshot({ timestamp: "2026-01-02T10:00:00Z", five_hour_utilization: 30, five_hour_resets_at: "2026-01-02T05:00:00Z" }),
      makeSnapshot({ timestamp: "2026-01-02T11:00:00Z", five_hour_utilization: 50, five_hour_resets_at: "2026-01-02T05:00:00Z" }),
      makeSnapshot({ timestamp: "2026-01-02T12:00:00Z", five_hour_utilization: 70, five_hour_resets_at: "2026-01-02T05:00:00Z" }),
      makeSnapshot({ timestamp: "2026-01-02T13:00:00Z", five_hour_utilization: 85, five_hour_resets_at: "2026-01-02T05:00:00Z" }),
      makeSnapshot({ timestamp: "2026-01-02T14:00:00Z", five_hour_utilization: 95, five_hour_resets_at: "2026-01-02T05:00:00Z" }),
      makeSnapshot({ timestamp: "2026-01-02T15:00:00Z", five_hour_utilization: 100, five_hour_resets_at: "2026-01-02T05:00:00Z" }),
      // Day 3 (repeat pattern)
      makeSnapshot({ timestamp: "2026-01-03T09:00:00Z", five_hour_utilization: 10, five_hour_resets_at: "2026-01-03T05:00:00Z" }),
      makeSnapshot({ timestamp: "2026-01-03T10:00:00Z", five_hour_utilization: 30, five_hour_resets_at: "2026-01-03T05:00:00Z" }),
      makeSnapshot({ timestamp: "2026-01-03T11:00:00Z", five_hour_utilization: 50, five_hour_resets_at: "2026-01-03T05:00:00Z" }),
      makeSnapshot({ timestamp: "2026-01-03T12:00:00Z", five_hour_utilization: 70, five_hour_resets_at: "2026-01-03T05:00:00Z" }),
      makeSnapshot({ timestamp: "2026-01-03T13:00:00Z", five_hour_utilization: 85, five_hour_resets_at: "2026-01-03T05:00:00Z" }),
      makeSnapshot({ timestamp: "2026-01-03T14:00:00Z", five_hour_utilization: 95, five_hour_resets_at: "2026-01-03T05:00:00Z" }),
      makeSnapshot({ timestamp: "2026-01-03T15:00:00Z", five_hour_utilization: 100, five_hour_resets_at: "2026-01-03T05:00:00Z" }),
    ];

    // With windowHours=5, the peak 5-hour block should be 10–14 (start hour 10)
    // Midpoint of a 5-hour block is Math.floor(5/2) = 2, so midpoint = (10 + 2) % 24 = 12
    const result = peakDetector(snapshots, "UTC", 5);

    if (result === null) {
      throw new Error("Expected peakDetector to return a result with 3+ days of data");
    }

    const { peakBlock } = result;

    // The peak should start at hour 10
    if (peakBlock.startHour !== 10) {
      throw new Error(`Expected startHour=10, got ${peakBlock.startHour}`);
    }

    // With windowHours=5, endHour should be (10 + 5) % 24 = 15
    if (peakBlock.endHour !== 15) {
      throw new Error(`Expected endHour=15, got ${peakBlock.endHour}`);
    }

    // Midpoint should be (10 + 2) % 24 = 12 (Math.floor(5/2) = 2)
    if (peakBlock.midpoint !== 12) {
      throw new Error(`Expected midpoint=12, got ${peakBlock.midpoint}`);
    }
  });
});
