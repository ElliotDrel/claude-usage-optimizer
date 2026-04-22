"use client";

import type { DashboardData } from "@/lib/analysis";

function getStatusColor(status: string): string {
  switch (status) {
    case "ok":
      return "var(--good)";
    case "error":
      return "var(--danger)";
    case "timeout":
      return "var(--warn)";
    default:
      return "var(--text-tertiary)";
  }
}

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString();
}

export function SendHistoryPanel({ data }: { data: DashboardData | null }) {
  if (!data?.sendHistory || data.sendHistory.length === 0) {
    return (
      <section
        className="rounded-xl p-5"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <h2
          className="text-lg mb-4"
          style={{
            fontFamily: "var(--font-display)",
            color: "var(--text-primary)",
          }}
        >
          Send History
        </h2>
        <p style={{ color: "var(--text-tertiary)", fontSize: "0.875rem" }}>
          No sends recorded yet.
        </p>
      </section>
    );
  }

  return (
    <section
      className="rounded-xl p-5"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-subtle)",
      }}
    >
      <h2
        className="text-lg mb-4"
        style={{
          fontFamily: "var(--font-display)",
          color: "var(--text-primary)",
        }}
      >
        Send History
      </h2>

      <div className="space-y-2">
        {data.sendHistory.map((entry) => (
          <div
            key={entry.id}
            className="rounded-lg p-3 flex items-start justify-between gap-4"
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <p
                  className="text-sm font-mono"
                  style={{ color: "var(--text-primary)" }}
                >
                  {formatTime(entry.firedAt)}
                </p>
                {entry.scheduledFor === null && (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded"
                    style={{
                      background: "var(--accent-dim)",
                      color: "var(--accent)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    Manual
                  </span>
                )}
              </div>
              <p
                className="text-xs truncate"
                style={{ color: "var(--text-tertiary)" }}
              >
                {entry.responseExcerpt
                  ? entry.responseExcerpt.substring(0, 100)
                  : "(no response)"}
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <span
                className="text-xs px-2 py-1 rounded"
                style={{
                  background: getStatusColor(entry.status) + "22",
                  color: getStatusColor(entry.status),
                  fontFamily: "var(--font-mono)",
                }}
              >
                {entry.status}
              </span>
              {entry.durationMs !== null && (
                <span
                  className="text-[10px]"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  {entry.durationMs}ms
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
