import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { getDb, insertSendLog } from "../src/lib/db";
import { send, QUESTIONS } from "../src/lib/sender";
import type { Config } from "../src/lib/config";

const dbPath = path.join(os.tmpdir(), `test-send-${Date.now()}.db`);

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

describe("send_log write logic", () => {
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

  it("QUESTIONS constant has 10 items", () => {
    assert.strictEqual(QUESTIONS.length, 10);
    for (const q of QUESTIONS) {
      assert.ok(typeof q === "string" && q.length > 0, "Each question must be a non-empty string");
    }
  });

  it("manual fire writes scheduled_for=NULL and is_anchor=0", async () => {
    // No scheduledFor or isAnchor passed — should default to null/0 (D-05)
    const result = await send(config, { timeoutMs: 500 });

    assert.strictEqual(result.scheduled_for, null);
    assert.strictEqual(result.is_anchor, 0);
  });

  it("timeout is enforced: status='timeout' when timeoutMs elapses", async () => {
    // Use a very short timeout (50ms) to force a timeout outcome
    // claude CLI will never respond in 50ms
    const result = await send(config, { timeoutMs: 50 });

    // Must be timeout or error (error if claude CLI not found on PATH)
    assert.ok(
      result.status === "timeout" || result.status === "error",
      `Expected status='timeout' or 'error', got '${result.status}'`
    );

    // Duration should be recorded
    assert.ok(
      typeof result.duration_ms === "number" && result.duration_ms >= 0,
      `Expected numeric duration_ms, got ${result.duration_ms}`
    );
  });

  it("writes only one row per send — finished flag prevents double-write", async () => {
    // Verifies Pitfall 2 fix: the finished flag ensures only one insertSendLog call
    const result = await send(config, { timeoutMs: 50 });

    const db = getDb(config);
    const rows = db
      .prepare(
        `SELECT COUNT(*) as cnt FROM send_log WHERE fired_at = ?`
      )
      .get(result.fired_at) as { cnt: number };

    assert.strictEqual(rows.cnt, 1, "Should write exactly one row per send");
  });

  it("send_log row has all required columns populated", async () => {
    const result = await send(config, { timeoutMs: 500 });

    assert.ok(
      typeof result.id === "number" && result.id > 0,
      `id must be a positive integer, got ${result.id}`
    );
    assert.ok(
      typeof result.fired_at === "string" && result.fired_at.length > 0,
      "fired_at must be a non-empty ISO string"
    );
    assert.ok(
      typeof result.question === "string" && result.question.length > 0,
      "question must be a non-empty string"
    );
    assert.ok(
      ["ok", "error", "timeout"].includes(result.status),
      `status must be ok/error/timeout, got '${result.status}'`
    );
    assert.ok(
      typeof result.duration_ms === "number" && result.duration_ms >= 0,
      `duration_ms must be a non-negative number, got ${result.duration_ms}`
    );
    assert.ok(
      result.is_anchor === 0 || result.is_anchor === 1,
      `is_anchor must be 0 or 1, got ${result.is_anchor}`
    );
  });

  it("insertSendLog is directly usable for scheduled anchor sends", () => {
    // Verifies manual insertion path (D-05: manual vs scheduled distinction)
    const row = insertSendLog(config, {
      fired_at: new Date().toISOString(),
      scheduled_for: "2026-04-20T10:00:00Z",
      is_anchor: 1,
      status: "ok",
      duration_ms: 1234,
      question: QUESTIONS[0],
      response_excerpt: "Test response",
      error_message: null,
    });

    assert.ok(row.id > 0, "insertSendLog should return a row with a positive id");
    assert.strictEqual(row.scheduled_for, "2026-04-20T10:00:00Z");
    assert.strictEqual(row.is_anchor, 1);
    assert.strictEqual(row.status, "ok");
    assert.strictEqual(row.question, QUESTIONS[0]);
  });
});
