"use client";

import { useEffect, useState } from "react";
import type { DashboardData } from "@/lib/analysis";

/**
 * getBrowserIANATimezone — returns the browser's IANA timezone name.
 * DST-aware: Intl resolves the canonical name, so "America/New_York" is
 * returned regardless of whether the browser is currently in EST or EDT.
 */
function getBrowserIANATimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * isRawNumericOffset — returns true if the stored value looks like a raw
 * numeric UTC offset (e.g. "+5", "-7", "5") rather than an IANA name.
 * These were stored by a previous version of the banner; we treat them as
 * a mismatch so the user is prompted to overwrite with a valid IANA name.
 */
function isRawNumericOffset(value: string): boolean {
  return /^[+-]?\d+(\.\d+)?$/.test(value.trim());
}

export function TimezoneWarningBanner({ data }: { data: DashboardData | null }) {
  const [isVisible, setIsVisible] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const browserTimezone = getBrowserIANATimezone();
  const storedTimezone = data?.scheduleData?.userTimezone ?? "";

  useEffect(() => {
    // Treat absent or raw numeric stored values as a mismatch; prompt user
    // to overwrite with the browser's IANA timezone name (CR-01, WR-01).
    if (!storedTimezone || isRawNumericOffset(storedTimezone)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsVisible(true);
      return;
    }
    // Compare IANA names directly — DST-safe, no offset arithmetic needed.
    if (storedTimezone !== browserTimezone) {
      setIsVisible(true);
    }
  }, [storedTimezone, browserTimezone]);

  if (!isVisible) {
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
          // Store the IANA timezone name, not a raw numeric offset (CR-01)
          value: browserTimezone,
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

  const displayStored = storedTimezone && !isRawNumericOffset(storedTimezone)
    ? storedTimezone
    : storedTimezone || "(not set)";

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
          Your browser timezone is <strong>{browserTimezone}</strong>, but the
          scheduler is set to <strong>{displayStored}</strong>. Update scheduler to match browser?
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
