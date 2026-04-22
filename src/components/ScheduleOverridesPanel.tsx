"use client";

import { useState, useCallback } from "react";
import type { DashboardData } from "@/lib/analysis";

/**
 * validateOverrideField — client-side validation for schedule override fields.
 * Returns an error string, or null if the value is valid (WR-05).
 */
function validateOverrideField(key: string, value: string): string | null {
  switch (key) {
    case "schedule_override_start_time":
      // Empty string is valid — means "use peak detection"
      if (value === "") return null;
      return /^\d{2}:\d{2}$/.test(value) ? null : "Format: HH:MM (e.g. 09:00)";
    case "peak_window_hours": {
      const n = parseInt(value, 10);
      return Number.isFinite(n) && n >= 3 && n <= 6 ? null : "Must be 3–6";
    }
    case "anchor_offset_minutes": {
      const m = parseInt(value, 10);
      return Number.isFinite(m) && m >= 0 && m <= 15 ? null : "Must be 0–15";
    }
    case "default_seed_time":
      return /^\d{2}:\d{2}$/.test(value) ? null : "Format: HH:MM (e.g. 05:05)";
    default:
      return null;
  }
}

interface OverrideFieldProps {
  label: string;
  fieldKey: string;
  value: string;
  hint?: string;
  onChange: (newValue: string) => Promise<void>;
}

function OverrideField({ label, fieldKey, value, hint, onChange }: OverrideFieldProps) {
  const [localValue, setLocalValue] = useState(value);
  const [isSaving, setIsSaving] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setLocalValue(newValue);
    // Clear stale error as user types
    setValidationError(null);
  };

  const handleBlur = useCallback(async () => {
    if (localValue === value) return; // No change

    // WR-05: Client-side validation before sending to server
    const error = validateOverrideField(fieldKey, localValue);
    if (error) {
      setValidationError(error);
      return; // Do not save invalid input
    }

    setIsSaving(true);
    try {
      await onChange(localValue);
      setShowSaved(true);
      setTimeout(() => setShowSaved(false), 2000);
    } catch (err) {
      console.error(`Failed to save ${fieldKey}:`, err);
      setLocalValue(value); // Revert on error
    } finally {
      setIsSaving(false);
    }
  }, [localValue, value, fieldKey, onChange]);

  return (
    <div className="space-y-2 pb-3 border-b" style={{ borderColor: "var(--border-subtle)" }}>
      <label
        htmlFor={`override-${fieldKey}`}
        className="block text-sm"
        style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)" }}
      >
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={`override-${fieldKey}`}
          type="text"
          value={localValue}
          onChange={handleChange}
          onBlur={handleBlur}
          disabled={isSaving}
          className="flex-1 px-3 py-2 rounded text-sm"
          style={{
            background: "var(--bg-elevated)",
            border: `1px solid ${validationError ? "var(--danger)" : "var(--border-subtle)"}`,
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
      {validationError && (
        <p className="text-[10px]" style={{ color: "var(--danger)" }}>
          {validationError}
        </p>
      )}
      {hint && !validationError && (
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
            fieldKey="schedule_override_start_time"
            value={overrideStartTime}
            hint="Format: HH:MM (leave empty to use peak detection)"
            onChange={(v) => handleSaveField("schedule_override_start_time", v)}
          />
          <OverrideField
            label="Peak Window Hours"
            fieldKey="peak_window_hours"
            value={peakWindowHours}
            hint="3–6 hours"
            onChange={(v) => handleSaveField("peak_window_hours", v)}
          />
          <OverrideField
            label="Anchor Offset Minutes"
            fieldKey="anchor_offset_minutes"
            value={anchorOffsetMinutes}
            hint="0–15 minutes"
            onChange={(v) => handleSaveField("anchor_offset_minutes", v)}
          />
          <OverrideField
            label="Default Seed Time"
            fieldKey="default_seed_time"
            value={defaultSeedTime}
            hint="Fallback when no peak data exists. Format: HH:MM"
            onChange={(v) => handleSaveField("default_seed_time", v)}
          />
          <OverrideField
            label="User Timezone"
            fieldKey="user_timezone"
            value={userTimezone}
            hint="IANA timezone name (e.g., America/Los_Angeles)"
            onChange={(v) => handleSaveField("user_timezone", v)}
          />
        </div>
      )}
    </section>
  );
}
