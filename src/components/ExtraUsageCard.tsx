"use client";

import type { DashboardData } from "@/lib/analysis";

function budgetColor(pct: number): string {
  if (pct >= 80) return "var(--danger)";
  if (pct >= 50) return "var(--warn)";
  return "var(--accent)";
}

function budgetBg(pct: number): string {
  if (pct >= 80) return "var(--danger-dim)";
  if (pct >= 50) return "var(--warn-dim)";
  return "var(--accent-dim)";
}

export function ExtraUsageCard({ data }: { data: DashboardData | null }) {
  const extra = data?.current?.extraUsage;

  if (!extra) {
    return (
      <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
        No extra usage data available.
      </p>
    );
  }

  if (!extra.isEnabled) {
    return (
      <div
        className="rounded-lg p-4"
        style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <div className="flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: "var(--text-tertiary)" }}
          />
          <span
            className="text-[10px] tracking-[0.15em] uppercase"
            style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}
          >
            Extra Usage Disabled
          </span>
        </div>
      </div>
    );
  }

  const pct = extra.utilization ?? 0;
  const color = budgetColor(pct);
  const bg = budgetBg(pct);

  return (
    <div className="grid grid-cols-1 gap-3">
      {/* Budget utilization bar */}
      <div
        className="rounded-lg p-4 relative overflow-hidden"
        style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <div
          className="absolute inset-0 opacity-100 transition-all duration-700"
          style={{
            background: `linear-gradient(to right, ${bg} ${pct}%, transparent ${pct}%)`,
          }}
        />
        <div className="relative flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span
                className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                style={{
                  fontFamily: "var(--font-mono)",
                  color,
                  background: bg,
                  letterSpacing: "0.05em",
                }}
              >
                EXTRA
              </span>
              <span
                className="text-[10px] tracking-[0.15em] uppercase"
                style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}
              >
                Monthly Budget
              </span>
            </div>
          </div>
          <div
            className="text-3xl font-bold tabular-nums"
            style={{ fontFamily: "var(--font-mono)", color }}
          >
            {pct.toFixed(1)}
            <span className="text-lg opacity-60">%</span>
          </div>
        </div>
      </div>

      {/* Credits detail */}
      <div
        className="rounded-lg p-4"
        style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p
              className="text-[10px] tracking-[0.15em] uppercase mb-1"
              style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}
            >
              Credits Used
            </p>
            <p
              className="text-sm font-semibold"
              style={{ color: "var(--text-accent)", fontFamily: "var(--font-mono)" }}
            >
              ${extra.usedCredits?.toFixed(2) ?? "0.00"}
            </p>
          </div>
          <div>
            <p
              className="text-[10px] tracking-[0.15em] uppercase mb-1"
              style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}
            >
              Monthly Limit
            </p>
            <p
              className="text-sm font-semibold"
              style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}
            >
              ${extra.monthlyLimit?.toFixed(2) ?? "---"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
