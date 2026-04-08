"use client";

import type { DashboardData } from "@/lib/analysis";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function intensityToColor(intensity: number): string {
  // From deep charcoal through warm amber stages
  if (intensity === 0) return "var(--bg-elevated)";
  if (intensity < 0.25) return "rgba(212, 160, 86, 0.12)";
  if (intensity < 0.5) return "rgba(212, 160, 86, 0.28)";
  if (intensity < 0.75) return "rgba(212, 160, 86, 0.5)";
  return "rgba(212, 160, 86, 0.75)";
}

export function Heatmap({ data }: { data: DashboardData | null }) {
  const cells = data?.activity.heatmap;
  if (!cells) {
    return (
      <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
        No data available.
      </p>
    );
  }

  const maxDelta = Math.max(0.01, ...cells.map((c) => c.totalDelta));

  return (
    <div className="overflow-x-auto">
      <div
        className="grid gap-[3px]"
        style={{
          gridTemplateColumns: `40px repeat(24, minmax(14px, 1fr))`,
        }}
      >
        {/* Hour labels header */}
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div
            key={`h-${h}`}
            className="text-center"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "9px",
              color: "var(--text-tertiary)",
            }}
          >
            {h % 3 === 0 ? h : ""}
          </div>
        ))}

        {/* Day rows */}
        {DAY_LABELS.map((day, dayIdx) => (
          <div key={`row-${dayIdx}`} className="contents">
            <div
              className="flex items-center"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "10px",
                color: "var(--text-tertiary)",
                letterSpacing: "0.05em",
              }}
            >
              {day}
            </div>
            {Array.from({ length: 24 }, (_, hour) => {
              const cell = cells[dayIdx * 24 + hour];
              const intensity = cell ? cell.totalDelta / maxDelta : 0;
              return (
                <div
                  key={`cell-${dayIdx}-${hour}`}
                  className="rounded-[3px] aspect-square min-h-[14px] transition-all duration-200 cursor-default"
                  style={{
                    backgroundColor: intensityToColor(intensity),
                    border: "1px solid var(--border-subtle)",
                  }}
                  title={`${day} ${hour}:00 — usage increase: +${cell?.totalDelta.toFixed(2) ?? 0}%`}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--accent)";
                    e.currentTarget.style.transform = "scale(1.15)";
                    e.currentTarget.style.zIndex = "10";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--border-subtle)";
                    e.currentTarget.style.transform = "scale(1)";
                    e.currentTarget.style.zIndex = "auto";
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div
        className="flex items-center justify-end gap-2 mt-3 pt-3"
        style={{ borderTop: "1px solid var(--border-subtle)" }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "9px",
            color: "var(--text-tertiary)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          Less
        </span>
        {[0, 0.25, 0.5, 0.75, 1].map((level) => (
          <div
            key={level}
            className="w-3 h-3 rounded-[2px]"
            style={{
              backgroundColor: intensityToColor(level),
              border: "1px solid var(--border-subtle)",
            }}
          />
        ))}
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "9px",
            color: "var(--text-tertiary)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          More
        </span>
      </div>
    </div>
  );
}
