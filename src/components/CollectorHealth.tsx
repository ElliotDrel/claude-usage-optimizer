"use client";

import type { DashboardData } from "@/lib/analysis";
import { formatDistanceToNow } from "date-fns";

function formatDelay(tier: string): string {
  switch (tier) {
    case "burst": return "30s";
    case "active": return "1m";
    case "light": return "2.5m";
    case "idle": return "5m";
    default: return "—";
  }
}

function Metric({
  label,
  value,
  detail,
  accent,
}: {
  label: string;
  value: string;
  detail: string;
  accent?: boolean;
}) {
  return (
    <div
      className="rounded-lg p-3.5 transition-colors duration-200"
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-subtle)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--border-default)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--border-subtle)";
      }}
    >
      <p
        className="text-[10px] tracking-[0.15em] uppercase mb-2"
        style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}
      >
        {label}
      </p>
      <p
        className="text-xl font-semibold mb-1"
        style={{
          fontFamily: "var(--font-mono)",
          color: accent ? "var(--text-accent)" : "var(--text-primary)",
        }}
      >
        {value}
      </p>
      <p
        className="text-[11px] truncate"
        style={{ color: "var(--text-tertiary)" }}
      >
        {detail}
      </p>
    </div>
  );
}

export function CollectorHealth({ data }: { data: DashboardData | null }) {
  if (!data) {
    return (
      <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
        No data available.
      </p>
    );
  }

  const { runtime, health, storage } = data;

  const lastSuccess = runtime.lastSuccessAt
    ? formatDistanceToNow(new Date(runtime.lastSuccessAt), { addSuffix: true })
    : "Never";

  const nextPoll = runtime.nextPollAt
    ? formatDistanceToNow(new Date(runtime.nextPollAt), { addSuffix: true })
    : "—";

  return (
    <div>
      {/* Status bar */}
      <div
        className="flex items-center gap-4 text-[11px] mb-4 pb-3"
        style={{
          color: "var(--text-tertiary)",
          fontFamily: "var(--font-mono)",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        <span>
          Last success:{" "}
          <span style={{ color: "var(--text-secondary)" }}>{lastSuccess}</span>
        </span>
        <span style={{ color: "var(--border-default)" }}>|</span>
        <span>
          Storage:{" "}
          <span style={{ color: "var(--text-secondary)" }}>
            {(storage.sizeBytes / 1024).toFixed(1)} KB
          </span>
        </span>
        <span style={{ color: "var(--border-default)" }}>|</span>
        <span>
          <span style={{ color: "var(--text-secondary)" }}>
            {storage.totalSnapshots}
          </span>{" "}
          snapshots
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric
          label="Auth"
          value={runtime.authMode}
          detail={runtime.isConfigured ? "Configured" : "Missing credentials"}
          accent
        />
        <Metric
          label="Tier"
          value={runtime.currentTier}
          detail={formatDelay(runtime.currentTier)}
        />
        <Metric
          label="Next Poll"
          value={nextPoll}
          detail={`${health.successCount} ok / ${health.errorCount} err`}
        />
        <Metric
          label="Failures"
          value={String(runtime.consecutiveFailures)}
          detail={runtime.lastError ?? "No errors"}
        />
      </div>
    </div>
  );
}
