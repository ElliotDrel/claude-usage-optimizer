import type { Config } from "./config";

export const OAUTH_USAGE_ENDPOINT = "https://api.anthropic.com/api/oauth/usage";

function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, "");
}

export function getAuthPreflightError(config: Config): string | null {
  const endpoint = normalizeEndpoint(config.endpoint);

  if (
    config.authMode === "bearer" &&
    endpoint !== normalizeEndpoint(OAUTH_USAGE_ENDPOINT)
  ) {
    return [
      `Bearer auth is enabled, but CLAUDE_USAGE_ENDPOINT is set to ${config.endpoint}.`,
      `Bearer auth only works with ${OAUTH_USAGE_ENDPOINT}.`,
      "Update the endpoint or switch back to cookie auth.",
    ].join(" ");
  }

  if (
    config.authMode === "cookie" &&
    endpoint === normalizeEndpoint(OAUTH_USAGE_ENDPOINT)
  ) {
    return [
      "Cookie auth is enabled, but CLAUDE_USAGE_ENDPOINT is set to the OAuth usage endpoint.",
      "Cookie auth needs the claude.ai organization usage endpoint instead.",
    ].join(" ");
  }

  return null;
}

export function explainAuthFailure(config: Config, rawMessage: string): string {
  const preflight = getAuthPreflightError(config);
  if (preflight) return preflight;

  if (
    config.authMode === "bearer" &&
    (rawMessage.includes("token_expired") ||
      rawMessage.includes("OAuth token has expired"))
  ) {
    return [
      rawMessage,
      "The cached bearer token has expired.",
      "Refresh Claude Code or set a new CLAUDE_BEARER_TOKEN, then restart the app so it reloads credentials.",
    ].join(" ");
  }

  if (
    config.authMode === "bearer" &&
    (rawMessage.includes("authentication_error") ||
      rawMessage.includes("Invalid authorization") ||
      rawMessage.includes("account_session_invalid"))
  ) {
    return [
      rawMessage,
      "Bearer auth failed.",
      `Make sure CLAUDE_USAGE_ENDPOINT is ${OAUTH_USAGE_ENDPOINT}.`,
      "If you just refreshed Claude credentials, restart the app so it picks up the new token.",
    ].join(" ");
  }

  return rawMessage;
}
