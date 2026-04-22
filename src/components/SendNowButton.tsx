"use client";

import { useState } from "react";

export function SendNowButton({ onRefetch }: { onRefetch?: () => Promise<void> }) {
  const [isLoading, setIsLoading] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const handleClick = async () => {
    setIsLoading(true);
    setLastError(null);
    try {
      const response = await fetch("/api/send-now", { method: "POST" });
      if (!response.ok) throw new Error("Send failed");
      // Immediately refetch dashboard data to show new send_log row
      if (onRefetch) await onRefetch();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setLastError(msg);
      console.error("Send failed:", err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <button
        onClick={handleClick}
        disabled={isLoading}
        className="w-full px-4 py-3 rounded-lg font-medium transition-all"
        style={{
          background: isLoading ? "var(--text-tertiary)" : "var(--accent)",
          color: isLoading ? "var(--text-secondary)" : "var(--bg-base)",
          cursor: isLoading ? "not-allowed" : "pointer",
          fontFamily: "var(--font-mono)",
          opacity: isLoading ? 0.6 : 1,
        }}
      >
        {isLoading ? "Sending..." : "Send Now"}
      </button>
      {lastError && (
        <p className="text-xs px-3 py-2 rounded" style={{ color: "var(--danger)" }}>
          Error: {lastError}
        </p>
      )}
    </div>
  );
}
