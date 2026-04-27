"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface FormData {
  oauthToken: string;
  usageAuthMode: "cookie" | "bearer";
  usageAuthValue: string;
  userTimezone: string;
  gcsBucket: string;
}

export default function SetupPage() {
  const router = useRouter();

  const [formData, setFormData] = useState<FormData>({
    oauthToken: "",
    usageAuthMode: "cookie",
    usageAuthValue: "",
    userTimezone: "America/Los_Angeles",
    gcsBucket: "",
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const body = {
      oauthToken: formData.oauthToken,
      usageAuth: {
        mode: formData.usageAuthMode,
        value: formData.usageAuthValue,
      },
      userTimezone: formData.userTimezone || undefined,
      gcsBucket: formData.gcsBucket || undefined,
    };

    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        // Give the service a moment to restart before navigating
        await new Promise((resolve) => setTimeout(resolve, 1000));
        router.push("/");
      } else {
        const data = await res.json();
        setError(
          typeof data?.error === "string"
            ? data.error
            : "Setup failed. Please check your credentials and try again."
        );
        setLoading(false);
      }
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  const inputClass =
    "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors";

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Welcome</h1>
          <p className="text-gray-600 text-sm leading-relaxed">
            Complete your setup to start monitoring your Claude usage and
            optimizing your daily send schedule.
          </p>
        </div>

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Field 1: OAuth Token */}
          <div>
            <label
              htmlFor="oauthToken"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Claude Code OAuth Token
              <span className="text-red-500 ml-1">*</span>
            </label>
            <input
              id="oauthToken"
              name="oauthToken"
              type="password"
              required
              placeholder="sk-ant-ocp-..."
              value={formData.oauthToken}
              onChange={handleChange}
              className={inputClass}
              autoComplete="off"
            />
            <p className="mt-1 text-xs text-gray-500">
              Found in your Claude Code credentials file or OAuth flow.
            </p>
          </div>

          {/* Field 2: Usage Auth Mode */}
          <div>
            <label
              htmlFor="usageAuthMode"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Usage Auth Type
              <span className="text-red-500 ml-1">*</span>
            </label>
            <select
              id="usageAuthMode"
              name="usageAuthMode"
              value={formData.usageAuthMode}
              onChange={handleChange}
              className={inputClass}
            >
              <option value="cookie">Session Cookie</option>
              <option value="bearer">Bearer Token</option>
            </select>
            <p className="mt-1 text-xs text-gray-500">
              How the app authenticates to the Claude usage API.
            </p>
          </div>

          {/* Field 3: Usage Auth Value */}
          <div>
            <label
              htmlFor="usageAuthValue"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Usage Auth Value
              <span className="text-red-500 ml-1">*</span>
            </label>
            <input
              id="usageAuthValue"
              name="usageAuthValue"
              type="password"
              required
              placeholder={
                formData.usageAuthMode === "cookie"
                  ? "Paste your session cookie value"
                  : "Paste your bearer token"
              }
              value={formData.usageAuthValue}
              onChange={handleChange}
              className={inputClass}
              autoComplete="off"
            />
          </div>

          {/* Field 4: Timezone */}
          <div>
            <label
              htmlFor="userTimezone"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Timezone (IANA)
            </label>
            <input
              id="userTimezone"
              name="userTimezone"
              type="text"
              placeholder="America/Los_Angeles"
              value={formData.userTimezone}
              onChange={handleChange}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-gray-500">
              Used to align send windows with your local peak hours. Defaults
              to America/Los_Angeles.
            </p>
          </div>

          {/* Field 5: GCS Bucket (optional) */}
          <div>
            <label
              htmlFor="gcsBucket"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              GCS Backup Bucket{" "}
              <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              id="gcsBucket"
              name="gcsBucket"
              type="text"
              placeholder="my-backup-bucket"
              value={formData.gcsBucket}
              onChange={handleChange}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-gray-500">
              Google Cloud Storage bucket for nightly database backups. Leave
              empty to skip backups.
            </p>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full mt-6 bg-blue-600 text-white py-2.5 px-4 rounded-lg font-medium text-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
          >
            {loading ? "Setting up..." : "Complete Setup"}
          </button>
        </form>
      </div>
    </div>
  );
}
