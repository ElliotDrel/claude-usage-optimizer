"use client";

import type { DashboardData } from "@/lib/analysis";
import { formatDistanceToNow } from "date-fns";

function utilizationColor(pct: number): string {
  if (pct >= 80) return "var(--danger)";
  if (pct >= 50) return "var(--warn)";
  return "var(--good)";
}

function utilizationBg(pct: number): string {
  if (pct >= 80) return "var(--danger-dim)";
  if (pct >= 50) return "var(--warn-dim)";
  return "var(--good-dim)";
}

export function UsageCards({ data }: { data: DashboardData | null }) {
  if (!data?.current) {
    return (
      <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
        No successful polls yet.
      </p>
    );
  }

  const windows = [
    { label: "5-Hour", tag: "5H", ...data.current.fiveHour },
    { label: "7-Day", tag: "7D", ...data.current.sevenDay },
  ].filter((w) => w.utilization != null);

  if (!windows.length) {
    return (
      <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
        No usage windows in latest response.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3">
      {windows.map((w) => {
        const color = utilizationColor(w.utilization!);
        const bg = utilizationBg(w.utilization!);
        const pct = w.utilization!;

        return (
          <div
            key={w.label}
            className="rounded-lg p-4 relative overflow-hidden"
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            {/* Utilization bar background */}
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
                    {w.tag}
                  </span>
                  <span
                    className="text-[10px] tracking-[0.15em] uppercase"
                    style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}
                  >
                    {w.label} window
                  </span>
                </div>
                {w.resetsAt && (
                  <p
                    className="text-[11px] mt-1"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    Resets{" "}
                    {formatDistanceToNow(new Date(w.resetsAt!), {
                      addSuffix: true,
                    })}
                  </p>
                )}
              </div>
              <div
                className="text-3xl font-bold tabular-nums"
                style={{
                  fontFamily: "var(--font-mono)",
                  color,
                }}
              >
                {pct.toFixed(1)}
                <span className="text-lg opacity-60">%</span>
              </div>
            </div>
          </div>
        );
      })}

      <div
        className="rounded-lg p-4"
        style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p
              className="text-[10px] tracking-[0.15em] uppercase mb-1"
              style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}
            >
              Last Usage
            </p>
            {data.usageInsights.lastUsageAt ? (
              <>
                <p className="text-sm" style={{ color: "var(--text-primary)" }}>
                  {formatDistanceToNow(new Date(data.usageInsights.lastUsageAt), {
                    addSuffix: true,
                  })}
                </p>
                <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                  {new Date(data.usageInsights.lastUsageAt).toLocaleString()} ({data.usageInsights.lastUsageWindow})
                </p>
              </>
            ) : (
              <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
                No usage change detected yet.
              </p>
            )}
          </div>

          <div>
            <p
              className="text-[10px] tracking-[0.15em] uppercase mb-1"
              style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}
            >
              Biggest Spike
            </p>
            {data.usageInsights.largestDelta ? (
              <>
                <p
                  className="text-sm font-semibold"
                  style={{ color: "var(--text-accent)", fontFamily: "var(--font-mono)" }}
                >
                  +{data.usageInsights.largestDelta.delta.toFixed(2)}%
                </p>
                <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                  {new Date(data.usageInsights.largestDelta.at).toLocaleString()} ({data.usageInsights.largestDelta.window})
                </p>
              </>
            ) : (
              <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
                Not enough history to calculate.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
