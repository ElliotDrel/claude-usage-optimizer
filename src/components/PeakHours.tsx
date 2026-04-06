"use client";

import type { DashboardData } from "@/lib/analysis";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

export function PeakHours({ data }: { data: DashboardData | null }) {
  const bars = data?.activity.hourlyBars;
  if (!bars || bars.every((b) => b.totalDelta === 0)) {
    return (
      <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
        No activity data yet.
      </p>
    );
  }

  const maxDelta = Math.max(...bars.map((b) => b.totalDelta));

  const chartData = bars.map((b) => ({
    hour: `${b.hour}`,
    delta: b.totalDelta,
    samples: b.sampleCount,
  }));

  return (
    <div className="h-56 -mx-2">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="rgba(180, 155, 110, 0.08)"
            vertical={false}
          />
          <XAxis
            dataKey="hour"
            stroke="transparent"
            tick={{ fill: "var(--text-tertiary)", fontFamily: "var(--font-mono)", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            stroke="transparent"
            tick={{ fill: "var(--text-tertiary)", fontFamily: "var(--font-mono)", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            contentStyle={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-default)",
              borderRadius: "8px",
              fontFamily: "var(--font-mono)",
              fontSize: "11px",
            }}
            labelStyle={{ color: "var(--text-tertiary)" }}
            itemStyle={{ color: "var(--text-primary)" }}
            formatter={(value) => [`${Number(value).toFixed(1)}`, "Usage delta"]}
            labelFormatter={(hour) => `${hour}:00`}
            cursor={{ fill: "rgba(180, 155, 110, 0.06)" }}
          />
          <Bar dataKey="delta" radius={[3, 3, 0, 0]} maxBarSize={20}>
            {chartData.map((entry, index) => {
              const intensity = maxDelta > 0 ? entry.delta / maxDelta : 0;
              // Lerp from dim amber to bright amber based on intensity
              const opacity = 0.25 + intensity * 0.75;
              return (
                <Cell
                  key={`bar-${index}`}
                  fill={`rgba(212, 160, 86, ${opacity})`}
                />
              );
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
