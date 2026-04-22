"use client";

import { useState } from "react";
import type { DashboardData } from "@/lib/analysis";

export function PauseToggle({
  data,
  onRefetch,
}: {
  data: DashboardData | null;
  onRefetch?: () => Promise<void>;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [showConfirmPause, setShowConfirmPause] = useState(false);

  const isPaused = data?.scheduleData?.isPaused ?? false;

  const handleToggle = async () => {
    if (!isPaused) {
      // Pausing — show confirmation dialog
      setShowConfirmPause(true);
      return;
    }
    // Unpausing — no confirmation needed
    await doTogglePause(false);
  };

  const doTogglePause = async (pause: boolean) => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/app-meta", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "paused", value: pause ? "true" : "false" }),
      });
      if (!response.ok) throw new Error("Failed to toggle pause");
      if (onRefetch) await onRefetch();
      setShowConfirmPause(false);
    } catch (err) {
      console.error("Pause toggle failed:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const bgColor = isPaused ? "var(--warn-dim)" : "var(--bg-elevated)";
  const borderColor = isPaused ? "var(--warn)" : "var(--border-subtle)";
  const textColor = isPaused ? "var(--warn)" : "var(--text-primary)";

  return (
    <>
      <div
        className="rounded-lg p-4 flex items-center justify-between"
        style={{
          background: bgColor,
          border: `1px solid ${borderColor}`,
        }}
      >
        <div>
          <p style={{ color: textColor, fontWeight: "600" }}>
            {isPaused ? "🔒 Paused" : "▶️ Active"}
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>
            {isPaused
              ? "Scheduler is paused — no automatic sends until resumed"
              : "Scheduler is running — automatic sends enabled"}
          </p>
        </div>
        <button
          onClick={handleToggle}
          disabled={isLoading}
          className="px-4 py-2 rounded font-medium text-sm"
          style={{
            background: isPaused ? "var(--warn)" : "transparent",
            color: isPaused ? "var(--bg-base)" : "var(--text-secondary)",
            border: isPaused ? "1px solid var(--warn)" : "1px solid var(--border-subtle)",
            cursor: isLoading ? "not-allowed" : "pointer",
            fontFamily: "var(--font-mono)",
            opacity: isLoading ? 0.6 : 1,
          }}
        >
          {isLoading ? "..." : isPaused ? "Resume" : "Pause"}
        </button>
      </div>

      {/* Confirmation dialog (simple inline version) */}
      {showConfirmPause && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          style={{ animation: "fade-in 0.2s ease" }}
        >
          <div
            className="rounded-lg p-6 max-w-md shadow-lg"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <h3
              className="text-lg font-semibold mb-2"
              style={{ color: "var(--text-primary)" }}
            >
              Pause automatic sending?
            </h3>
            <p className="text-sm mb-4" style={{ color: "var(--text-tertiary)" }}>
              Scheduled fires will be skipped until you resume.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirmPause(false)}
                className="flex-1 px-4 py-2 rounded font-medium"
                style={{
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border-subtle)",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => doTogglePause(true)}
                disabled={isLoading}
                className="flex-1 px-4 py-2 rounded font-medium"
                style={{
                  background: "var(--danger)",
                  color: "var(--bg-base)",
                  cursor: isLoading ? "not-allowed" : "pointer",
                  opacity: isLoading ? 0.6 : 1,
                  fontFamily: "var(--font-mono)",
                }}
              >
                {isLoading ? "..." : "Pause"}
              </button>
            </div>
          </div>
          <style>{`
            @keyframes fade-in {
              from { opacity: 0; }
              to { opacity: 1; }
            }
          `}</style>
        </div>
      )}
    </>
  );
}
