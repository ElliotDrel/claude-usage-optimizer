import fs from "node:fs";
import path from "node:path";
import { OAUTH_USAGE_ENDPOINT } from "./auth-diagnostics";

export interface Config {
  host: string;
  port: number;
  appUrl: string;
  autoOpenBrowser: boolean;
  dataDir: string;
  dbPath: string;
  endpoint: string;
  bearerToken: string;
  sessionCookie: string;
  authMode: "bearer" | "cookie" | "none";
  hasAuth: boolean;
  demoMode: boolean;
}

function getCookieValue(cookieHeader: string, name: string): string {
  const prefix = `${name}=`;

  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length);
    }
  }

  return "";
}

function buildClaudeCookieEndpoint(orgId: string): string {
  if (!orgId) return "";
  return `https://claude.ai/api/organizations/${orgId}/usage`;
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
  const host = process.env.APP_HOST?.trim() || "localhost";
  const port = parseInt(process.env.PORT ?? "3017", 10);
  const appUrl = `http://${host}:${port}`;
  const autoOpenBrowser = process.env.AUTO_OPEN_BROWSER === "true";
  const sessionCookie = process.env.CLAUDE_SESSION_COOKIE?.trim() ?? "";
  const envBearerToken = process.env.CLAUDE_BEARER_TOKEN?.trim() ?? "";
  const bearerToken = sessionCookie
    ? envBearerToken
    : envBearerToken || tryReadClaudeCredentials();

  const authMode: Config["authMode"] = sessionCookie
    ? "cookie"
    : bearerToken
      ? "bearer"
      : "none";

  const dataDir = path.resolve(
    process.cwd(), /*turbopackIgnore: true*/ process.env.DATA_DIR ?? "data"
  );

  const orgId =
    process.env.CLAUDE_ORG_ID?.trim() ||
    getCookieValue(sessionCookie, "lastActiveOrg");
  const legacyEndpoint = process.env.CLAUDE_USAGE_ENDPOINT?.trim();
  const bearerEndpoint =
    process.env.CLAUDE_BEARER_USAGE_ENDPOINT?.trim() ||
    legacyEndpoint ||
    OAUTH_USAGE_ENDPOINT;
  const cookieEndpoint =
    process.env.CLAUDE_COOKIE_USAGE_ENDPOINT?.trim() ||
    legacyEndpoint ||
    buildClaudeCookieEndpoint(orgId);

  const endpoint =
    authMode === "cookie"
      ? cookieEndpoint || bearerEndpoint
      : bearerEndpoint;

  const demoMode = process.env.DEMO_MODE === "true";

  return {
    host,
    port,
    appUrl,
    autoOpenBrowser,
    dataDir,
    dbPath: path.join(dataDir, demoMode ? "demo.db" : "usage.db"),
    endpoint,
    bearerToken,
    sessionCookie,
    authMode,
    hasAuth: demoMode || authMode !== "none",
    demoMode,
  };
}
