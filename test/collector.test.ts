import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeNextDelay, type TierState } from "../src/lib/collector";

function state(overrides: Partial<TierState> = {}): TierState {
  return {
    currentTier: "idle",
    consecutiveNoChange: 0,
    consecutiveFailures: 0,
    ...overrides,
  };
}

describe("computeNextDelay", () => {
  it("stays idle when no delta", () => {
    const result = computeNextDelay(state(), { delta: 0, success: true });
    assert.equal(result.currentTier, "idle");
    assert.equal(result.consecutiveNoChange, 1);
    assert.equal(result.delayMs, 5 * 60_000);
  });

  it("steps up idle -> light when delta detected", () => {
    const result = computeNextDelay(state(), { delta: 1, success: true });
    assert.equal(result.currentTier, "light");
    assert.equal(result.consecutiveNoChange, 0);
    assert.equal(result.delayMs, 2.5 * 60_000);
  });

  it("steps up light -> active when delta detected", () => {
    const result = computeNextDelay(
      state({ currentTier: "light" }),
      { delta: 1, success: true }
    );
    assert.equal(result.currentTier, "active");
    assert.equal(result.delayMs, 60_000);
  });

  it("steps up active -> burst when delta >= 3", () => {
    const result = computeNextDelay(
      state({ currentTier: "active" }),
      { delta: 3, success: true }
    );
    assert.equal(result.currentTier, "burst");
    assert.equal(result.delayMs, 30_000);
  });

  it("does NOT jump idle -> burst (only steps one tier)", () => {
    const result = computeNextDelay(state(), { delta: 10, success: true });
    assert.equal(result.currentTier, "light");
  });

  it("steps down one tier after 3 no-change polls", () => {
    const result = computeNextDelay(
      state({ currentTier: "light", consecutiveNoChange: 2 }),
      { delta: 0, success: true }
    );
    assert.equal(result.currentTier, "idle");
    assert.equal(result.consecutiveNoChange, 0);
  });

  it("does NOT step down before 3 no-change polls", () => {
    const result = computeNextDelay(
      state({ currentTier: "light", consecutiveNoChange: 1 }),
      { delta: 0, success: true }
    );
    assert.equal(result.currentTier, "light");
    assert.equal(result.consecutiveNoChange, 2);
  });

  it("resets consecutiveNoChange when delta detected", () => {
    const result = computeNextDelay(
      state({ currentTier: "light", consecutiveNoChange: 2 }),
      { delta: 1, success: true }
    );
    assert.equal(result.consecutiveNoChange, 0);
  });

  it("error backoff: 1st failure = 60s", () => {
    const result = computeNextDelay(state(), {
      delta: 0,
      success: false,
      consecutiveFailures: 1,
    });
    assert.equal(result.delayMs, 60_000);
  });

  it("error backoff escalates: 4th failure = 600s (10 min)", () => {
    const result = computeNextDelay(state(), {
      delta: 0,
      success: false,
      consecutiveFailures: 4,
    });
    assert.equal(result.delayMs, 600_000);
  });

  it("error backoff caps at 10 min", () => {
    const result = computeNextDelay(state(), {
      delta: 0,
      success: false,
      consecutiveFailures: 100,
    });
    assert.equal(result.delayMs, 600_000);
  });

  it("burst steps down to active after 3 polls with delta < 2", () => {
    let s = state({ currentTier: "burst", consecutiveNoChange: 0 });
    s = computeNextDelay(s, { delta: 1, success: true });
    assert.equal(s.currentTier, "burst");
    assert.equal(s.consecutiveNoChange, 1);
    s = computeNextDelay(s, { delta: 0, success: true });
    assert.equal(s.currentTier, "burst");
    assert.equal(s.consecutiveNoChange, 2);
    s = computeNextDelay(s, { delta: 1, success: true });
    assert.equal(s.currentTier, "active");
    assert.equal(s.consecutiveNoChange, 0);
  });

  it("burst stays at burst when delta >= 2", () => {
    const result = computeNextDelay(
      state({ currentTier: "burst", consecutiveNoChange: 2 }),
      { delta: 2, success: true }
    );
    assert.equal(result.currentTier, "burst");
    assert.equal(result.consecutiveNoChange, 0);
  });
});
