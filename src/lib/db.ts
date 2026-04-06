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
  auth_mode TEXT,
  response_status INTEGER,
  five_hour_utilization REAL,
  five_hour_resets_at TEXT,
  seven_day_utilization REAL,
  seven_day_resets_at TEXT,
  raw_json TEXT,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_snapshots_timestamp
  ON usage_snapshots(timestamp);

CREATE INDEX IF NOT EXISTS idx_snapshots_status
  ON usage_snapshots(status);
`;

export function getDb(config: Config): Database.Database {
  if (db) return db;

  fs.mkdirSync(config.dataDir, { recursive: true });
  db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}

export interface SnapshotRow {
  id: number;
  timestamp: string;
  status: string;
  endpoint: string | null;
  auth_mode: string | null;
  response_status: number | null;
  five_hour_utilization: number | null;
  five_hour_resets_at: string | null;
  seven_day_utilization: number | null;
  seven_day_resets_at: string | null;
  raw_json: string | null;
  error_message: string | null;
}

export function insertSnapshot(
  config: Config,
  data: {
    timestamp: string;
    status: string;
    endpoint: string;
    authMode: string;
    responseStatus: number;
    fiveHourUtilization: number | null;
    fiveHourResetsAt: string | null;
    sevenDayUtilization: number | null;
    sevenDayResetsAt: string | null;
    rawJson: string | null;
    errorMessage: string | null;
  }
): void {
  const db = getDb(config);
  db.prepare(`
    INSERT INTO usage_snapshots
      (timestamp, status, endpoint, auth_mode, response_status,
       five_hour_utilization, five_hour_resets_at,
       seven_day_utilization, seven_day_resets_at,
       raw_json, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.timestamp,
    data.status,
    data.endpoint,
    data.authMode,
    data.responseStatus,
    data.fiveHourUtilization,
    data.fiveHourResetsAt,
    data.sevenDayUtilization,
    data.sevenDayResetsAt,
    data.rawJson,
    data.errorMessage
  );
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
  const count = (db.prepare("SELECT COUNT(*) as cnt FROM usage_snapshots").get() as { cnt: number }).cnt;
  const stat = fs.statSync(config.dbPath);
  return {
    path: config.dbPath,
    sizeBytes: stat.size,
    totalSnapshots: count,
  };
}
