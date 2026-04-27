import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getConfig } from "@/lib/config";
import { setAppMeta } from "@/lib/db";
import { execFileNoThrow } from "@/utils/execFileNoThrow";

export const dynamic = "force-dynamic";

interface UsageAuth {
  mode: "cookie" | "bearer";
  value: string;
}

interface SetupBody {
  oauthToken: unknown;
  usageAuth: unknown;
  userTimezone: unknown;
  gcsBucket: unknown;
}

export async function POST(request: Request): Promise<NextResponse> {
  let stagingPath: string | null = null;

  try {
    const body = (await request.json()) as SetupBody;

    const { oauthToken, usageAuth, userTimezone, gcsBucket } = body;

    // Input validation
    if (!oauthToken || typeof oauthToken !== "string" || !oauthToken.trim()) {
      return NextResponse.json(
        { error: "OAuth token is required" },
        { status: 400 }
      );
    }

    const auth = usageAuth as Partial<UsageAuth> | undefined;

    if (!auth?.value || typeof auth.value !== "string" || !auth.value.trim()) {
      return NextResponse.json(
        { error: "Usage auth is required" },
        { status: 400 }
      );
    }

    if (auth.mode !== "cookie" && auth.mode !== "bearer") {
      return NextResponse.json(
        { error: "Invalid auth mode" },
        { status: 400 }
      );
    }

    // CR-01: Reject values containing newlines — they would inject attacker-controlled
    // lines into /etc/claude-sender.env when the privileged helper writes the file.
    const hasDangerousChars = (v: string) => /[\r\n\0]/.test(v);
    if (
      hasDangerousChars(oauthToken) ||
      hasDangerousChars(auth.value) ||
      (typeof userTimezone === "string" && hasDangerousChars(userTimezone)) ||
      (typeof gcsBucket === "string" && hasDangerousChars(gcsBucket))
    ) {
      return NextResponse.json(
        { error: "Invalid characters in input" },
        { status: 400 }
      );
    }

    const timezone =
      typeof userTimezone === "string" && userTimezone.trim()
        ? userTimezone.trim()
        : "America/Los_Angeles";

    const bucket =
      typeof gcsBucket === "string" && gcsBucket.trim()
        ? gcsBucket.trim()
        : null;

    // Build env file content — secrets stay in file, never passed as CLI args
    const envLines: string[] = [
      `CLAUDE_CODE_OAUTH_TOKEN=${oauthToken.trim()}`,
      auth.mode === "cookie"
        ? `CLAUDE_SESSION_COOKIE=${auth.value.trim()}`
        : `CLAUDE_BEARER_TOKEN=${auth.value.trim()}`,
      `user_timezone=${timezone}`,
    ];

    if (bucket) {
      envLines.push(`GCS_BACKUP_BUCKET=${bucket}`);
    }

    const envContent = envLines.join("\n");

    // Write staging file (mode 640 — not world-readable; D-06)
    const config = getConfig();
    stagingPath = path.join(config.dataDir, ".env-staging");

    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(stagingPath, envContent, { mode: 0o640 });
    // Ensure mode is set even if file pre-existed (CR WR-02)
    fs.chmodSync(stagingPath, 0o640);

    // CR-02: Mark setup complete BEFORE invoking the helper. The helper restarts
    // the service (systemctl restart), which sends SIGTERM to this very process.
    // If we wrote the flag after the sudo call, the flag write could be killed
    // mid-execution — leaving the user stuck in an infinite setup-redirect loop.
    // On helper failure we roll back the flag below.
    setAppMeta(config, "setup_complete", "true");

    // Invoke sudo helper via execFileNoThrow (safe — no shell, no args, D-07)
    // All config comes from the staging file; no secrets in CLI arguments (T-07-01)
    const result = await execFileNoThrow(
      "sudo",
      ["/opt/claude-usage-optimizer/scripts/write-env.sh"],
      {
        timeout: 10_000,
        cwd: "/tmp", // Neutral cwd — prevents CLAUDE.md context leakage
      }
    );

    if (result.status !== 0) {
      // Roll back the flag so the user can retry setup
      try {
        setAppMeta(config, "setup_complete", "false");
      } catch {
        // Best-effort rollback
      }
      // Clean up staging file before returning error
      try {
        fs.unlinkSync(stagingPath);
      } catch {
        // Ignore cleanup errors
      }
      stagingPath = null;

      return NextResponse.json(
        { error: "Failed to apply configuration. Please try again." },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { success: true, message: "Setup complete. Redirecting to dashboard..." },
      { status: 200 }
    );
  } catch (err) {
    console.error("[setup] error:", err instanceof Error ? err.message : String(err));

    // Clean up staging file if written
    if (stagingPath) {
      try {
        fs.unlinkSync(stagingPath);
      } catch {
        // Ignore cleanup errors
      }
    }

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
