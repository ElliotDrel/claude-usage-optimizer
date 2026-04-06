import fs from "node:fs";
import path from "node:path";

export interface Config {
  port: number;
  pollMinMs: number;
  dataDir: string;
  dbPath: string;
  endpoint: string;
  bearerToken: string;
  sessionCookie: string;
  authMode: "bearer" | "cookie" | "none";
  hasAuth: boolean;
}

function tryReadClaudeCredentials(): string {
  try {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    const credPath = path.join(home, ".claude", ".credentials.json");
    if (!fs.existsSync(credPath)) return "";
    const creds = JSON.parse(fs.readFileSync(credPath, "utf8"));
    return creds?.claudeAiOauth?.accessToken ?? "";
  } catch {
    return "";
  }
}

function sanitizeMinInterval(raw: string | undefined): number {
  const parsed = parseInt(raw ?? "30000", 10);
  if (!Number.isFinite(parsed) || parsed < 30_000) return 30_000;
  return parsed;
}

export function getConfig(): Config {
  const bearerToken =
    process.env.CLAUDE_BEARER_TOKEN?.trim() || tryReadClaudeCredentials();
  const sessionCookie = process.env.CLAUDE_SESSION_COOKIE?.trim() ?? "";

  const authMode: Config["authMode"] = bearerToken
    ? "bearer"
    : sessionCookie
      ? "cookie"
      : "none";

  const dataDir = path.resolve(
    process.cwd(), /*turbopackIgnore: true*/ process.env.DATA_DIR ?? "data"
  );

  return {
    port: parseInt(process.env.PORT ?? "3000", 10),
    pollMinMs: sanitizeMinInterval(process.env.POLL_MIN_MS),
    dataDir,
    dbPath: path.join(dataDir, "usage.db"),
    endpoint:
      process.env.CLAUDE_USAGE_ENDPOINT?.trim() ??
      "https://api.anthropic.com/api/oauth/usage",
    bearerToken,
    sessionCookie,
    authMode,
    hasAuth: authMode !== "none",
  };
}
