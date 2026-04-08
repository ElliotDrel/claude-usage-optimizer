"use client";

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
};

export function UsageTimeline({ data }: { data: DashboardData | null }) {
  if (!data?.timeline.length) {
    return (
      <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
        No timeline data yet. Wait for snapshots to accumulate.
      </p>
    );
  }

  const chartData = data.timeline.map((point) => ({
    time: new Date(point.timestamp).getTime(),
    "5-Hour": point.fiveHourUtilization,
    "7-Day": point.sevenDayUtilization,
  }));

  return (
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
            tickFormatter={(ts) => format(new Date(ts), "MMM d HH:mm")}
            stroke="transparent"
            tick={{ fill: "var(--text-tertiary)", fontFamily: "var(--font-mono)", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            domain={[0, 100]}
            stroke="transparent"
            tick={{ fill: "var(--text-tertiary)", fontFamily: "var(--font-mono)", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${v}%`}
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
            formatter={(value) => [`${Number(value).toFixed(1)}%`]}
          />
          <Legend
            wrapperStyle={{
              fontFamily: "var(--font-mono)",
              fontSize: "10px",
              color: "var(--text-tertiary)",
            }}
          />
          <Area
            type="monotone"
            dataKey="5-Hour"
            stroke={COLORS.fiveHour}
            fill="url(#grad5h)"
            strokeWidth={2}
            dot={{
              r: 2,
              fill: COLORS.fiveHour,
              stroke: "var(--bg-surface)",
              strokeWidth: 1,
            }}
            connectNulls
            activeDot={{
              r: 4,
              fill: COLORS.fiveHour,
              stroke: "var(--bg-surface)",
              strokeWidth: 2,
            }}
          />
          <Area
            type="monotone"
            dataKey="7-Day"
            stroke={COLORS.sevenDay}
            fill="url(#grad7d)"
            strokeWidth={2}
            dot={{
              r: 2,
              fill: COLORS.sevenDay,
              stroke: "var(--bg-surface)",
              strokeWidth: 1,
            }}
            connectNulls
            activeDot={{
              r: 4,
              fill: COLORS.sevenDay,
              stroke: "var(--bg-surface)",
              strokeWidth: 2,
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
