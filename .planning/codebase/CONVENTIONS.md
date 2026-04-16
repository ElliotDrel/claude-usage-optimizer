# Coding Conventions

**Analysis Date:** 2026-04-16

## Scope

This document covers the TypeScript/Next.js project in `Claude Usage Tracker/claude-usage-tracker/` (the primary active codebase) and the Python scripts in `Claude Message Sender/`. The top-level `claude-usage-tracker/` directory appears to be a build artifact shell (only `.next/`, `data/`, `node_modules/`, `public/`, `scripts/`, `src/`, `test/` with no package.json). Authoritative code lives at `Claude Usage Tracker/claude-usage-tracker/`.

## Naming Patterns

**Files (TypeScript):**
- Library/logic modules: `kebab-case.ts` (e.g., `Claude Usage Tracker/claude-usage-tracker/src/lib/auth-diagnostics.ts`, `src/lib/collector-singleton.ts`, `src/lib/usage-window.ts`)
- Single-word lib modules: `lowercase.ts` (e.g., `src/lib/db.ts`, `src/lib/config.ts`, `src/lib/collector.ts`, `src/lib/analysis.ts`, `src/lib/normalize.ts`)
- React components: `PascalCase.tsx` (e.g., `src/components/CollectorHealth.tsx`, `src/components/UsageCards.tsx`, `src/components/ExtraUsageCard.tsx`)
- Next.js route files: lowercase conventional names (`src/app/page.tsx`, `src/app/layout.tsx`, `src/app/api/dashboard/route.ts`)
- Test files: `<module>.test.ts` matching source name (e.g., `test/collector.test.ts` tests `src/lib/collector.ts`)

**Files (Python):**
- `snake_case.py` (e.g., `Claude Message Sender/claude_message_send_with_CC_CLI.py`, `Claude Message Sender/test_send_now.py`)

**Functions:**
- TypeScript: `camelCase` verb-first (`getConfig`, `insertSnapshot`, `buildDashboardData`, `computeNextDelay`, `normalizeUsagePayload`, `parseBooleanEnv`)
- Private helper functions: `camelCase`, module-local (no `export`) — see `toLabel` in `src/lib/normalize.ts`, `tryReadClaudeCredentials` in `src/lib/config.ts`
- Type guard functions: `is<Type>` (`isUsageBucket` in `src/lib/normalize.ts`, `isSameUsageWindow` in `src/lib/usage-window.ts`)
- React components: `PascalCase` function components (`CollectorHealth`, `UsageCards`, `StatusPill`, `Section`)

**Variables:**
- `camelCase` for locals and parameters (`sessionCookie`, `isDevelopment`, `demoFiveHour`)
- `UPPER_SNAKE_CASE` for module-level constants (`TIER_DELAYS`, `TIER_DOWN`, `ERROR_BACKOFF`, `SCHEMA`, `MIGRATIONS`, `COOLDOWN_MS`, `OAUTH_USAGE_ENDPOINT`, `COLORS`, `RANGE_CONFIG`)
- Underscore-prefix for singleton globals hanging off `globalThis` (`_usageCollector` in `src/lib/collector-singleton.ts`)

**Types:**
- `PascalCase` for interfaces and type aliases (`Config`, `SnapshotRow`, `CollectorState`, `TierState`, `PollResult`, `DashboardData`, `NormalizedPayload`, `ExtraUsageData`, `HourlyBar`, `HeatmapCell`, `TimelinePoint`)
- String literal unions over enums: `type Tier = "idle" | "light" | "active" | "burst"` (`src/lib/collector.ts:9`), `authMode: "bearer" | "cookie" | "none"` (`src/lib/config.ts:16`)
- Prefer `interface` for object shapes, `type` for unions and computed types

**Database columns:**
- `snake_case` in SQLite (`five_hour_utilization`, `seven_day_resets_at`, `extra_usage_monthly_limit`) — see `src/lib/db.ts:7-40`
- Mapped to `camelCase` when passed through the insert function (`fiveHourUtilization`, `sevenDayResetsAt`) — see `src/lib/db.ts:110-157`

## Code Style

**Formatting:**
- No Prettier config detected; formatting is hand-consistent
- Indentation: 2 spaces
- Double quotes for string literals throughout (`"node:test"`, `"ok"`, `"bearer"`)
- Template literals with backticks for interpolation (`` `http://${host}:${port}` ``)
- Trailing commas in multi-line arrays/objects (see `src/lib/collector.ts:37` for the `ERROR_BACKOFF` array and `src/lib/db.ts:91-108` for interface definitions)
- Semicolons required at statement ends
- Arrow functions for callbacks and module-level helpers inside `React.useMemo`/`useCallback`
- `function` keyword for top-level named functions (`function getConfig()`, `function getDb()`)

**Linting:**
- ESLint 9 with flat config at `Claude Usage Tracker/claude-usage-tracker/eslint.config.mjs`
- Extends `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`
- Overrides default ignores to `.next/**`, `out/**`, `build/**`, `next-env.d.ts`
- Run with `npm run lint`

**TypeScript:**
- `strict: true` enabled (`tsconfig.json:7`)
- `target: ES2017`, `module: esnext`, `moduleResolution: bundler`
- Path alias: `@/*` maps to `./src/*` — always preferred over relative paths inside `src/` (see `src/app/api/dashboard/route.ts:2-5`)

## Import Organization

**Order (observed across modules):**
1. Node built-in modules with `node:` prefix (`import fs from "node:fs"`, `import path from "node:path"`, `import { describe, it } from "node:test"`)
2. Third-party packages (`import Database from "better-sqlite3"`, `import { NextResponse } from "next/server"`, `import { formatDistanceToNow } from "date-fns"`)
3. Internal absolute imports via `@/*` alias (`import { getConfig } from "@/lib/config"`)
4. Relative imports from same package (`import type { Config } from "./config"`, `import { insertSnapshot } from "./db"`)
5. Type-only imports use `import type { ... }` syntax — see `src/app/page.tsx:4`, `src/lib/db.ts:3`, test files

**Path Aliases:**
- `@/*` → `src/*` (defined in `Claude Usage Tracker/claude-usage-tracker/tsconfig.json:21-23`)
- Used in `src/app/**` and `src/components/**`
- Library files inside `src/lib/` use relative imports to sibling modules (`./config`, `./db`)

**Dynamic imports:**
- Used in `src/lib/collector.ts:428` (`await import("./db")`) and `src/instrumentation.ts:3,6` for module loading on server startup

## Error Handling

**Patterns:**
- Collector catches HTTP/fetch errors in `pollOnce()` (`src/lib/collector.ts:370-413`) and translates them via `explainAuthFailure()` before surfacing to the UI
- Auth failure translation: `src/lib/auth-diagnostics.ts` contains `getAuthPreflightError` (preflight validation) and `explainAuthFailure` (converts raw HTTP 401/403 bodies into plain-English guidance with restart instructions)
- Try/catch around filesystem credential reads returns empty string on failure rather than throwing (`src/lib/config.ts:39-49`)
- Swallowed errors with explanatory comments (`src/lib/db.ts:52-55` for idempotent migrations, `src/lib/collector-singleton.ts:59` for first-run file cleanup)
- Error state stored on collector: `state.lastError`, `state.consecutiveFailures` — surfaced in dashboard response
- Tiered error backoff: `ERROR_BACKOFF = [60_000, 120_000, 300_000, 600_000]` escalates on consecutive failures, capped at 10 min (`src/lib/collector.ts:37`)
- `Promise.allSettled` used for best-effort parallel fetches where partial failure is acceptable (`src/lib/collector.ts:294-300`)
- `JSON.parse` wrapped in try/catch returning null (`src/lib/collector.ts:117-123` `parseJson`)
- Errors on HTTP: thrown with truncated body in message (first 500 chars) — `src/lib/collector.ts:138-142`
- UI API calls use `.catch()` to degrade silently (`src/app/page.tsx:26-30`, `src/app/api/poll/route.ts:13`)

**Error types:**
- Plain `Error` instances thrown; no custom error classes
- `err instanceof Error ? err.message : String(err)` idiom for unknown catch values (`src/lib/collector.ts:371`)

## Logging

**Framework:** `console.log`, `console.warn`, `console.error` — no structured logger

**Patterns:**
- Bracketed module tag prefix: `[collector]`, `[demo]`, `[instrumentation]` (see `src/lib/collector.ts:408,500,508`, `src/lib/collector-singleton.ts:63,154`, `src/instrumentation.ts:8`)
- `console.warn` for recoverable failures (`src/lib/collector.ts:408`)
- `console.error` in UI for fetch failures (`src/app/page.tsx:27`)
- `console.log` for lifecycle events (startup, demo seeding, demo poll results)

## Comments

**When to Comment:**
- Section dividers in larger modules use `// --- Section Name ---` (see `src/lib/collector.ts:7,39,152,169`)
- Explain non-obvious intent, not mechanics (`// Seed the in-memory baseline on first success without treating it as new usage.` — `src/lib/collector.ts:104`)
- Swallowed errors always annotated with why (`// Column already exists; safe to ignore.` — `src/lib/db.ts:54`)
- Pragma comments for Next.js turbopack behavior: `/*turbopackIgnore: true*/` in `src/lib/config.ts:79`

**JSDoc/TSDoc:**
- Not used in the TypeScript codebase
- Python scripts use triple-quoted docstrings for modules and functions (`Claude Message Sender/claude_message_send_with_CC_CLI.py:2-6,41,68,79`)

## Function Design

**Size:**
- Library helpers are small and single-purpose (typically 10-30 lines — see `src/lib/usage-window.ts`, `src/lib/auth-diagnostics.ts`)
- `UsageCollector.pollOnce()` is the main exception at ~190 lines (`src/lib/collector.ts:221-414`), intentionally linear for readability

**Parameters:**
- Prefer object parameters for anything with 4+ fields (see `insertSnapshot(config, data)` in `src/lib/db.ts:110` and `querySnapshots(config, opts?)` at line 159)
- Positional params for 2-3 small values (`computeUsageDelta(prevUtil, currUtil, prevResetAt, currResetAt)` in `src/lib/usage-window.ts:19`)
- Optional options bag uses `opts?: { ... }` pattern (`src/lib/db.ts:161`)

**Return Values:**
- Functions return discriminated unions or status shapes: `{ status: "ok" | "error" | "skipped", error?: string }` (`src/lib/collector.ts:221`)
- Pure state-transition helpers return the new state plus computed extras: `computeNextDelay` returns `TierState & { delayMs: number }` (`src/lib/collector.ts:41-44`)
- Null over `undefined` for "no value yet" database/domain fields; `undefined` for optional params

**Purity:**
- Pure functions separated from side-effectful ones, e.g., `computeNextDelay` and `computePollingDelta` in `src/lib/collector.ts` are pure and separately testable; `UsageCollector` class holds state and I/O
- Comment `// --- Pure function ---` used to mark the boundary (`src/lib/collector.ts:39`)

## Module Design

**Exports:**
- Named exports only; no default exports in lib or API route files
- Route handlers use named `GET`/`POST` functions + `export const dynamic = "force-dynamic"` (`src/app/api/dashboard/route.ts:7-9`, `src/app/api/poll/route.ts:5-8`, `src/app/api/snapshots/route.ts:5`)
- React pages use `export default function PageName()` (`src/app/page.tsx:13`, `src/app/layout.tsx:9`)
- Components use named exports: `export function CollectorHealth({ data }: ...)` (`src/components/CollectorHealth.tsx:93`)

**Barrel Files:**
- Not used — each module imported directly from its file

**Singletons:**
- Module-level state cached via `globalThis` to survive Next.js re-imports (`src/lib/collector-singleton.ts:9-11`)
- Database handle cached in module scope (`src/lib/db.ts:5`)

## React/UI Conventions

**Client components:**
- Explicit `"use client"` directive at top (`src/app/page.tsx:1`, all `src/components/*.tsx`)
- Hooks: `useState`, `useEffect`, `useCallback`, `useMemo` used conventionally
- Auto-refresh pattern via `setInterval` in `useEffect` with cleanup (`src/app/page.tsx:50-54`, `src/components/CollectorHealth.tsx:96-99`)

**Styling:**
- Tailwind utility classes for layout and spacing
- Inline `style={{ ... }}` objects for theming using CSS custom properties: `var(--accent)`, `var(--text-primary)`, `var(--bg-surface)`, `var(--border-subtle)`, `var(--font-mono)`, `var(--font-display)`
- Color tokens by semantic role: `--good`, `--warn`, `--danger`, plus `-dim` variants (`src/components/UsageCards.tsx:6-16`, `src/app/page.tsx:239-241`)
- No styled-components or CSS modules; `src/app/globals.css` holds tokens

**Props:**
- Inline type annotations on destructured props (`{ data }: { data: DashboardData | null }`) rather than separate `Props` interface — see `src/components/UsageCards.tsx:18`, `CollectorHealth.tsx:93`

**Data fetching:**
- Client-side `fetch` against `/api/*` routes with `cache: "no-store"` (`src/app/page.tsx:22`)
- No React Query or SWR; plain state + polling interval

## Next.js Conventions

- App Router (`src/app/**`)
- API routes via `route.ts` with named HTTP verb exports
- `export const dynamic = "force-dynamic"` on every API route to opt out of static caching
- `serverExternalPackages: ["better-sqlite3"]` in `Claude Usage Tracker/claude-usage-tracker/next.config.ts` to prevent bundling of the native module
- Server startup hook in `src/instrumentation.ts` (`register()` function) bootstraps the collector

## Python Conventions (Claude Message Sender)

- PEP 8 style, 4-space indentation
- Module docstrings and function docstrings (triple-quoted)
- Type hints used selectively on function signatures (`Claude Message Sender/claude_message_send_with_CC_CLI.py:41,68,79`)
- Module-level config constants (`CLAUDE_COMMAND`, `CLAUDE_MODEL`, `start_time`, `interval_hours`, `QUESTIONS`)
- Shebang `#!/usr/bin/env python3` on executable scripts
- `if __name__ == "__main__":` entry point pattern (`Claude Message Sender/test_send_now.py:68`)

---

*Convention analysis: 2026-04-16*
