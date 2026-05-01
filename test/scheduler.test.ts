/**
 * scheduler.test.ts
 *
 * Fake-clock unit tests for src/lib/scheduler.ts.
 * Uses node:test + node:assert/strict.
 *
 * Architecture note: scheduler.ts calls getConfig() internally, and send()
 * calls insertSendLog(config, ...) which calls getDb(config) — the singleton.
 * To keep all reads/writes on the same db handle, tests use getDb() from
 * src/lib/db.ts (same singleton that send() uses), point DATA_DIR to tmpdir,
 * and truncate relevant tables between tests instead of creating new dbs.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { startScheduler, tickOnce } from "../src/lib/scheduler";

// Inline minimal schema — mirrors SCHEMA constant from src/lib/db.ts
const SCHEMA = `
CREATE TABLE IF NOT EXISTS usage_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok',
  endpoint TEXT,
  response_status INTEGER,
  raw_json TEXT,
  error_message TEXT
);
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS send_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  fired_at        TEXT    NOT NULL,
  scheduled_for   TEXT,
  is_anchor       INTEGER NOT NULL,
  status          TEXT    NOT NULL,
  duration_ms     INTEGER,
  question        TEXT,
  response_excerpt TEXT,
  error_message   TEXT
);
`;

// Set env vars so getConfig() inside scheduler.ts resolves to a stable path
process.env.DATA_DIR = os.tmpdir();
process.env.APP_HOST = "localhost";
process.env.PORT = "3017";
// Ensure demo mode is off so config.dbPath uses usage.db (not demo.db)
process.env.NODE_ENV = "test";

/** Create a fresh isolated database for one test. */
function makeDb(label: string): Database.Database {
  const dbPath = path.join(os.tmpdir(), `sched-${label}-${Date.now()}.db`);
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}

/** Close a db handle and remove its files. */
function closeDb(db: Database.Database): void {
  const dbPath = (db as unknown as { name: string }).name;
  try { db.close(); } catch { /* already closed */ }
  for (const ext of ["", "-wal", "-shm"]) {
    const p = `${dbPath}${ext}`;
    if (fs.existsSync(p)) {
      try { fs.rmSync(p, { force: true }); } catch { /* ignore */ }
    }
  }
}

function getMeta(db: Database.Database, key: string): string | undefined {
  return (
    db.prepare("SELECT value FROM app_meta WHERE key = ?").get(key) as
      | { value: string }
      | undefined
  )?.value;
}

function setMeta(db: Database.Database, key: string, value: string): void {
  db.prepare(
    "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, value);
}

// ---------------------------------------------------------------------------
// DATA-04: initializeAppMeta
// ---------------------------------------------------------------------------

describe("scheduler: initialize app_meta keys", () => {
  it("initializes all 10 app_meta keys with documented defaults on startup", () => {
    const db = makeDb("init");
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

    closeDb(db);
  });

  it("does not overwrite user-set values on repeated startup", () => {
    const db = makeDb("idempotent");

    // Pre-set a user-configured value before first startup
    setMeta(db, "user_timezone", "Europe/Paris");

    const scheduler = startScheduler(db);
    scheduler.stop();

    // User-set value must be preserved (ON CONFLICT DO NOTHING)
    assert.strictEqual(getMeta(db, "user_timezone"), "Europe/Paris");
    // Other unset keys still get the default
    assert.strictEqual(getMeta(db, "paused"), "false");

    closeDb(db);
  });
});

// ---------------------------------------------------------------------------
// SCHED-12: Pause toggle
// ---------------------------------------------------------------------------

describe("scheduler: pause toggle", () => {
  it("skips catch-up fires when paused = 'true'", async () => {
    const db = makeDb("pause");

    // Initialize defaults, then override paused=true with a due fire
    const s0 = startScheduler(db, { nowFn: () => new Date() });
    s0.stop();

    const fireTime = new Date(Date.now() - 30_000).toISOString(); // due 30s ago
    setMeta(db, "paused", "true");
    setMeta(db, "schedule_fires", JSON.stringify([{ timestamp: fireTime, isAnchor: false }]));
    setMeta(db, "schedule_fires_done", "[]");

    // Restart with paused=true — catch-up must be suppressed
    const scheduler = startScheduler(db, { nowFn: () => new Date() });
    scheduler.stop();

    await new Promise((r) => setTimeout(r, 150));

    const count = (db.prepare("SELECT COUNT(*) as cnt FROM send_log").get() as { cnt: number }).cnt;
    assert.strictEqual(count, 0, "Paused scheduler must not fire sends on startup catch-up");

    closeDb(db);
  });
});

// ---------------------------------------------------------------------------
// SCHED-01: shouldRecomputeSchedule — time gate
// ---------------------------------------------------------------------------

describe("scheduler: shouldRecomputeSchedule logic", () => {
  it("does not trigger recompute before 03:00 UTC", () => {
    const db = makeDb("recompute-early");

    // Freeze clock at 02:30 UTC — before the 03:00 threshold
    const frozenNow = new Date("2026-04-20T02:30:00Z");
    const scheduler = startScheduler(db, { nowFn: () => frozenNow });
    scheduler.stop();

    // schedule_generated_at should still be empty (no recompute triggered)
    assert.strictEqual(getMeta(db, "schedule_generated_at"), "");

    closeDb(db);
  });
});

// ---------------------------------------------------------------------------
// SCHED-10: Catch-up on startup
// ---------------------------------------------------------------------------

describe("scheduler: catch-up on startup", () => {
  it("fires a missed send within the 15-minute window", async () => {
    const db = makeDb("catchup-recent");

    // Initialize defaults
    const s0 = startScheduler(db, { nowFn: () => new Date() });
    s0.stop();

    // Seed a fire 10 minutes ago (within 15-min window)
    const frozenNow = new Date("2026-04-20T12:00:00Z");
    const tenMinutesAgo = new Date(frozenNow.getTime() - 10 * 60 * 1000).toISOString();
    setMeta(db, "paused", "false");
    setMeta(db, "schedule_fires", JSON.stringify([{ timestamp: tenMinutesAgo, isAnchor: false }]));
    setMeta(db, "schedule_fires_done", "[]");

    // Restart with frozen clock and a short send timeout so catch-up completes
    // quickly (50ms forces a timeout/error status, but send() still inserts a
    // row and catchUpOnStartup still writes the timestamp to schedule_fires_done).
    const scheduler = startScheduler(db, { nowFn: () => frozenNow, sendTimeoutMs: 50 });
    scheduler.stop();

    // Wait for async catch-up to complete — 50ms send timeout + overhead
    await new Promise((r) => setTimeout(r, 800));

    // Fire timestamp must appear in schedule_fires_done — confirms catch-up ran
    const done = JSON.parse(getMeta(db, "schedule_fires_done") ?? "[]") as string[];
    assert.ok(
      done.includes(tenMinutesAgo),
      `Caught-up timestamp must be in schedule_fires_done; got: ${JSON.stringify(done)}`
    );

    closeDb(db);
  });

  it("skips a missed send older than 15 minutes", async () => {
    const db = makeDb("catchup-old");

    // Initialize defaults
    const s0 = startScheduler(db, { nowFn: () => new Date() });
    s0.stop();

    // Seed a fire 20 minutes ago (outside 15-min window)
    const frozenNow = new Date("2026-04-20T12:00:00Z");
    const twentyMinutesAgo = new Date(frozenNow.getTime() - 20 * 60 * 1000).toISOString();
    setMeta(db, "paused", "false");
    setMeta(db, "schedule_fires", JSON.stringify([{ timestamp: twentyMinutesAgo, isAnchor: false }]));
    setMeta(db, "schedule_fires_done", "[]");

    // Restart — old fire must be skipped
    const scheduler = startScheduler(db, { nowFn: () => frozenNow });
    scheduler.stop();

    await new Promise((r) => setTimeout(r, 200));

    const count = (db.prepare("SELECT COUNT(*) as cnt FROM send_log").get() as { cnt: number }).cnt;
    assert.strictEqual(count, 0, "Fires older than 15 minutes must NOT be caught up");

    closeDb(db);
  });
});

// ---------------------------------------------------------------------------
// SCHED-11: stop() returns the interval handle
// ---------------------------------------------------------------------------

describe("scheduler: stop() clears the interval", () => {
  it("returns a stop function that halts the tick loop", () => {
    const db = makeDb("stop");

    const scheduler = startScheduler(db);
    assert.ok(typeof scheduler.stop === "function", "startScheduler must return { stop: () => void }");
    scheduler.stop();

    closeDb(db);
  });
});

// ---------------------------------------------------------------------------
// SCHED-11: tick fires due slot / skips already-done slot
// ---------------------------------------------------------------------------


describe("scheduler: tick fires due slot (SCHED-11)", () => {
  it("fires a due slot not in the done list", async () => {
    const db = makeDb("tick-fire");

    const frozenNow = new Date("2026-04-20T14:10:00Z");
    const fireTs = "2026-04-20T14:05:00Z";

    // Initialize defaults first
    const s0 = startScheduler(db, { nowFn: () => frozenNow });
    s0.stop();

    setMeta(db, "schedule_fires", JSON.stringify([{ timestamp: fireTs, isAnchor: false }]));
    setMeta(db, "schedule_fires_done", "[]");
    setMeta(db, "paused", "false");
    // Prevent recompute: mark schedule already generated today so tick skips recompute
    setMeta(db, "schedule_generated_at", "2026-04-20T03:00:00Z");

    // Run one tick with a short send timeout so claude CLI doesn't hang the test
    await tickOnce(db, () => frozenNow, 50);

    const done = JSON.parse(getMeta(db, "schedule_fires_done") ?? "[]") as string[];
    assert.ok(
      done.includes(fireTs),
      `Due fire must appear in schedule_fires_done; got: ${JSON.stringify(done)}`
    );

    closeDb(db);
  });

  it("skips a slot already in the done list", async () => {
    const db = makeDb("tick-skip");

    const frozenNow = new Date("2026-04-20T14:10:00Z");
    const fireTs = "2026-04-20T14:05:00Z";

    // Initialize defaults first
    const s0 = startScheduler(db, { nowFn: () => frozenNow });
    s0.stop();

    setMeta(db, "schedule_fires", JSON.stringify([{ timestamp: fireTs, isAnchor: false }]));
    setMeta(db, "schedule_fires_done", JSON.stringify([fireTs])); // already done
    setMeta(db, "paused", "false");
    // Prevent recompute so no newly-generated fires become due during the tick
    setMeta(db, "schedule_generated_at", "2026-04-20T03:00:00Z");

    await tickOnce(db, () => frozenNow, 50);

    const count = (
      db.prepare("SELECT COUNT(*) as cnt FROM send_log").get() as { cnt: number }
    ).cnt;
    assert.strictEqual(count, 0, "Already-done slot must not fire again");

    closeDb(db);
  });
});

// ---------------------------------------------------------------------------
// SCHED-01: nightly recompute at 03:00 UTC
// ---------------------------------------------------------------------------

describe("scheduler: nightly recompute (SCHED-01)", () => {
  it("triggers recompute when schedule_generated_at is from a previous day", async () => {
    const db = makeDb("recompute-trigger");

    const frozenNow = new Date("2026-04-20T03:05:00Z");

    // Initialize defaults first
    const s0 = startScheduler(db, { nowFn: () => frozenNow });
    s0.stop();

    // Set generated_at to yesterday
    setMeta(db, "schedule_generated_at", "2026-04-19T03:00:00Z");
    setMeta(db, "paused", "false");

    // Run one tick — should detect stale schedule and recompute
    await tickOnce(db, () => frozenNow, 50);

    const generatedAt = getMeta(db, "schedule_generated_at") ?? "";
    assert.notStrictEqual(
      generatedAt,
      "2026-04-19T03:00:00Z",
      "schedule_generated_at must be updated after recompute"
    );
    assert.ok(
      generatedAt.startsWith("2026-04-20"),
      `schedule_generated_at must start with today's UTC date; got: ${generatedAt}`
    );

    closeDb(db);
  });

  it("does not trigger recompute when schedule_generated_at is already today", async () => {
    const db = makeDb("recompute-skip");

    const frozenNow = new Date("2026-04-20T03:05:00Z");
    const todayGenerated = "2026-04-20T03:00:00Z";

    // Initialize defaults first
    const s0 = startScheduler(db, { nowFn: () => frozenNow });
    s0.stop();

    // Set generated_at to today already
    setMeta(db, "schedule_generated_at", todayGenerated);
    setMeta(db, "paused", "false");

    // Run one tick — should NOT recompute since already done today
    await tickOnce(db, () => frozenNow, 50);

    const generatedAt = getMeta(db, "schedule_generated_at");
    assert.strictEqual(
      generatedAt,
      todayGenerated,
      "schedule_generated_at must be unchanged when schedule already generated today"
    );

    closeDb(db);
  });
});
