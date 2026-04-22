"use client";

import { useEffect, useState } from "react";
import type { DashboardData } from "@/lib/analysis";

function getBrowserUTCOffset(): number {
  // Returns -5 for EST, -7 for PDT, etc.
  return new Date().getTimezoneOffset() / -60;
}

function parseUTCOffset(offsetString: string): number | null {
  // Handles both "America/Los_Angeles" (parse via Intl) and direct "-5" format
  if (offsetString.startsWith("-") || offsetString.startsWith("+")) {
    return parseInt(offsetString, 10);
  }
  // For IANA name, compute UTC offset via Intl
  try {
    const ianaOffset = offsetString;
    // Create two dates: one as UTC, one in the target timezone
    const now = new Date();
    const utcString = now.toLocaleString("en-US", { timeZone: "UTC" });
    const tzString = now.toLocaleString("en-US", { timeZone: ianaOffset });

    const utcDate = new Date(utcString);
    const tzDate = new Date(tzString);

    // Difference in hours
    const offsetHours = Math.round((utcDate.getTime() - tzDate.getTime()) / (1000 * 60 * 60));
    return offsetHours;
  } catch {
    return null;
  }
}

export function TimezoneWarningBanner({ data }: { data: DashboardData | null }) {
  const [isVisible, setIsVisible] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const browserOffset = getBrowserUTCOffset();
  const storedOffsetString = data?.scheduleData?.userTimezone ?? "";
  const storedOffset = parseUTCOffset(storedOffsetString);

  useEffect(() => {
    // Check on first mount or when data changes
    if (storedOffset !== null && storedOffset !== browserOffset) {
      // Mismatch detected
      setIsVisible(true);
    }
  }, [storedOffset, browserOffset]);

  if (!isVisible || storedOffset === null || storedOffset === browserOffset) {
    return null;
  }

  const handleUpdate = async () => {
    setIsSaving(true);
    try {
      const response = await fetch("/api/app-meta", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "user_timezone",
          value: String(browserOffset),
        }),
      });
      if (!response.ok) throw new Error("Failed to update timezone");
      setIsVisible(false);
    } catch (err) {
      console.error("Timezone update failed:", err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDismiss = () => {
    setIsVisible(false);
    // Note: dismissed for this session only; will re-appear on page reload if mismatch still exists
  };

  return (
    <div
      className="mb-4 px-4 py-3 rounded-lg flex items-center justify-between gap-4"
      style={{
        background: "var(--warn-dim)",
        border: "1px solid var(--warn)",
        animation: "slide-in 0.3s ease",
      }}
    >
      <div>
        <p className="text-sm font-medium" style={{ color: "var(--warn)" }}>
          Timezone Mismatch
        </p>
        <p className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>
          Your browser is at UTC{browserOffset > 0 ? "+" : ""}{browserOffset}, but the
          scheduler is set to {storedOffsetString}. Update scheduler to match browser?
        </p>
      </div>
      <div className="flex gap-2 shrink-0">
        <button
          onClick={handleDismiss}
          className="px-3 py-1.5 rounded text-xs font-medium"
          style={{
            background: "transparent",
            border: "1px solid var(--warn)",
            color: "var(--warn)",
            cursor: "pointer",
            fontFamily: "var(--font-mono)",
          }}
        >
          Dismiss
        </button>
        <button
          onClick={handleUpdate}
          disabled={isSaving}
          className="px-3 py-1.5 rounded text-xs font-medium"
          style={{
            background: "var(--warn)",
            color: "var(--bg-base)",
            cursor: isSaving ? "not-allowed" : "pointer",
            fontFamily: "var(--font-mono)",
            opacity: isSaving ? 0.6 : 1,
          }}
        >
          {isSaving ? "..." : "Update Scheduler"}
        </button>
      </div>
      <style>{`
        @keyframes slide-in {
          from { transform: translateY(-10px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
