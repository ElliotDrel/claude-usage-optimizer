import fs from "node:fs";
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { getConfig } from "../src/lib/config";

function withEnv(
  overrides: Record<string, string | undefined>,
  run: () => void
): void {
  const previous = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe("getConfig", () => {
  it("prefers cookie auth when both cookie and bearer are present", () => {
    withEnv(
      {
        CLAUDE_SESSION_COOKIE: "session=value",
        CLAUDE_BEARER_TOKEN: "bearer-token",
        CLAUDE_COOKIE_USAGE_ENDPOINT: "https://claude.ai/api/organizations/test-org/usage",
        CLAUDE_BEARER_USAGE_ENDPOINT: "https://api.anthropic.com/api/oauth/usage",
      },
      () => {
        const config = getConfig();
        assert.equal(config.authMode, "cookie");
        assert.equal(config.hasAuth, true);
        assert.equal(
          config.endpoint,
          "https://claude.ai/api/organizations/test-org/usage"
        );
      }
    );
  });

  it("uses bearer auth when cookie is absent", () => {
    withEnv(
      {
        CLAUDE_SESSION_COOKIE: "",
        CLAUDE_BEARER_TOKEN: "bearer-token",
        CLAUDE_COOKIE_USAGE_ENDPOINT: "https://claude.ai/api/organizations/test-org/usage",
        CLAUDE_BEARER_USAGE_ENDPOINT: "https://api.anthropic.com/api/oauth/usage",
      },
      () => {
        const config = getConfig();
        assert.equal(config.authMode, "bearer");
        assert.equal(config.hasAuth, true);
        assert.equal(config.endpoint, "https://api.anthropic.com/api/oauth/usage");
      }
    );
  });

  it("does not read local Claude credentials when cookie auth is set", () => {
    const existsSyncMock = mock.method(fs, "existsSync", () => {
      throw new Error("credentials file should not be checked");
    });

    try {
      withEnv(
        {
          CLAUDE_SESSION_COOKIE: "session=value",
          CLAUDE_BEARER_TOKEN: undefined,
        },
        () => {
          const config = getConfig();
          assert.equal(config.authMode, "cookie");
          assert.equal(config.sessionCookie, "session=value");
          assert.equal(config.bearerToken, "");
          assert.equal(existsSyncMock.mock.callCount(), 0);
        }
      );
    } finally {
      existsSyncMock.mock.restore();
    }
  });

  it("falls back to the legacy endpoint when auth-specific endpoints are unset", () => {
    withEnv(
      {
        CLAUDE_SESSION_COOKIE: "",
        CLAUDE_BEARER_TOKEN: "bearer-token",
        CLAUDE_COOKIE_USAGE_ENDPOINT: undefined,
        CLAUDE_BEARER_USAGE_ENDPOINT: undefined,
        CLAUDE_USAGE_ENDPOINT: "https://legacy.example/usage",
      },
      () => {
        const config = getConfig();
        assert.equal(config.endpoint, "https://legacy.example/usage");
      }
    );
  });
});
