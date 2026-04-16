"use client";

import { formatDistanceToNow } from "date-fns";
import type { DashboardData } from "@/lib/analysis";

function formatMoney(value: number | null | undefined): string {
  if (value == null) return "---";
  return `$${value.toFixed(2)}`;
}

function formatWhen(value: string | null): string {
  if (!value) return "No activity yet";
  return formatDistanceToNow(new Date(value), { addSuffix: true });
}

function Stat({
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
      className="rounded-lg p-3"
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-subtle)",
      }}
    >
      <p
        className="text-[10px] tracking-[0.15em] uppercase mb-1"
        style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}
      >
        {label}
      </p>
      <p
        className="text-base font-semibold mb-1"
        style={{
          color: accent ? "var(--text-accent)" : "var(--text-primary)",
          fontFamily: "var(--font-mono)",
        }}
      >
        {value}
      </p>
      <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
        {detail}
      </p>
    </div>
  );
}

export function ExtraUsageCard({ data }: { data: DashboardData | null }) {
  const extra = data?.current?.extraUsage;
  const insights = data?.extraUsageInsights;

  if (!extra || !insights) {
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

  return (
    <div className="grid grid-cols-1 gap-3">
      <div
        className="rounded-lg p-4"
        style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <p
          className="text-[10px] tracking-[0.15em] uppercase mb-2"
          style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}
        >
          Current Balance
        </p>
        <p
          className="text-3xl font-bold mb-2"
          style={{ color: "var(--text-accent)", fontFamily: "var(--font-mono)" }}
        >
          {formatMoney(extra.balance)}
        </p>
        <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
          Loaded {formatMoney(extra.monthlyLimit)} | Spent {formatMoney(extra.usedCredits)}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Stat
          label="Top-Ups"
          value={String(insights.topUpCount)}
          detail={insights.lastTopUpAt ? `${formatWhen(insights.lastTopUpAt)} | +${formatMoney(insights.largestTopUp?.amount)}` : "No increases tracked"}
        />
        <Stat
          label="Spend Events"
          value={String(insights.spendEventCount)}
          detail={insights.lastSpendAt ? `${formatWhen(insights.lastSpendAt)} | ${formatMoney(insights.largestSpend?.amount)}` : "No spend tracked"}
        />
        <Stat
          label="Tracked Top-Ups"
          value={formatMoney(insights.totalTopUps)}
          detail="Sum of balance increases"
        />
        <Stat
          label="Tracked Spend"
          value={formatMoney(insights.trackedSpend)}
          detail="Sum of spend changes"
          accent
        />
      </div>
    </div>
  );
}
