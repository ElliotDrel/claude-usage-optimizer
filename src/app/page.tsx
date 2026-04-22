"use client";

import { useCallback, useEffect, useState } from "react";
import type { DashboardData } from "@/lib/analysis";
import { CollectorHealth } from "@/components/CollectorHealth";
import { UsageCards } from "@/components/UsageCards";
import { UsageTimeline } from "@/components/UsageTimeline";
import { PeakHours } from "@/components/PeakHours";
import { Heatmap } from "@/components/Heatmap";
import { ExtraUsage } from "@/components/ExtraUsage";
import { ExtraUsageCard } from "@/components/ExtraUsageCard";
import { OptimalScheduleCard } from "@/components/OptimalScheduleCard";

export default function DashboardPage() {
  const [data, setData] = useState<(DashboardData & { demoMode?: boolean }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [pollCooldown, setPollCooldown] = useState<number | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard", { cache: "no-store" });
      const json = await res.json();
      setData(json);
      setLastRefresh(new Date());
    } catch (err) {
      console.error("Failed to fetch dashboard data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const handlePoll = async () => {
    setPolling(true);
    try {
      const res = await fetch("/api/poll", { method: "POST" });
      const json = await res.json();
      if (json.status === "cooldown") {
        setPollCooldown(json.retryInSeconds);
        setTimeout(() => setPollCooldown(null), json.retryInSeconds * 1000);
      } else {
        setPollCooldown(null);
      }
      await fetchData();
    } finally {
      setPolling(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-center animate-fade-in">
          <div
            className="w-8 h-8 rounded-full border-2 mx-auto mb-4"
            style={{
              borderColor: "var(--border-default)",
              borderTopColor: "var(--accent)",
              animation: "spin 1s linear infinite",
            }}
          />
          <p
            className="text-sm tracking-wider uppercase"
            style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}
          >
            Initializing
          </p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </main>
    );
  }

  return (
    <main className="max-w-7xl mx-auto px-6 py-8">
      <header className="mb-10 animate-fade-up">
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="flex items-center gap-3 mb-3">
              <div
                className="w-2 h-2 rounded-full"
                style={{
                  backgroundColor: data?.runtime.lastSuccessAt ? "var(--good)" : "var(--text-tertiary)",
                  boxShadow: data?.runtime.lastSuccessAt ? "0 0 8px var(--good)" : "none",
                  animation: data?.runtime.lastSuccessAt ? "pulse-glow 2s ease-in-out infinite" : "none",
                }}
              />
              <span
                className="text-xs tracking-[0.2em] uppercase"
                style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}
              >
                Usage Observatory
              </span>
            </div>
            <h1
              className="text-4xl mb-2"
              style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}
            >
              Claude Tracker
            </h1>
            <p className="text-sm max-w-lg" style={{ color: "var(--text-tertiary)", lineHeight: 1.6 }}>
              Monitoring usage patterns from{" "}
              <code
                className="text-xs px-1.5 py-0.5 rounded"
                style={{
                  fontFamily: "var(--font-mono)",
                  color: "var(--text-accent)",
                  background: "var(--accent-dim)",
                }}
              >
                claude.ai/settings/usage
              </code>
            </p>
          </div>

          <div className="flex flex-col items-end gap-3 shrink-0">
            <button
              onClick={handlePoll}
              disabled={polling || pollCooldown !== null}
              className="group relative px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                fontFamily: "var(--font-mono)",
                color: "var(--bg-base)",
                background: polling || pollCooldown !== null ? "var(--text-tertiary)" : "var(--accent)",
                boxShadow: polling || pollCooldown !== null ? "none" : "0 0 20px rgba(212, 160, 86, 0.2)",
              }}
              onMouseEnter={(e) => {
                if (!polling && !pollCooldown) e.currentTarget.style.boxShadow = "0 0 30px rgba(212, 160, 86, 0.35)";
              }}
              onMouseLeave={(e) => {
                if (!polling && !pollCooldown) e.currentTarget.style.boxShadow = "0 0 20px rgba(212, 160, 86, 0.2)";
              }}
            >
              {polling ? "Polling..." : pollCooldown ? `Wait ${pollCooldown}s` : "Poll Now"}
            </button>
            <StatusPill data={data} />
            {lastRefresh && (
              <span
                className="text-[10px] tracking-wider"
                style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}
              >
                {lastRefresh.toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>

        <div
          className="mt-8 h-px"
          style={{
            background: "linear-gradient(to right, var(--accent), var(--border-subtle), transparent)",
          }}
        />
      </header>

      {data?.demoMode && (
        <div
          className="mb-6 px-4 py-2.5 rounded-lg text-xs tracking-wider uppercase text-center"
          style={{
            fontFamily: "var(--font-mono)",
            color: "var(--accent)",
            background: "var(--accent-dim)",
            border: "1px solid var(--accent)",
            opacity: 0.85,
          }}
        >
          Demo Mode — Displaying simulated data
        </div>
      )}

      <div className="space-y-8">
        <div className="animate-fade-up stagger-0">
          <OptimalScheduleCard data={data} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 animate-fade-up stagger-1">
          <div className="lg:col-span-2">
            <Section title="Collector" label="System Health">
              <CollectorHealth data={data} />
            </Section>
          </div>
          <div className="lg:col-span-2">
            <Section title="Utilization" label="Current">
              <UsageCards data={data} />
            </Section>
          </div>
          <div className="lg:col-span-1">
            <Section title="Extra Usage" label="Balance & Spend">
              <ExtraUsageCard data={data} />
            </Section>
          </div>
        </div>

        <div className="animate-fade-up stagger-2">
          <Section title="Timeline" label="Usage Over Time">
            <UsageTimeline data={data} />
          </Section>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-fade-up stagger-3">
          <Section title="Peak Hours" label="Activity by Hour">
            <PeakHours data={data} />
          </Section>
          <Section title="Heatmap" label="Weekly Pattern">
            <Heatmap data={data} />
          </Section>
        </div>

        <div className="animate-fade-up stagger-4">
          <Section title="Raw API Response" label="All Fields">
            <ExtraUsage data={data} />
          </Section>
        </div>
      </div>

      <footer
        className="mt-12 pt-6 text-center animate-fade-up stagger-5"
        style={{ borderTop: "1px solid var(--border-subtle)" }}
      >
        <p
          className="text-[10px] tracking-[0.3em] uppercase"
          style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}
        >
          Auto-refresh 15s | Adaptive polling
        </p>
      </footer>
    </main>
  );
}

function StatusPill({ data }: { data: DashboardData | null }) {
  if (!data) return null;
  const ok = Boolean(data.runtime.lastSuccessAt);
  const hasError = Boolean(data.runtime.lastError);

  const label = ok ? "Collecting" : hasError ? "Needs Attention" : "Waiting";
  const dotColor = ok ? "var(--good)" : hasError ? "var(--danger)" : "var(--text-tertiary)";
  const bgColor = ok ? "var(--good-dim)" : hasError ? "var(--danger-dim)" : "rgba(122,110,95,0.1)";
  const textColor = ok ? "var(--good)" : hasError ? "var(--danger)" : "var(--text-tertiary)";

  return (
    <span
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs"
      style={{
        background: bgColor,
        color: textColor,
        fontFamily: "var(--font-mono)",
        fontSize: "10px",
        letterSpacing: "0.1em",
        textTransform: "uppercase",
      }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: dotColor }} />
      {label}
    </span>
  );
}

function Section({
  title,
  label,
  children,
}: {
  title: string;
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-xl p-5 h-full"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-subtle)",
      }}
    >
      <div className="flex items-baseline justify-between gap-4 mb-4">
        <h2
          className="text-lg"
          style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}
        >
          {title}
        </h2>
        {label && (
          <span
            className="text-[10px] tracking-[0.15em] uppercase"
            style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}
          >
            {label}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}
