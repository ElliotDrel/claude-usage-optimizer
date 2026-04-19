import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDb, getDbMeta, insertSnapshot, querySnapshots } from "../src/lib/db";
import type { Config } from "../src/lib/config";

const dbPath = path.join(os.tmpdir(), `test-usage-${Date.now()}.db`);

const config: Config = {
  host: "localhost",
  port: 3017,
  appUrl: "http://localhost:3017",
  autoOpenBrowser: false,
  dataDir: os.tmpdir(),
  dbPath,
  orgId: "",
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
    responseStatus: 200,
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
      rawJson: null,
      errorMessage: null,
    });

    const rows = querySnapshots(config);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].timestamp, "2026-04-06T10:00:00Z");
    assert.equal(rows[0].status, "ok");
    assert.equal(rows[0].raw_json, null);
    assert.equal(rows[0].error_message, null);

    const meta = getDbMeta(config);
    assert.equal(meta.totalSnapshots, 1);
  });

  it("filters by since, until, and status while returning rows in ascending timestamp order", () => {
    insert({
      timestamp: "2026-04-06T12:00:00Z",
      status: "ok",
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

  it("schema has exactly 7 columns after getDb", () => {
    const db = getDb(config);
    const cols = db.prepare("PRAGMA table_info(usage_snapshots)").all() as { name: string }[];
    assert.deepEqual(
      cols.map((c) => c.name),
      ["id", "timestamp", "status", "endpoint", "response_status", "raw_json", "error_message"]
    );
  });

  it("migrator is idempotent — schema_version set to simplified-v1", () => {
    const db = getDb(config);
    const rows = db.prepare(
      "SELECT value FROM app_meta WHERE key = 'schema_version'"
    ).all() as { value: string }[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].value, "simplified-v1");
  });
});
