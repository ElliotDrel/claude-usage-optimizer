import Database from "better-sqlite3";
import fs from "node:fs";
import type { Config } from "./config";

let db: Database.Database | null = null;

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

CREATE INDEX IF NOT EXISTS idx_snapshots_timestamp
  ON usage_snapshots(timestamp);

CREATE INDEX IF NOT EXISTS idx_snapshots_status
  ON usage_snapshots(status);

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

CREATE INDEX IF NOT EXISTS idx_send_log_fired_at
  ON send_log(fired_at);
`;

function migrateToSimplifiedSchema(db: Database.Database): void {
  const current = db
    .prepare("SELECT value FROM app_meta WHERE key = 'schema_version'")
    .get() as { value: string } | undefined;

  if (current?.value === "simplified-v1") {
    return;
  }

  const migrate = db.transaction(() => {
    const cols = db
      .prepare("PRAGMA table_info(usage_snapshots)")
      .all() as { name: string }[];
    const hasAuthMode = cols.some((c) => c.name === "auth_mode");

    if (hasAuthMode) {
      db.exec(`
        CREATE TABLE usage_snapshots_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'ok',
          endpoint TEXT,
          response_status INTEGER,
          raw_json TEXT,
          error_message TEXT
        );

        INSERT INTO usage_snapshots_new
          (id, timestamp, status, endpoint, response_status, raw_json, error_message)
        SELECT
          id, timestamp, status, endpoint, response_status, raw_json, error_message
        FROM usage_snapshots;

        DROP TABLE usage_snapshots;

        ALTER TABLE usage_snapshots_new RENAME TO usage_snapshots;

        CREATE INDEX IF NOT EXISTS idx_snapshots_timestamp
          ON usage_snapshots(timestamp);

        CREATE INDEX IF NOT EXISTS idx_snapshots_status
          ON usage_snapshots(status);
      `);
    }

    db.prepare(`
      INSERT INTO app_meta (key, value)
      VALUES ('schema_version', 'simplified-v1')
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run();

    db.prepare(`
      INSERT INTO app_meta (key, value)
      VALUES ('migrated_at', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(new Date().toISOString());
  });

  migrate();
}

export function getDb(config: Config): Database.Database {
  if (db) return db;

  fs.mkdirSync(config.dataDir, { recursive: true });
  db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);

  migrateToSimplifiedSchema(db);
  return db;
}

export interface SnapshotRow {
  id: number;
  timestamp: string;
  status: string;
  endpoint: string | null;
  response_status: number | null;
  raw_json: string | null;
  error_message: string | null;
}

export interface SendLogRow {
  id: number;
  fired_at: string;
  scheduled_for: string | null;
  is_anchor: number;
  status: string;
  duration_ms: number | null;
  question: string | null;
  response_excerpt: string | null;
  error_message: string | null;
}

export function insertSnapshot(
  config: Config,
  data: {
    timestamp: string;
    status: string;
    endpoint: string;
    responseStatus: number;
    rawJson: string | null;
    errorMessage: string | null;
  }
): void {
  const db = getDb(config);
  db.prepare(`
    INSERT INTO usage_snapshots
      (timestamp, status, endpoint, response_status, raw_json, error_message)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    data.timestamp,
    data.status,
    data.endpoint,
    data.responseStatus,
    data.rawJson,
    data.errorMessage
  );
}

export function insertSendLog(
  config: Config,
  data: Omit<SendLogRow, "id">
): SendLogRow {
  const db = getDb(config);
  const stmt = db.prepare(`
    INSERT INTO send_log
      (fired_at, scheduled_for, is_anchor, status, duration_ms, question, response_excerpt, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    data.fired_at,
    data.scheduled_for,
    data.is_anchor,
    data.status,
    data.duration_ms,
    data.question,
    data.response_excerpt,
    data.error_message
  );

  return {
    id: result.lastInsertRowid as number,
    ...data,
  };
}

export function querySnapshots(
  config: Config,
  opts?: { since?: string; until?: string; status?: string; limit?: number }
): SnapshotRow[] {
  const db = getDb(config);
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (opts?.since) {
    conditions.push("timestamp >= ?");
    params.push(opts.since);
  }
  if (opts?.until) {
    conditions.push("timestamp <= ?");
    params.push(opts.until);
  }
  if (opts?.status) {
    conditions.push("status = ?");
    params.push(opts.status);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = opts?.limit ? `LIMIT ${opts.limit}` : "";

  return db
    .prepare(`SELECT * FROM usage_snapshots ${where} ORDER BY timestamp ASC ${limit}`)
    .all(...params) as SnapshotRow[];
}

export function getDbMeta(config: Config) {
  const db = getDb(config);
  const count = (
    db.prepare("SELECT COUNT(*) as cnt FROM usage_snapshots").get() as { cnt: number }
  ).cnt;
  const stat = fs.statSync(config.dbPath);
  return {
    path: config.dbPath,
    sizeBytes: stat.size,
    totalSnapshots: count,
  };
}

export function getAppMeta(config: Config): Map<string, string> {
  const db = getDb(config);
  const rows = db.prepare("SELECT key, value FROM app_meta").all() as Array<{
    key: string;
    value: string;
  }>;
  return new Map(rows.map((r) => [r.key, r.value]));
}

export function setAppMeta(config: Config, key: string, value: string): void {
  const db = getDb(config);
  db.prepare(`
    INSERT INTO app_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

export function querySendLog(
  config: Config,
  opts?: { limit?: number; orderDesc?: boolean }
): SendLogRow[] {
  const db = getDb(config);
  const limit = opts?.limit ?? 100;
  const orderClause = opts?.orderDesc ? "DESC" : "ASC";
  return db
    .prepare(`SELECT * FROM send_log ORDER BY fired_at ${orderClause} LIMIT ?`)
    .all(limit) as SendLogRow[];
}

export function backupDatabase(config: Config, outputPath: string): void {
  const db = getDb(config);
  // Use better-sqlite3's .backup() method for online backup
  const backup = db.backup(outputPath);
  backup.step(-1); // -1 means all pages in one step
  backup.finish();
}
