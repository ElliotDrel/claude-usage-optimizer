import fs from "node:fs";
import path from "node:path";
import { OAUTH_USAGE_ENDPOINT } from "./auth-diagnostics";

export interface Config {
  port: number;
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

export function getConfig(): Config {
  const bearerToken =
    process.env.CLAUDE_BEARER_TOKEN?.trim() || tryReadClaudeCredentials();
  const sessionCookie = process.env.CLAUDE_SESSION_COOKIE?.trim() ?? "";

  const authMode: Config["authMode"] = sessionCookie
    ? "cookie"
    : bearerToken
      ? "bearer"
      : "none";

  const dataDir = path.resolve(
    process.cwd(), /*turbopackIgnore: true*/ process.env.DATA_DIR ?? "data"
  );

  const legacyEndpoint = process.env.CLAUDE_USAGE_ENDPOINT?.trim();
  const bearerEndpoint =
    process.env.CLAUDE_BEARER_USAGE_ENDPOINT?.trim() ||
    legacyEndpoint ||
    OAUTH_USAGE_ENDPOINT;
  const cookieEndpoint =
    process.env.CLAUDE_COOKIE_USAGE_ENDPOINT?.trim() ||
    legacyEndpoint ||
    "";

  const endpoint =
    authMode === "cookie"
      ? cookieEndpoint || bearerEndpoint
      : bearerEndpoint;

  return {
    port: parseInt(process.env.PORT ?? "3000", 10),
    dataDir,
    dbPath: path.join(dataDir, "usage.db"),
    endpoint,
    bearerToken,
    sessionCookie,
    authMode,
    hasAuth: authMode !== "none",
  };
}
