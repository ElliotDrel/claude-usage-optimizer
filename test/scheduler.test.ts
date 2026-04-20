import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { getDb } from "../src/lib/db";
import { startScheduler } from "../src/lib/scheduler";
import type { Config } from "../src/lib/config";

const dbPath = path.join(os.tmpdir(), `test-scheduler-${Date.now()}.db`);

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

// Override getConfig() for tests — scheduler.ts reads config internally
// We inject via environment variables since getConfig() reads process.env
process.env.DATA_DIR = os.tmpdir();
process.env.APP_HOST = "localhost";
process.env.PORT = "3017";

function getMeta(db: ReturnType<typeof getDb>, key: string): string | undefined {
  const row = db
    .prepare("SELECT value FROM app_meta WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value;
}

describe("scheduler: initialize app_meta keys", () => {
  after(() => {
    for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      if (fs.existsSync(file)) {
        fs.rmSync(file, { force: true });
      }
    }
  });

  it("initializes all 10 app_meta keys with documented defaults on startup", () => {
    const db = getDb(config);
    const scheduler = startScheduler(db);
    scheduler.stop();

    assert.strictEqual(getMeta(db, "schedule_fires"), "[]");
    assert.strictEqual(getMeta(db, "schedule_fires_done"), "[]");
    assert.strictEqual(getMeta(db, "schedule_generated_at"), "");
    assert.strictEqual(getMeta(db, "peak_block"), "");
    assert.strictEqual(getMeta(db, "schedule_override_start_time"), "");
    assert.strictEqual(getMeta(db, "peak_window_hours"), "4");
    assert.strictEqual(getMeta(db, "anchor_offset_minutes"), "5");
    assert.strictEqual(getMeta(db, "default_seed_time"), "05:05");
    assert.strictEqual(getMeta(db, "user_timezone"), "America/Los_Angeles");
    assert.strictEqual(getMeta(db, "paused"), "false");

    db.close();
  });

  it("does not overwrite user-set values on repeated startup", () => {
    const db2Path = path.join(os.tmpdir(), `test-scheduler-idempotent-${Date.now()}.db`);
    const config2 = { ...config, dbPath: db2Path };
    const db = getDb(config2);

    // Pre-set a user-configured value
    db.prepare(
      "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).run("user_timezone", "Europe/Paris");

    // startScheduler should not overwrite existing values
    const scheduler = startScheduler(db);
    scheduler.stop();

    assert.strictEqual(getMeta(db, "user_timezone"), "Europe/Paris");
    assert.strictEqual(getMeta(db, "paused"), "false"); // default still written for new keys

    db.close();
    for (const file of [db2Path, `${db2Path}-wal`, `${db2Path}-shm`]) {
      if (fs.existsSync(file)) {
        fs.rmSync(file, { force: true });
      }
    }
  });
});

describe("scheduler: pause toggle", () => {
  it("skips tick when app_meta.paused = 'true'", async () => {
    const db3Path = path.join(os.tmpdir(), `test-scheduler-pause-${Date.now()}.db`);
    const config3 = { ...config, dbPath: db3Path };
    const db = getDb(config3);

    // Pre-seed paused=true and a due fire timestamp
    const fireTime = new Date(Date.now() - 30_000).toISOString(); // 30 seconds ago

    // Initialize schema
    const scheduler0 = startScheduler(db);
    scheduler0.stop();

    // Now override with paused=true and a due fire
    db.prepare(
      "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).run("paused", "true");
    db.prepare(
      "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).run("schedule_fires", JSON.stringify([{ timestamp: fireTime, isAnchor: false }]));

    // Tick with paused=true — expect no sends
    const scheduler = startScheduler(db, { nowFn: () => new Date() });
    scheduler.stop();

    // Wait briefly for async catch-up to settle
    await new Promise((r) => setTimeout(r, 100));

    const count = (
      db.prepare("SELECT COUNT(*) as cnt FROM send_log").get() as { cnt: number }
    ).cnt;

    // send_log should have 0 rows since we were paused
    assert.strictEqual(count, 0, "Paused scheduler must not fire sends");

    db.close();
    for (const file of [db3Path, `${db3Path}-wal`, `${db3Path}-shm`]) {
      if (fs.existsSync(file)) {
        fs.rmSync(file, { force: true });
      }
    }
  });
});

describe("scheduler: shouldRecomputeSchedule logic", () => {
  it("returns false before 03:00 UTC", () => {
    // We test this indirectly by verifying schedule_generated_at is NOT updated
    // when we start the scheduler before 03:00 UTC and schedule_generated_at is empty
    const db4Path = path.join(os.tmpdir(), `test-scheduler-recompute-${Date.now()}.db`);
    const config4 = { ...config, dbPath: db4Path };
    const db = getDb(config4);

    // Freeze time at 02:30 UTC — before threshold
    const frozenNow = new Date("2026-04-20T02:30:00Z");
    const scheduler = startScheduler(db, { nowFn: () => frozenNow });
    scheduler.stop();

    // schedule_generated_at should still be empty (no recompute happened)
    assert.strictEqual(getMeta(db, "schedule_generated_at"), "");

    db.close();
    for (const file of [db4Path, `${db4Path}-wal`, `${db4Path}-shm`]) {
      if (fs.existsSync(file)) {
        fs.rmSync(file, { force: true });
      }
    }
  });
});

describe("scheduler: catch-up on startup", () => {
  it("fires a missed send within the 15-minute window on startup", async () => {
    const db5Path = path.join(os.tmpdir(), `test-scheduler-catchup-${Date.now()}.db`);
    const config5 = { ...config, dbPath: db5Path };
    const db = getDb(config5);

    // Initialize app_meta
    const scheduler0 = startScheduler(db, { nowFn: () => new Date() });
    scheduler0.stop();

    // Now: seed a fire that was 10 minutes ago (within 15-min window)
    const frozenNow = new Date("2026-04-20T12:00:00Z");
    const tenMinutesAgo = new Date(frozenNow.getTime() - 10 * 60 * 1000).toISOString();
    db.prepare(
      "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).run("schedule_fires", JSON.stringify([{ timestamp: tenMinutesAgo, isAnchor: false }]));
    db.prepare(
      "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).run("schedule_fires_done", "[]");

    // Restart with frozen nowFn — catch-up should fire this missed send
    const scheduler = startScheduler(db, { nowFn: () => frozenNow });
    scheduler.stop();

    // Give async catch-up a moment to write to send_log
    await new Promise((r) => setTimeout(r, 500));

    const count = (
      db.prepare("SELECT COUNT(*) as cnt FROM send_log").get() as { cnt: number }
    ).cnt;

    // Catch-up should have attempted a send (status may be error since claude CLI not available in test)
    assert.ok(count >= 1, `Expected catch-up to fire one send, got ${count} rows in send_log`);

    // The fire timestamp should now be in schedule_fires_done
    const done = JSON.parse(getMeta(db, "schedule_fires_done") ?? "[]") as string[];
    assert.ok(done.includes(tenMinutesAgo), "Caught-up fire timestamp must be in schedule_fires_done");

    db.close();
    for (const file of [db5Path, `${db5Path}-wal`, `${db5Path}-shm`]) {
      if (fs.existsSync(file)) {
        fs.rmSync(file, { force: true });
      }
    }
  });

  it("skips a missed send older than 15 minutes on startup", async () => {
    const db6Path = path.join(os.tmpdir(), `test-scheduler-catchup-old-${Date.now()}.db`);
    const config6 = { ...config, dbPath: db6Path };
    const db = getDb(config6);

    // Initialize app_meta
    const scheduler0 = startScheduler(db, { nowFn: () => new Date() });
    scheduler0.stop();

    // Seed a fire that was 20 minutes ago (outside 15-min window)
    const frozenNow = new Date("2026-04-20T12:00:00Z");
    const twentyMinutesAgo = new Date(frozenNow.getTime() - 20 * 60 * 1000).toISOString();
    db.prepare(
      "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).run("schedule_fires", JSON.stringify([{ timestamp: twentyMinutesAgo, isAnchor: false }]));
    db.prepare(
      "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).run("schedule_fires_done", "[]");

    // Restart with frozen nowFn — old fire should be skipped
    const scheduler = startScheduler(db, { nowFn: () => frozenNow });
    scheduler.stop();

    await new Promise((r) => setTimeout(r, 200));

    const count = (
      db.prepare("SELECT COUNT(*) as cnt FROM send_log").get() as { cnt: number }
    ).cnt;

    assert.strictEqual(count, 0, "Fires older than 15 minutes must NOT be caught up");

    db.close();
    for (const file of [db6Path, `${db6Path}-wal`, `${db6Path}-shm`]) {
      if (fs.existsSync(file)) {
        fs.rmSync(file, { force: true });
      }
    }
  });
});

describe("scheduler: stop() clears the interval", () => {
  it("returns a stop function that halts the tick loop", () => {
    const db7Path = path.join(os.tmpdir(), `test-scheduler-stop-${Date.now()}.db`);
    const config7 = { ...config, dbPath: db7Path };
    const db = getDb(config7);

    const scheduler = startScheduler(db);
    assert.ok(typeof scheduler.stop === "function", "startScheduler must return { stop: () => void }");
    scheduler.stop();

    db.close();
    for (const file of [db7Path, `${db7Path}-wal`, `${db7Path}-shm`]) {
      if (fs.existsSync(file)) {
        fs.rmSync(file, { force: true });
      }
    }
  });
});
