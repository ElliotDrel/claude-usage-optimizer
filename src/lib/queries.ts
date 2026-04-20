import { normalizeUsagePayload } from "./normalize";
import type { SnapshotRow } from "./db";

export interface ParsedSnapshot {
  id: number;
  timestamp: string;
  status: string;
  endpoint: string | null;
  response_status: number | null;
  error_message: string | null;
  raw_json: string | null;
  five_hour_utilization: number | null;
  five_hour_resets_at: string | null;
  seven_day_utilization: number | null;
  seven_day_resets_at: string | null;
  extra_usage_enabled: boolean | null;
  extra_usage_monthly_limit: number | null;
  extra_usage_used_credits: number | null;
  extra_usage_utilization: number | null;
}

function safeParseRaw(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function parseSnapshot(row: SnapshotRow): ParsedSnapshot {
  const payload = safeParseRaw(row.raw_json);

  // Detect cookie-auth vs bearer-auth: cookie wraps data under "usage" key
  let usagePayload: Record<string, unknown>;
  if (payload && "usage" in payload && payload.usage && typeof payload.usage === "object") {
    usagePayload = payload.usage as Record<string, unknown>;
  } else {
    usagePayload = payload ?? {};
  }

  const normalized = normalizeUsagePayload(usagePayload);

  const fiveHour = normalized.windows.find((w) => w.key === "five_hour");
  const sevenDay = normalized.windows.find((w) => w.key === "seven_day");
  const eu = normalized.extraUsage;

  const centsToDollars = (v: number | null): number | null =>
    v == null ? null : Math.round(v) / 100;

  return {
    id: row.id,
    timestamp: row.timestamp,
    status: row.status,
    endpoint: row.endpoint,
    response_status: row.response_status,
    error_message: row.error_message,
    raw_json: row.raw_json,
    five_hour_utilization: fiveHour?.utilization ?? null,
    five_hour_resets_at: fiveHour?.resetsAt ?? null,
    seven_day_utilization: sevenDay?.utilization ?? null,
    seven_day_resets_at: sevenDay?.resetsAt ?? null,
    extra_usage_enabled: eu ? eu.isEnabled : null,
    extra_usage_monthly_limit: eu ? centsToDollars(eu.monthlyLimit) : null,
    extra_usage_used_credits: eu ? centsToDollars(eu.usedCredits) : null,
    extra_usage_utilization: eu?.utilization ?? null,
  };
}

export function parseSnapshots(rows: SnapshotRow[]): ParsedSnapshot[] {
  return rows.map(parseSnapshot);
}
