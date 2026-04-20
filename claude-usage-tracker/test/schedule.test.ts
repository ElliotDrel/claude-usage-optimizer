import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateSchedule } from "../src/lib/schedule";
import type { FireTime } from "../src/lib/schedule";
import type { PeakBlock } from "../src/lib/peak-detector";

function makePeakBlock(midpoint: number): PeakBlock {
  return {
    startHour: (midpoint - 2 + 24) % 24,
    endHour: (midpoint + 2) % 24,
    sumDelta: 100,
    midpoint,
  };
}

function anchor(fires: FireTime[]): FireTime {
  const a = fires.find((f) => f.isAnchor);
  assert.ok(a, "no anchor found");
  return a!;
}

describe("generateSchedule — basic shape", () => {
  it("returns exactly 5 FireTime objects", () => {
    const fires = generateSchedule(makePeakBlock(2));
    assert.equal(fires.length, 5);
  });

  it("exactly one fire is the anchor", () => {
    const fires = generateSchedule(makePeakBlock(2));
    const anchors = fires.filter((f) => f.isAnchor);
    assert.equal(anchors.length, 1);
  });

  it("anchor has jitterMinutes=0", () => {
    const fires = generateSchedule(makePeakBlock(2));
    assert.equal(anchor(fires).jitterMinutes, 0);
  });

  it("non-anchors have jitterMinutes in [0, 5]", () => {
    const fires = generateSchedule(makePeakBlock(2));
    for (const f of fires.filter((f) => !f.isAnchor)) {
      assert.ok(
        f.jitterMinutes >= 0 && f.jitterMinutes <= 5,
        `jitterMinutes ${f.jitterMinutes} out of range`
      );
    }
  });
});

describe("generateSchedule — anchor calculation", () => {
  it("anchor hour equals peakBlock.midpoint", () => {
    const fires = generateSchedule(makePeakBlock(2));
    assert.equal(anchor(fires).hour, 2);
  });

  it("anchor minute equals anchorOffsetMinutes default 5", () => {
    const fires = generateSchedule(makePeakBlock(2));
    assert.equal(anchor(fires).minute, 5);
  });

  it("custom anchorOffsetMinutes is honored", () => {
    const fires = generateSchedule(makePeakBlock(2), { anchorOffsetMinutes: 10 });
    assert.equal(anchor(fires).minute, 10);
  });
});

describe("generateSchedule — 5-hour spacing", () => {
  it("consecutive fires are 5 hours apart (mod 24)", () => {
    const fires = generateSchedule(makePeakBlock(2));
    for (let i = 1; i < fires.length; i++) {
      const expectedHour = (fires[0].hour + i * 5) % 24;
      assert.equal(
        fires[i].hour,
        expectedHour,
        `fire[${i}] hour=${fires[i].hour} expected=${expectedHour}`
      );
    }
  });

  it("fires wrap past 24h without dropping (midpoint=22)", () => {
    const fires = generateSchedule(makePeakBlock(22));
    // anchor at hour 22 (minute=5), then 3, 8, 13, 18
    const expectedHours = [22, 3, 8, 13, 18];
    fires.forEach((f, i) => {
      assert.equal(
        f.hour,
        expectedHours[i],
        `fire[${i}] hour=${f.hour} expected=${expectedHours[i]}`
      );
    });
  });
});

describe("generateSchedule — override short-circuit", () => {
  it("when overrideStartTime='14:30', anchor is hour=14, minute=30", () => {
    const fires = generateSchedule(makePeakBlock(2), { overrideStartTime: "14:30" });
    assert.equal(anchor(fires).hour, 14);
    assert.equal(anchor(fires).minute, 30);
  });

  it("override produces correct chain hours: 14,19,0,5,10", () => {
    const fires = generateSchedule(null, { overrideStartTime: "14:30" });
    const expectedHours = [14, 19, 0, 5, 10];
    fires.forEach((f, i) => {
      assert.equal(
        f.hour,
        expectedHours[i],
        `fire[${i}] hour=${f.hour} expected=${expectedHours[i]}`
      );
    });
  });

  it("peakBlock is ignored when overrideStartTime is present", () => {
    const withPeak = generateSchedule(makePeakBlock(2), { overrideStartTime: "14:30" });
    assert.equal(anchor(withPeak).hour, 14);
    assert.equal(anchor(withPeak).minute, 30);
  });
});

describe("generateSchedule — null peak fallback", () => {
  it("when peakBlock=null, uses defaultSeedTime '05:05' → anchor hour=5, minute=5", () => {
    const fires = generateSchedule(null, { defaultSeedTime: "05:05" });
    assert.equal(anchor(fires).hour, 5);
    assert.equal(anchor(fires).minute, 5);
  });

  it("custom defaultSeedTime '23:00' produces anchor at hour=23, minute=0", () => {
    const fires = generateSchedule(null, { defaultSeedTime: "23:00" });
    assert.equal(anchor(fires).hour, 23);
    assert.equal(anchor(fires).minute, 0);
  });

  it("hardcoded default seed is 05:05 when defaultSeedTime not supplied", () => {
    const fires = generateSchedule(null);
    assert.equal(anchor(fires).hour, 5);
    assert.equal(anchor(fires).minute, 5);
  });
});
