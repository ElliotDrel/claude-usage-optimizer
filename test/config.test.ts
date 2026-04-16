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
  it("uses localhost defaults, keeps browser auto-open off, and defaults dev to demo mode", () => {
    withEnv(
      {
        APP_HOST: undefined,
        PORT: undefined,
        AUTO_OPEN_BROWSER: undefined,
        DEV_DEMO_MODE: undefined,
        PROD_DEMO_MODE: undefined,
        NODE_ENV: "development",
      },
      () => {
        const config = getConfig();
        assert.equal(config.host, "localhost");
        assert.equal(config.port, 3017);
        assert.equal(config.appUrl, "http://localhost:3017");
        assert.equal(config.autoOpenBrowser, false);
        assert.equal(config.orgId, "");
        assert.equal(config.demoMode, true);
      }
    );
  });

  it("respects host, port, and browser-open overrides", () => {
    withEnv(
      {
        APP_HOST: "127.0.0.1",
        PORT: "3018",
        AUTO_OPEN_BROWSER: "true",
      },
      () => {
        const config = getConfig();
        assert.equal(config.host, "127.0.0.1");
        assert.equal(config.port, 3018);
        assert.equal(config.appUrl, "http://127.0.0.1:3018");
        assert.equal(config.autoOpenBrowser, true);
      }
    );
  });

  it("allows dev mode to opt out of demo data explicitly", () => {
    withEnv(
      {
        DEV_DEMO_MODE: "false",
        PROD_DEMO_MODE: undefined,
        NODE_ENV: "development",
      },
      () => {
        const config = getConfig();
        assert.equal(config.demoMode, false);
      }
    );
  });

  it("keeps production mode real by default", () => {
    withEnv(
      {
        DEV_DEMO_MODE: undefined,
        PROD_DEMO_MODE: undefined,
        NODE_ENV: "production",
      },
      () => {
        const config = getConfig();
        assert.equal(config.demoMode, false);
      }
    );
  });

  it("allows production mode to opt into demo data explicitly", () => {
    withEnv(
      {
        DEV_DEMO_MODE: undefined,
        PROD_DEMO_MODE: "true",
        NODE_ENV: "production",
      },
      () => {
        const config = getConfig();
        assert.equal(config.demoMode, true);
      }
    );
  });

  it("prefers cookie auth when both cookie and bearer are present", () => {
    withEnv(
      {
        CLAUDE_SESSION_COOKIE: "session=value; lastActiveOrg=test-org",
        CLAUDE_BEARER_TOKEN: "bearer-token",
      },
      () => {
        const config = getConfig();
        assert.equal(config.authMode, "cookie");
        assert.equal(config.hasAuth, true);
        assert.equal(config.appUrl, "http://localhost:3017");
        assert.equal(config.orgId, "test-org");
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
          CLAUDE_SESSION_COOKIE: "session=value; lastActiveOrg=test-org",
          CLAUDE_BEARER_TOKEN: undefined,
        },
        () => {
          const config = getConfig();
          assert.equal(config.authMode, "cookie");
          assert.equal(
            config.sessionCookie,
            "session=value; lastActiveOrg=test-org"
          );
          assert.equal(config.bearerToken, "");
          assert.equal(existsSyncMock.mock.callCount(), 0);
        }
      );
    } finally {
      existsSyncMock.mock.restore();
    }
  });

  it("uses CLAUDE_ORG_ID when the cookie does not include lastActiveOrg", () => {
    withEnv(
      {
        CLAUDE_SESSION_COOKIE: "session=value",
        CLAUDE_ORG_ID: "env-org",
      },
      () => {
        const config = getConfig();
        assert.equal(
          config.orgId,
          "env-org"
        );
        assert.equal(
          config.endpoint,
          "https://claude.ai/api/organizations/env-org/usage"
        );
      }
    );
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
