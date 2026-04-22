"use client";

import { useState, useCallback } from "react";
import type { DashboardData } from "@/lib/analysis";

interface OverrideFieldProps {
  label: string;
  key: string;
  value: string;
  hint?: string;
  onChange: (newValue: string) => Promise<void>;
}

function OverrideField({ label, key, value, hint, onChange }: OverrideFieldProps) {
  const [localValue, setLocalValue] = useState(value);
  const [isSaving, setIsSaving] = useState(false);
  const [showSaved, setShowSaved] = useState(false);

  const handleBlur = useCallback(async () => {
    if (localValue === value) return; // No change
    setIsSaving(true);
    try {
      await onChange(localValue);
      setShowSaved(true);
      setTimeout(() => setShowSaved(false), 2000);
    } catch (err) {
      console.error(`Failed to save ${key}:`, err);
      setLocalValue(value); // Revert on error
    } finally {
      setIsSaving(false);
    }
  }, [localValue, value, key, onChange]);

  return (
    <div className="space-y-2 pb-3 border-b" style={{ borderColor: "var(--border-subtle)" }}>
      <label
        htmlFor={`override-${key}`}
        className="block text-sm"
        style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)" }}
      >
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={`override-${key}`}
          type="text"
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={handleBlur}
          disabled={isSaving}
          className="flex-1 px-3 py-2 rounded text-sm"
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-subtle)",
            color: "var(--text-primary)",
            fontFamily: "var(--font-mono)",
          }}
        />
        {showSaved && (
          <span className="text-xs" style={{ color: "var(--good)" }}>
            ✓ Saved
          </span>
        )}
      </div>
      {hint && (
        <p className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
          {hint}
        </p>
      )}
    </div>
  );
}

export function ScheduleOverridesPanel({
  data,
  onRefetch,
}: {
  data: DashboardData | null;
  onRefetch?: () => Promise<void>;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!data?.scheduleData) return null;

  const handleSaveField = useCallback(
    async (key: string, value: string) => {
      const response = await fetch("/api/app-meta", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
      if (!response.ok) throw new Error("Failed to save");
      if (onRefetch) await onRefetch();
    },
    [onRefetch]
  );

  // Extract current values from data (these come from app_meta, passed via DashboardData)
  const overrideStartTime = data.scheduleData?.overrideStartTime ?? "";
  const peakWindowHours = data.scheduleData?.peakWindowHours ?? "4";
  const anchorOffsetMinutes = data.scheduleData?.anchorOffsetMinutes ?? "5";
  const defaultSeedTime = data.scheduleData?.defaultSeedTime ?? "05:05";
  const userTimezone = data.scheduleData?.userTimezone ?? "America/Los_Angeles";

  return (
    <section
      className="rounded-xl p-5"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-subtle)",
      }}
    >
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full text-left flex items-center justify-between mb-4 py-2"
        style={{
          background: "transparent",
          cursor: "pointer",
          color: "var(--text-primary)",
          fontFamily: "var(--font-display)",
          fontSize: "1.125rem",
        }}
      >
        <span>Overrides</span>
        <span style={{ fontSize: "0.75rem" }}>
          {isExpanded ? "▼" : "▶"}
        </span>
      </button>

      {isExpanded && (
        <div className="space-y-4">
          <OverrideField
            label="Override Start Time"
            key="schedule_override_start_time"
            value={overrideStartTime}
            hint="Format: HH:MM (leave empty to use peak detection)"
            onChange={(v) => handleSaveField("schedule_override_start_time", v)}
          />
          <OverrideField
            label="Peak Window Hours"
            key="peak_window_hours"
            value={peakWindowHours}
            hint="3–6 hours"
            onChange={(v) => handleSaveField("peak_window_hours", v)}
          />
          <OverrideField
            label="Anchor Offset Minutes"
            key="anchor_offset_minutes"
            value={anchorOffsetMinutes}
            hint="0–15 minutes"
            onChange={(v) => handleSaveField("anchor_offset_minutes", v)}
          />
          <OverrideField
            label="Default Seed Time"
            key="default_seed_time"
            value={defaultSeedTime}
            hint="Fallback when no peak data exists. Format: HH:MM"
            onChange={(v) => handleSaveField("default_seed_time", v)}
          />
          <OverrideField
            label="User Timezone"
            key="user_timezone"
            value={userTimezone}
            hint="IANA timezone name (e.g., America/Los_Angeles)"
            onChange={(v) => handleSaveField("user_timezone", v)}
          />
        </div>
      )}
    </section>
  );
}
