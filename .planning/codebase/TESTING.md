# Testing Patterns

**Analysis Date:** 2026-04-16

## Scope

Automated tests exist only for the TypeScript project at `Claude Usage Tracker/claude-usage-tracker/`. The Python scripts in `Claude Message Sender/` have a manual-run `test_send_now.py` which sends a live message but is not a unit test suite.

## Test Framework

**Runner:**
- Node.js built-in test runner (`node:test`) executed via `tsx`
- Version: `tsx ^4.21.0` (dev dep), Node (from `@types/node: ^20`)
- No Jest, Vitest, Mocha, or any external test framework
- Config: none beyond the npm script

**Assertion Library:**
- `node:assert/strict` (built-in) — all tests import `assert from "node:assert/strict"`

**Run Commands:**
```bash
npm test              # Runs tsx --test test/*.test.ts
npm run lint          # ESLint; CI/quality gate alongside tests
```

The full test script is defined in `Claude Usage Tracker/claude-usage-tracker/package.json:14`:
```json
"test": "tsx --test test/*.test.ts"
```

No watch mode or coverage script is configured.

## Test File Organization

**Location:**
- Separate top-level directory: `Claude Usage Tracker/claude-usage-tracker/test/`
- NOT co-located with source; tests are mirrored by name

**Naming:**
- `<module-name>.test.ts` where `<module-name>` matches a file in `src/lib/` (e.g., `test/collector.test.ts` ↔ `src/lib/collector.ts`)
- Feature-oriented tests for cross-module behavior use descriptive names: `dashboard-health.test.ts`, `heatmap.test.ts`

**Current test files:**
```
Claude Usage Tracker/claude-usage-tracker/test/
├── analysis.test.ts           # buildDashboardData — deltas, insights, extras
├── auth-diagnostics.test.ts   # Preflight + failure message translation
├── collector.test.ts          # computeNextDelay + computePollingDelta (pure)
├── config.test.ts             # getConfig env resolution
├── dashboard-health.test.ts   # Health rollups + timeline filtering
├── db.test.ts                 # SQLite insert/query with real tmp DB
├── heatmap.test.ts            # Heatmap aggregation (day * 24 + hour)
├── normalize.test.ts          # normalizeUsagePayload parsing
└── usage-window.test.ts       # Reset normalization + delta logic
```

**Imports into tests:**
- Use relative paths up into `src/` (`import { buildDashboardData } from "../src/lib/analysis"`) rather than the `@/*` alias — see `test/analysis.test.ts:3`
- Type imports via `import type { ... }` (`test/analysis.test.ts:4-5`)

## Test Structure

**Suite Organization:**

Standard `describe` + `it` pattern using `node:test` exports:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("computeNextDelay", () => {
  it("stays idle when no delta", () => {
    const result = computeNextDelay(state(), { delta: 0, success: true });
    assert.equal(result.currentTier, "idle");
    assert.equal(result.consecutiveNoChange, 1);
    assert.equal(result.delayMs, 5 * 60_000);
  });
});
```

**Patterns:**
- One `describe` block per exported function or logical behavior group
- Test names are full English sentences describing behavior (`"jumps idle -> burst when delta detected"`, `"steps down one tier after 3 no-change polls"`, `"ignores resets_at jitter within the same hour"`)
- Multiple `describe` blocks per file when covering multiple functions (`test/usage-window.test.ts` has three: `normalizeResetHour`, `isSameUsageWindow`, `computeUsageDelta`)

**Setup/teardown:**
- `after()` used for cleanup (imported from `node:test`) — see `test/db.test.ts:50-60` which closes the DB handle and removes the tmp file, WAL, and SHM sidecars
- No `beforeEach`/`afterEach` in the current suite; each `it` builds its own data locally

**Assertion style:**
- `assert.equal` for primitives (strict equality via `node:assert/strict`)
- `assert.deepEqual` for objects and arrays (`test/db.test.ts:117-125`, `test/dashboard-health.test.ts:89-104`)
- `assert.ok` for truthy checks (`test/db.test.ts:69`, `test/auth-diagnostics.test.ts:39`)
- `assert.match(message, /regex/)` for string pattern assertions on user-facing messages (`test/auth-diagnostics.test.ts:40,56,72`)
- Non-null assertion `!` when the test knows the value is present (`assert.match(message!, /...)` — `test/auth-diagnostics.test.ts:40`)

## Mocking

**Framework:** `node:test`'s built-in `mock` module

**Patterns:**

Method-level mocking with cleanup in `finally`:

```typescript
import { describe, it, mock } from "node:test";
import fs from "node:fs";

const existsSyncMock = mock.method(fs, "existsSync", () => {
  throw new Error("credentials file should not be checked");
});

try {
  // ... run test logic ...
  assert.equal(existsSyncMock.mock.callCount(), 0);
} finally {
  existsSyncMock.mock.restore();
}
```
(from `test/config.test.ts:152-176`)

**What to Mock:**
- Filesystem reads that could leak real user data (`fs.existsSync` for `.credentials.json` in `test/config.test.ts`)
- Environment variables — via a custom `withEnv` helper (see below), not `mock.method`

**What NOT to Mock:**
- Database — `test/db.test.ts` uses a real SQLite file in `os.tmpdir()` (`path.join(os.tmpdir(), ``test-usage-${Date.now()}.db``)`) cleaned up in `after()`
- Pure functions — `computeNextDelay`, `normalizeUsagePayload`, `buildDashboardData`, etc. are called directly with hand-built fixtures
- HTTP `fetch` — network-touching code paths in `collector.ts` (`pollOnce`) are not tested; only the pure `computeNextDelay` / `computePollingDelta` slices are covered

## Fixtures and Factories

**Pattern:** Inline factory functions at the top of each test file

**Standard collector/runtime fixture:**
```typescript
const mockRuntime: CollectorState = {
  startedAt: "2026-04-06T10:00:00Z",
  isConfigured: true,
  isPolling: false,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null,
  consecutiveFailures: 0,
  endpoint: "https://api.anthropic.com/api/oauth/usage",
  authMode: "bearer",
  currentTier: "idle" as const,
  nextPollAt: null,
  consecutiveNoChange: 0,
};

const mockStorage = { path: "data/usage.db", sizeBytes: 4096, totalSnapshots: 2 };
```
(repeated near-verbatim in `test/analysis.test.ts:7-22`, `test/dashboard-health.test.ts:7-22`, `test/heatmap.test.ts:7-22`)

**Snapshot builder factory:**
```typescript
function makeSnapshot(
  overrides: Partial<SnapshotRow> & { timestamp: string }
): SnapshotRow {
  return {
    id: 1,
    status: "ok",
    endpoint: "test",
    auth_mode: "bearer",
    response_status: 200,
    five_hour_utilization: null,
    // ... all other fields as null ...
    ...overrides,
  };
}
```
(see `test/analysis.test.ts:24-45`, `test/dashboard-health.test.ts:24-46`, `test/heatmap.test.ts:24-45`)

**State builder with spread-overrides:**
```typescript
function state(overrides: Partial<TierState> = {}): TierState {
  return {
    currentTier: "idle",
    consecutiveNoChange: 0,
    consecutiveFailures: 0,
    ...overrides,
  };
}
```
(see `test/collector.test.ts:9-16`)

**Config factory:**
```typescript
function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    host: "localhost",
    port: 3017,
    // ... all fields ...
    ...overrides,
  };
}
```
(see `test/auth-diagnostics.test.ts:10-27`)

**Environment-variable helper (`test/config.test.ts:6-32`):**
```typescript
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
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
```
Always wraps `getConfig()` calls so env state is restored even on assertion failure.

**Insert helper for db tests (`test/db.test.ts:27-48`):**
Wraps `insertSnapshot` with sensible null defaults so each test specifies only the fields it cares about.

**Location:**
- All fixtures/factories live inside the test file that uses them
- No shared `test/fixtures/` or `test/helpers/` directory
- Duplication of the runtime/snapshot factories across three files is intentional isolation

## Coverage

**Requirements:** None enforced. No coverage tool installed.

**View Coverage:**
- Not configured. `node:test` supports `--experimental-test-coverage` but the npm script does not enable it. To check coverage manually:
  ```bash
  tsx --test --experimental-test-coverage test/*.test.ts
  ```

## Test Types

**Unit Tests (pure logic):**
- `test/collector.test.ts` — tier state machine (`computeNextDelay`) and polling delta seeding (`computePollingDelta`)
- `test/usage-window.test.ts` — reset normalization and delta math
- `test/normalize.test.ts` — API payload parsing
- `test/auth-diagnostics.test.ts` — error message translation

**Integration Tests (real SQLite):**
- `test/db.test.ts` — opens a real `better-sqlite3` DB in `os.tmpdir()`, exercises `insertSnapshot`, `querySnapshots`, `getDbMeta` end-to-end, cleans up WAL/SHM sidecars
- `test/config.test.ts` — invokes `getConfig()` with real environment manipulation

**Analysis/Aggregation Tests:**
- `test/analysis.test.ts` — extensive coverage of `buildDashboardData`: deltas within/across windows, jitter handling, null handling, extra-usage top-ups/spend events, month boundary rollovers
- `test/dashboard-health.test.ts` — success/error counts, timeline filtering to ok-only snapshots
- `test/heatmap.test.ts` — `dayIndex * 24 + hour` cell placement, accumulation, 168-cell invariant, ignoring error snapshots

**E2E Tests:**
- Not used. No Playwright, Cypress, or equivalent

## Common Patterns

**Hand-crafted UTC timestamps:**
Test timestamps are hard-coded ISO strings in UTC (`"2026-04-06T10:05:00Z"`) so reset-window arithmetic is deterministic:
```typescript
makeSnapshot({
  id: 2,
  timestamp: "2026-04-06T10:05:00Z",
  five_hour_utilization: 22,
  five_hour_resets_at: "2026-04-06T15:00:00Z",
}),
```

**Locale-dependent hour derivation:**
Tests that compare against hourly bars compute the expected hour via `new Date(ts).getHours()` so the test still passes across timezones:
```typescript
const hour = new Date("2026-04-06T10:05:00Z").getHours();
assert.equal(result.activity.hourlyBars[hour].totalDelta, 12);
```
(see `test/analysis.test.ts:88-89`, `test/heatmap.test.ts:53-56`)

**Reductions to collapse 24 hourly bars to a single totalDelta:**
```typescript
const totalDelta = result.activity.hourlyBars.reduce((sum, b) => sum + b.totalDelta, 0);
assert.equal(totalDelta, 0);
```
(see `test/analysis.test.ts:130-131,151-152`)

**Accumulating state across multiple `computeNextDelay` calls:**
```typescript
let s = state({ currentTier: "burst", consecutiveNoChange: 0 });
s = computeNextDelay(s, { delta: 1, success: true });
assert.equal(s.currentTier, "burst");
s = computeNextDelay(s, { delta: 0, success: true });
assert.equal(s.consecutiveNoChange, 1);
```
(see `test/collector.test.ts:110-133`)

**Error-message assertions with `assert.match`:**
```typescript
const message = explainAuthFailure(config, "HTTP 401: ...token_expired...");
assert.match(message, /cached bearer token has expired/i);
assert.match(message, /restart the app/i);
```
(see `test/auth-diagnostics.test.ts:44-58`)

## Gaps and Notes

- `UsageCollector.pollOnce()` (the main I/O-driven method with fetch, preflight, retry, and tier scheduling) has no direct tests — only its pure helpers
- `src/app/api/**` route handlers have no tests
- `src/components/**` React components have no tests (no React Testing Library installed)
- `src/lib/collector-singleton.ts` (including `seedDemoData`) has no tests
- `src/instrumentation.ts` has no tests
- No snapshot/visual regression testing
- No CI configuration in the repo (`.github/`, `.gitlab-ci.yml`, etc.)

---

*Testing analysis: 2026-04-16*
