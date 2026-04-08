import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDb, getDbMeta, insertSnapshot, querySnapshots } from "../src/lib/db";
import type { Config } from "../src/lib/config";

const dbPath = path.join(os.tmpdir(), `test-usage-${Date.now()}.db`);

const config: Config = {
  port: 3017,
  dataDir: os.tmpdir(),
  dbPath,
  endpoint: "https://api.anthropic.com/api/oauth/usage",
  bearerToken: "",
  sessionCookie: "",
  authMode: "none",
  hasAuth: false,
  demoMode: false,
};

function insert(
  overrides: Partial<Parameters<typeof insertSnapshot>[1]> & { timestamp: string }
): void {
  insertSnapshot(config, {
    timestamp: overrides.timestamp,
    status: "ok",
    endpoint: "test-endpoint",
    authMode: "bearer",
    responseStatus: 200,
    fiveHourUtilization: null,
    fiveHourResetsAt: null,
    sevenDayUtilization: null,
    sevenDayResetsAt: null,
    extraUsageEnabled: null,
    extraUsageMonthlyLimit: null,
    extraUsageUsedCredits: null,
    extraUsageUtilization: null,
    rawJson: null,
    errorMessage: null,
    ...overrides,
  });
}

after(() => {
  if (fs.existsSync(dbPath)) {
    getDb(config).close();
  }

  for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (fs.existsSync(file)) {
      fs.rmSync(file, { force: true });
    }
  }
});

describe("db helpers", () => {
  it("handles an empty database", () => {
    assert.deepEqual(querySnapshots(config), []);

    const meta = getDbMeta(config);
    assert.equal(meta.path, dbPath);
    assert.equal(meta.totalSnapshots, 0);
    assert.ok(meta.sizeBytes > 0);
  });

  it("inserts and retrieves snapshots including null fields", () => {
    insert({
      timestamp: "2026-04-06T10:00:00Z",
      fiveHourUtilization: null,
      fiveHourResetsAt: null,
      sevenDayUtilization: null,
      sevenDayResetsAt: null,
      rawJson: null,
      errorMessage: null,
    });

    const rows = querySnapshots(config);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].timestamp, "2026-04-06T10:00:00Z");
    assert.equal(rows[0].status, "ok");
    assert.equal(rows[0].five_hour_utilization, null);
    assert.equal(rows[0].five_hour_resets_at, null);
    assert.equal(rows[0].seven_day_utilization, null);
    assert.equal(rows[0].seven_day_resets_at, null);
    assert.equal(rows[0].raw_json, null);
    assert.equal(rows[0].error_message, null);

    const meta = getDbMeta(config);
    assert.equal(meta.totalSnapshots, 1);
  });

  it("filters by since, until, and status while returning rows in ascending timestamp order", () => {
    insert({
      timestamp: "2026-04-06T12:00:00Z",
      status: "ok",
      fiveHourUtilization: 20,
    });
    insert({
      timestamp: "2026-04-06T11:00:00Z",
      status: "error",
      responseStatus: 500,
      errorMessage: "request failed",
    });
    insert({
      timestamp: "2026-04-06T09:00:00Z",
      status: "ok",
      fiveHourUtilization: 5,
    });

    const allRows = querySnapshots(config);
    assert.deepEqual(
      allRows.map((row) => row.timestamp),
      [
        "2026-04-06T09:00:00Z",
        "2026-04-06T10:00:00Z",
        "2026-04-06T11:00:00Z",
        "2026-04-06T12:00:00Z",
      ]
    );

    const filtered = querySnapshots(config, {
      since: "2026-04-06T10:30:00Z",
      until: "2026-04-06T12:00:00Z",
      status: "ok",
    });

    assert.deepEqual(
      filtered.map((row) => row.timestamp),
      ["2026-04-06T12:00:00Z"]
    );
  });

  it("applies limit after sorting by ascending timestamp", () => {
    const limited = querySnapshots(config, { limit: 2 });
    assert.deepEqual(
      limited.map((row) => row.timestamp),
      ["2026-04-06T09:00:00Z", "2026-04-06T10:00:00Z"]
    );
  });
});
