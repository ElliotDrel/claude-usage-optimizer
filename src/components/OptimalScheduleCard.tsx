"use client";

import { useEffect, useState } from "react";
import type { DashboardData } from "@/lib/analysis";
import type { FireTime } from "@/lib/schedule";

function formatHHMM(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function getNextFireIndex(fires: FireTime[], now: number): number {
  const nowDate = new Date(now);
  const nowHours = nowDate.getHours();
  const nowMinutes = nowDate.getMinutes();
  const nowTotalMinutes = nowHours * 60 + nowMinutes;

  for (let i = 0; i < fires.length; i++) {
    const fireTotalMinutes = fires[i].hour * 60 + fires[i].minute;
    if (fireTotalMinutes >= nowTotalMinutes) {
      return i;
    }
  }
  // All fires are in the past today; next is first fire tomorrow
  return 0;
}

function FireTimeRow({
  fire,
  isAnchor,
  isNextFire,
  now,
}: {
  fire: FireTime;
  isAnchor: boolean;
  isNextFire: boolean;
  now: number;
}) {
  return (
    <div
      className="rounded-lg p-3.5 flex items-center justify-between"
      style={{
        background: isNextFire ? "var(--accent-dim)" : "var(--bg-elevated)",
        border: `1px solid ${isNextFire ? "var(--accent)" : "var(--border-subtle)"}`,
      }}
    >
      <div>
        <p
          className="text-sm font-mono"
          style={{
            color: isNextFire ? "var(--accent)" : "var(--text-primary)",
            fontWeight: isNextFire ? "600" : "400",
          }}
        >
          {formatHHMM(fire.hour, fire.minute)}
        </p>
        <p className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
          {isAnchor ? "🎯 Anchor" : `+${fire.jitterMinutes}m jitter`}
        </p>
      </div>
      <span
        className="text-xs px-2 py-1 rounded"
        style={{
          background: isNextFire ? "var(--accent)" : "var(--good-dim)",
          color: isNextFire ? "var(--bg-base)" : "var(--good)",
          fontFamily: "var(--font-mono)",
        }}
      >
        {isNextFire ? "Next" : "Pending"}
      </span>
    </div>
  );
}

function NextFireCountdown({ fires, now }: { fires: FireTime[]; now: number }) {
  const nextFire = fires[getNextFireIndex(fires, now)];
  if (!nextFire) return null;

  const nextFireTime = new Date();
  nextFireTime.setHours(nextFire.hour, nextFire.minute, 0, 0);
  if (nextFireTime.getTime() < now) {
    nextFireTime.setDate(nextFireTime.getDate() + 1);
  }

  const countdownMs = Math.max(0, nextFireTime.getTime() - now);
  const countdownSeconds = Math.ceil(countdownMs / 1000);
  const hours = Math.floor(countdownSeconds / 3600);
  const minutes = Math.floor((countdownSeconds % 3600) / 60);
  const seconds = countdownSeconds % 60;

  let countdownText: string;
  if (hours > 0) {
    countdownText = `${hours}h ${minutes}m ${seconds}s`;
  } else if (minutes > 0) {
    countdownText = `${minutes}m ${seconds}s`;
  } else {
    countdownText = `${seconds}s`;
  }

  return (
    <div
      className="mt-4 p-4 rounded-lg text-center"
      style={{
        background: "var(--good-dim)",
        border: "1px solid var(--good)",
      }}
    >
      <p className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
        Next fire in
      </p>
      <p
        className="text-2xl font-mono"
        style={{ color: "var(--good)", fontWeight: "600" }}
      >
        {countdownText}
      </p>
    </div>
  );
}

export function OptimalScheduleCard({ data }: { data: DashboardData | null }) {
  const [now, setNow] = useState(() => Date.now());
  const [activeTab, setActiveTab] = useState<"today" | "tomorrow">("today");

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  if (!data?.scheduleData) {
    return (
      <div style={{ padding: "20px", color: "var(--text-tertiary)" }}>
        No schedule data available.
      </div>
    );
  }

  const { peakBlock, scheduleFires, tomorrowFires, scheduleGeneratedAt, isPaused } =
    data.scheduleData;

  return (
    <section
      className="rounded-xl p-5"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-subtle)",
      }}
    >
      {/* Header: Peak Block + Tabs */}
      <div className="flex items-start justify-between gap-6 mb-6">
        <div>
          <h2
            className="text-lg"
            style={{
              fontFamily: "var(--font-display)",
              color: "var(--text-primary)",
            }}
          >
            Optimal Schedule
          </h2>
          {peakBlock && (
            <p className="text-sm mt-2" style={{ color: "var(--text-tertiary)" }}>
              Peak:{" "}
              <span style={{ color: "var(--accent)", fontWeight: "600" }}>
                {String(peakBlock.startHour).padStart(2, "0")}:00 –{" "}
                {String(peakBlock.endHour).padStart(2, "0")}:00
              </span>
              , Midpoint{" "}
              <span style={{ color: "var(--accent)", fontWeight: "600" }}>
                {String(peakBlock.midpoint).padStart(2, "0")}:00
              </span>
            </p>
          )}
        </div>

        {/* Tab buttons */}
        <div className="flex gap-2">
          {["today", "tomorrow"].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as "today" | "tomorrow")}
              className="px-3 py-1.5 rounded text-xs font-medium uppercase tracking-wider transition-colors"
              style={{
                background:
                  activeTab === tab ? "var(--accent)" : "transparent",
                color:
                  activeTab === tab ? "var(--bg-base)" : "var(--text-secondary)",
                border:
                  activeTab === tab
                    ? "1px solid var(--accent)"
                    : "1px solid var(--border-subtle)",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                if (activeTab !== tab) {
                  e.currentTarget.style.borderColor = "var(--border-default)";
                }
              }}
              onMouseLeave={(e) => {
                if (activeTab !== tab) {
                  e.currentTarget.style.borderColor = "var(--border-subtle)";
                }
              }}
            >
              {tab === "today" ? "Today" : "Tomorrow"}
            </button>
          ))}
        </div>
      </div>

      {/* Paused banner */}
      {isPaused && (
        <div
          className="mb-4 px-3 py-2 rounded text-xs"
          style={{
            background: "var(--warn-dim)",
            color: "var(--warn)",
            border: "1px solid var(--warn)",
            fontFamily: "var(--font-mono)",
          }}
        >
          🔒 Paused — Scheduled fires are skipped
        </div>
      )}

      {/* Tab content: Today's fires or Tomorrow's fires */}
      <div className="space-y-3">
        {(activeTab === "today" ? scheduleFires : tomorrowFires).map((fire, idx) => (
          <FireTimeRow
            key={`${activeTab}-${idx}`}
            fire={fire}
            isAnchor={fire.isAnchor}
            isNextFire={activeTab === "today" && idx === getNextFireIndex(scheduleFires, now)}
            now={now}
          />
        ))}
      </div>

      {/* Next fire countdown (only show for Today tab) */}
      {activeTab === "today" && (
        <NextFireCountdown fires={scheduleFires} now={now} />
      )}

      {/* Schedule generation timestamp */}
      <div className="mt-6 pt-4 border-t" style={{ borderColor: "var(--border-subtle)" }}>
        <p className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
          Schedule{" "}
          {scheduleGeneratedAt
            ? `updated ${new Date(scheduleGeneratedAt).toLocaleTimeString()}`
            : "not yet computed"}
        </p>
      </div>
    </section>
  );
}
