"use client";

import type { DashboardData } from "@/lib/analysis";

export function ExtraUsage({ data }: { data: DashboardData | null }) {
  const rawJson = data?.current?.rawJson;
  if (!rawJson) {
    return (
      <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
        No extra usage data.
      </p>
    );
  }

  // Show any keys beyond five_hour and seven_day
  const extraKeys = Object.entries(rawJson).filter(
    ([key]) => key !== "five_hour" && key !== "seven_day"
  );

  if (!extraKeys.length) {
    return (
      <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
        No extra usage data beyond standard windows.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {extraKeys.map(([key, value]) => (
        <div
          key={key}
          className="rounded-lg p-4 transition-colors duration-200"
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
          <h3
            className="text-[10px] tracking-[0.15em] uppercase mb-3"
            style={{
              color: "var(--text-accent)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {key.replaceAll("_", " ")}
          </h3>
          <pre
            className="text-[11px] whitespace-pre-wrap overflow-auto max-h-40 leading-relaxed"
            style={{
              fontFamily: "var(--font-mono)",
              color: "var(--text-secondary)",
            }}
          >
            {JSON.stringify(value, null, 2)}
          </pre>
        </div>
      ))}
    </div>
  );
}
