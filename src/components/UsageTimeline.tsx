"use client";

import { useState, useMemo } from "react";
import type { DashboardData } from "@/lib/analysis";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { format } from "date-fns";

const COLORS = {
  fiveHour: "#d4a056",
  sevenDay: "#7ba3c9",
  extraCredits: "#c97bb5",
};

type TimeRange = "1d" | "7d" | "all";

const RANGE_CONFIG: Record<TimeRange, { label: string; ms: number | null; tickFormat: string }> = {
  "1d": { label: "24h", ms: 24 * 60 * 60_000, tickFormat: "HH:mm" },
  "7d": { label: "7d", ms: 7 * 24 * 60 * 60_000, tickFormat: "MMM d HH:mm" },
  all: { label: "All", ms: null, tickFormat: "MMM d" },
};

export function UsageTimeline({ data }: { data: DashboardData | null }) {
  const [range, setRange] = useState<TimeRange>("1d");

  const chartData = useMemo(() => {
    if (!data?.timeline.length) return [];

    const now = Date.now();
    const cutoff = RANGE_CONFIG[range].ms ? now - RANGE_CONFIG[range].ms! : 0;

    return data.timeline
      .filter((point) => new Date(point.timestamp).getTime() >= cutoff)
      .map((point) => ({
        time: new Date(point.timestamp).getTime(),
        "5-Hour": point.fiveHourUtilization,
        "7-Day": point.sevenDayUtilization,
        "Extra Credits ($)": point.extraUsageUsedCredits,
      }));
  }, [data, range]);

  if (!data?.timeline.length) {
    return (
      <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
        No timeline data yet. Wait for snapshots to accumulate.
      </p>
    );
  }

  const tickFormat = RANGE_CONFIG[range].tickFormat;

  return (
    <div>
      <div className="flex gap-1 mb-3 justify-end">
        {(Object.keys(RANGE_CONFIG) as TimeRange[]).map((key) => (
          <button
            key={key}
            onClick={() => setRange(key)}
            className="px-3 py-1 rounded text-[10px] tracking-wider uppercase transition-all cursor-pointer"
            style={{
              fontFamily: "var(--font-mono)",
              color: range === key ? "var(--bg-base)" : "var(--text-tertiary)",
              background: range === key ? "var(--accent)" : "transparent",
              border: `1px solid ${range === key ? "var(--accent)" : "var(--border-subtle)"}`,
            }}
          >
            {RANGE_CONFIG[key].label}
          </button>
        ))}
      </div>

      <div className="h-72 -mx-2">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
          <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
            <defs>
              <linearGradient id="grad5h" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={COLORS.fiveHour} stopOpacity={0.25} />
                <stop offset="100%" stopColor={COLORS.fiveHour} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="grad7d" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={COLORS.sevenDay} stopOpacity={0.2} />
                <stop offset="100%" stopColor={COLORS.sevenDay} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradExtra" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={COLORS.extraCredits} stopOpacity={0.2} />
                <stop offset="100%" stopColor={COLORS.extraCredits} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(180, 155, 110, 0.08)"
              vertical={false}
            />
            <XAxis
              dataKey="time"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(ts) => format(new Date(ts), tickFormat)}
              stroke="transparent"
              tick={{ fill: "var(--text-tertiary)", fontFamily: "var(--font-mono)", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              yAxisId="utilization"
              domain={[0, 100]}
              stroke="transparent"
              tick={{ fill: "var(--text-tertiary)", fontFamily: "var(--font-mono)", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${v}%`}
            />
            <YAxis
              yAxisId="credits"
              orientation="right"
              stroke="transparent"
              tick={{ fill: "var(--text-tertiary)", fontFamily: "var(--font-mono)", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `$${v}`}
            />
            <Tooltip
              contentStyle={{
                background: "var(--bg-elevated)",
                border: "1px solid var(--border-default)",
                borderRadius: "8px",
                fontFamily: "var(--font-mono)",
                fontSize: "11px",
              }}
              labelStyle={{ color: "var(--text-tertiary)", marginBottom: "4px" }}
              itemStyle={{ color: "var(--text-primary)", padding: "2px 0" }}
              labelFormatter={(ts) =>
                format(new Date(ts as number), "MMM d, yyyy HH:mm")
              }
              formatter={(value, name) => {
                if (name === "Extra Credits ($)") return [`$${Number(value).toFixed(2)}`];
                return [`${Number(value).toFixed(1)}%`];
              }}
            />
            <Legend
              wrapperStyle={{
                fontFamily: "var(--font-mono)",
                fontSize: "10px",
                color: "var(--text-tertiary)",
              }}
            />
            <Area
              yAxisId="utilization"
              type="monotone"
              dataKey="5-Hour"
              stroke={COLORS.fiveHour}
              fill="url(#grad5h)"
              strokeWidth={2}
              dot={range === "1d" ? {
                r: 2,
                fill: COLORS.fiveHour,
                stroke: "var(--bg-surface)",
                strokeWidth: 1,
              } : false}
              connectNulls
              activeDot={{
                r: 4,
                fill: COLORS.fiveHour,
                stroke: "var(--bg-surface)",
                strokeWidth: 2,
              }}
            />
            <Area
              yAxisId="utilization"
              type="monotone"
              dataKey="7-Day"
              stroke={COLORS.sevenDay}
              fill="url(#grad7d)"
              strokeWidth={2}
              dot={range === "1d" ? {
                r: 2,
                fill: COLORS.sevenDay,
                stroke: "var(--bg-surface)",
                strokeWidth: 1,
              } : false}
              connectNulls
              activeDot={{
                r: 4,
                fill: COLORS.sevenDay,
                stroke: "var(--bg-surface)",
                strokeWidth: 2,
              }}
            />
            <Area
              yAxisId="credits"
              type="monotone"
              dataKey="Extra Credits ($)"
              stroke={COLORS.extraCredits}
              fill="url(#gradExtra)"
              strokeWidth={2}
              dot={range === "1d" ? {
                r: 2,
                fill: COLORS.extraCredits,
                stroke: "var(--bg-surface)",
                strokeWidth: 1,
              } : false}
              connectNulls
              activeDot={{
                r: 4,
                fill: COLORS.extraCredits,
                stroke: "var(--bg-surface)",
                strokeWidth: 2,
              }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
