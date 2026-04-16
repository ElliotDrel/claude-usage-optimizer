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

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const MIGRATIONS = `
ALTER TABLE usage_snapshots ADD COLUMN extra_usage_enabled INTEGER;
ALTER TABLE usage_snapshots ADD COLUMN extra_usage_monthly_limit REAL;
ALTER TABLE usage_snapshots ADD COLUMN extra_usage_used_credits REAL;
ALTER TABLE usage_snapshots ADD COLUMN extra_usage_utilization REAL;
`;

export function getDb(config: Config): Database.Database {
  if (db) return db;

  fs.mkdirSync(config.dataDir, { recursive: true });
  db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);

  for (const stmt of MIGRATIONS.trim().split("\n").filter(Boolean)) {
    try {
      db.exec(stmt);
    } catch {
      // Column already exists; safe to ignore.
    }
  }

  migrateExtraUsageMoneyToDollars(db);
  return db;
}

function migrateExtraUsageMoneyToDollars(db: Database.Database): void {
  const migrationKey = "extra_usage_money_unit";
  const current = db
    .prepare("SELECT value FROM app_meta WHERE key = ?")
    .get(migrationKey) as { value: string } | undefined;

  if (current?.value === "dollars") {
    return;
  }

  const transaction = db.transaction(() => {
    db.prepare(`
      UPDATE usage_snapshots
      SET
        extra_usage_monthly_limit = ROUND(extra_usage_monthly_limit / 100.0, 2),
        extra_usage_used_credits = ROUND(extra_usage_used_credits / 100.0, 2)
      WHERE extra_usage_monthly_limit IS NOT NULL OR extra_usage_used_credits IS NOT NULL
    `).run();

    db.prepare(`
      INSERT INTO app_meta (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(migrationKey, "dollars");
  });

  transaction();
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
  extra_usage_enabled: number | null;
  extra_usage_monthly_limit: number | null;
  extra_usage_used_credits: number | null;
  extra_usage_utilization: number | null;
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
    extraUsageEnabled: boolean | null;
    extraUsageMonthlyLimit: number | null;
    extraUsageUsedCredits: number | null;
    extraUsageUtilization: number | null;
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
       extra_usage_enabled, extra_usage_monthly_limit,
       extra_usage_used_credits, extra_usage_utilization,
       raw_json, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    data.extraUsageEnabled != null ? (data.extraUsageEnabled ? 1 : 0) : null,
    data.extraUsageMonthlyLimit,
    data.extraUsageUsedCredits,
    data.extraUsageUtilization,
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
