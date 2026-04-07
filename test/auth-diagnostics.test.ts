import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  explainAuthFailure,
  getAuthPreflightError,
  OAUTH_USAGE_ENDPOINT,
} from "../src/lib/auth-diagnostics";
import type { Config } from "../src/lib/config";

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 3017,
    dataDir: "data",
    dbPath: "data/usage.db",
    endpoint: OAUTH_USAGE_ENDPOINT,
    bearerToken: "",
    sessionCookie: "",
    authMode: "none",
    hasAuth: false,
    demoMode: false,
    ...overrides,
  };
}

describe("auth diagnostics", () => {
  it("reports a clear preflight error for bearer auth on the cookie endpoint", () => {
    const config = makeConfig({
      endpoint: "https://claude.ai/api/organizations/test-org/usage",
      authMode: "bearer",
      bearerToken: "token",
      hasAuth: true,
    });

    const message = getAuthPreflightError(config);
    assert.ok(message);
    assert.match(message!, /Bearer auth is enabled/);
    assert.match(message!, /Bearer auth only works with/);
  });

  it("explains expired bearer tokens plainly", () => {
    const config = makeConfig({
      authMode: "bearer",
      bearerToken: "token",
      hasAuth: true,
    });

    const message = explainAuthFailure(
      config,
      "HTTP 401: {\"type\":\"error\",\"error\":{\"type\":\"authentication_error\",\"details\":{\"error_code\":\"token_expired\"}}}"
    );

    assert.match(message, /cached bearer token has expired/i);
    assert.match(message, /restart the app/i);
  });

  it("explains generic bearer auth failures plainly", () => {
    const config = makeConfig({
      authMode: "bearer",
      bearerToken: "token",
      hasAuth: true,
    });

    const message = explainAuthFailure(
      config,
      "HTTP 403: {\"type\":\"error\",\"error\":{\"type\":\"permission_error\",\"details\":{\"error_code\":\"account_session_invalid\"}}}"
    );

    assert.match(message, /Bearer auth failed/i);
    assert.match(
      message,
      /If you just refreshed Claude credentials, restart the app/i
    );
  });
});
