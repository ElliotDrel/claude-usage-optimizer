# Codebase Structure

**Analysis Date:** 2026-04-16

## Directory Layout

```
claude-usage-optimizer/                        # Umbrella repo root
├── .git/                                      # Git metadata
├── .gitignore                                 # Combined Node + Python + env ignores
├── .planning/                                 # GSD planning artifacts
│   └── codebase/                              # Codebase maps (this file lives here)
├── README.md                                  # Umbrella-level overview
├── Untitled-1.md                              # Scratch note (untracked, not source)
│
├── Claude Message Sender/                     # Python subproject (space in dir name)
│   ├── .vscode/
│   │   └── settings.json
│   ├── claude_message_send_with_browser.py    # Browser + pyautogui variant
│   ├── claude_message_send_with_CC_CLI.py     # Claude CLI subprocess variant
│   ├── test_send_now.py                       # Manual one-shot trigger
│   └── requirements.txt                       # `schedule>=1.2.0`
│
├── Claude Usage Tracker/                      # Wrapper dir (space in name)
│   └── claude-usage-tracker/                  # Actual Next.js project root
│       ├── .env.example                       # Documented env vars (committed)
│       ├── .env.local                         # Local secrets (gitignored)
│       ├── .gitignore                         # Project-local ignores
│       ├── .planning/                         # Nested planning dir
│       ├── eslint.config.mjs                  # Flat-config ESLint w/ next presets
│       ├── next.config.ts                     # `serverExternalPackages: ["better-sqlite3"]`
│       ├── package.json                       # Scripts + deps
│       ├── postcss.config.mjs                 # Tailwind v4 via @tailwindcss/postcss
│       ├── tsconfig.json                      # Strict TS, `@/*` → `./src/*`
│       ├── Untitled-1.md                      # Scratch note
│       ├── scripts/                           # Windows Scheduled Task installers
│       │   ├── install-startup.ps1
│       │   ├── restart-startup.ps1
│       │   ├── start-app.ps1                  # Launcher used by the scheduled task
│       │   └── uninstall-startup.ps1
│       ├── src/
│       │   ├── instrumentation.ts             # Next.js register() hook; starts collector
│       │   ├── app/                           # Next.js App Router
│       │   │   ├── globals.css                # Tailwind + design tokens (CSS vars)
│       │   │   ├── layout.tsx                 # Root layout, metadata, <html><body>
│       │   │   ├── page.tsx                   # Dashboard SPA (client component)
│       │   │   └── api/                       # Route handlers
│       │   │       ├── dashboard/route.ts     # GET aggregated data
│       │   │       ├── poll/route.ts          # POST force-poll w/ cooldown
│       │   │       └── snapshots/route.ts     # GET raw rows
│       │   ├── components/                    # All client-side React components
│       │   │   ├── CollectorHealth.tsx
│       │   │   ├── ExtraUsage.tsx
│       │   │   ├── ExtraUsageCard.tsx
│       │   │   ├── Heatmap.tsx
│       │   │   ├── PeakHours.tsx
│       │   │   ├── UsageCards.tsx
│       │   │   └── UsageTimeline.tsx
│       │   └── lib/                           # Server-only domain + I/O
│       │       ├── analysis.ts                # buildDashboardData, DashboardData type
│       │       ├── auth-diagnostics.ts        # Preflight + error translation
│       │       ├── collector-singleton.ts     # globalThis-cached UsageCollector
│       │       ├── collector.ts               # UsageCollector class + pure tier math
│       │       ├── config.ts                  # getConfig() env resolution
│       │       ├── db.ts                      # better-sqlite3 schema, insert, query
│       │       ├── normalize.ts               # normalizeUsagePayload
│       │       └── usage-window.ts            # computeUsageDelta + reset-hour helpers
│       ├── test/                              # Tests driven by `tsx --test`
│       │   ├── analysis.test.ts
│       │   ├── auth-diagnostics.test.ts
│       │   ├── collector.test.ts
│       │   ├── config.test.ts
│       │   ├── dashboard-health.test.ts
│       │   ├── db.test.ts
│       │   ├── heatmap.test.ts
│       │   ├── normalize.test.ts
│       │   └── usage-window.test.ts
│       ├── data/                              # SQLite files (gitignored)
│       │   ├── usage.db                       # Real poll data
│       │   └── demo.db                        # Demo-mode seeded data
│       ├── public/                            # Static assets (currently empty)
│       ├── node_modules/                      # Gitignored
│       └── .next/                             # Next.js build output (gitignored)
│
└── claude-usage-tracker/                      # STALE duplicate (see Special Directories)
    ├── .env.local
    ├── .next/                                 # Stale build artifacts
    ├── data/                                  # Stale DBs
    ├── node_modules/                          # Stale deps
    ├── public/                                # Empty
    ├── scripts/                               # Empty
    ├── src/{app,components,lib}/              # Empty directories only
    ├── test/                                  # Empty
    ├── next-env.d.ts
    ├── package-lock.json
    └── tsconfig.tsbuildinfo
```

## Directory Purposes

**`.planning/codebase/` (repo root):**
- Purpose: GSD codebase maps consumed by planner/executor commands.
- Contains: `ARCHITECTURE.md`, `STRUCTURE.md`, and other focus-specific docs.
- Generated: Yes, by `/gsd-map-codebase`.
- Committed: Yes (planning artifacts live with the repo).

**`Claude Message Sender/`:**
- Purpose: Standalone Python scheduler that periodically sends a Claude message to start or shift the 5-hour rolling window.
- Contains: Two scheduler scripts (one browser-driven, one Claude-CLI-driven) + a manual trigger + `requirements.txt`.
- Key files: `claude_message_send_with_browser.py`, `claude_message_send_with_CC_CLI.py`, `test_send_now.py`.

**`Claude Usage Tracker/claude-usage-tracker/`:**
- Purpose: The Next.js 16 dashboard project. This nested path (space in the outer directory, hyphen inside) is the canonical tracker location.
- Contains: Everything needed to build/run the dashboard — source, tests, scripts, configs.

**`Claude Usage Tracker/claude-usage-tracker/src/app/`:**
- Purpose: Next.js App Router surface.
- Contains: `layout.tsx`, `page.tsx`, `globals.css`, and `api/*/route.ts` handlers.
- Key files: `page.tsx` is the entire dashboard UI shell, `api/dashboard/route.ts` is the primary read endpoint.

**`Claude Usage Tracker/claude-usage-tracker/src/components/`:**
- Purpose: Leaf React components that render sections of the dashboard. All are `"use client"`.
- Contains: Seven components, one per dashboard section.
- Key files: `UsageTimeline.tsx` (recharts AreaChart + Line), `Heatmap.tsx` (CSS grid), `PeakHours.tsx` (recharts BarChart).

**`Claude Usage Tracker/claude-usage-tracker/src/lib/`:**
- Purpose: Server-only domain logic and I/O adapters. Never imported from `"use client"` files except for type-only imports.
- Contains: Config, collector, DB, normalizer, analytics, auth diagnostics, window math.
- Key files: `collector.ts` (the polling engine), `analysis.ts` (the analytics that shape `DashboardData`), `db.ts` (all SQLite access).

**`Claude Usage Tracker/claude-usage-tracker/test/`:**
- Purpose: Node built-in test runner tests, one per `src/lib/` module plus `dashboard-health` / `heatmap` scenario tests.
- Contains: 9 `*.test.ts` files using `node:test` + `node:assert/strict`; driven by `tsx --test`.

**`Claude Usage Tracker/claude-usage-tracker/scripts/`:**
- Purpose: PowerShell scripts to install/restart/uninstall the `ClaudeUsageTracker` Windows Scheduled Task and a launcher for the scheduled task itself.
- Committed: Yes.

**`Claude Usage Tracker/claude-usage-tracker/data/`:**
- Purpose: SQLite database files. Created at runtime by `getDb()`.
- Generated: Yes.
- Committed: No (`**/data/` in both `.gitignore` files).

**`Claude Usage Tracker/claude-usage-tracker/public/`:**
- Purpose: Static assets served at `/`.
- Contents: Currently empty.

## Key File Locations

**Entry Points:**
- `Claude Usage Tracker/claude-usage-tracker/src/instrumentation.ts` — Next.js server boot hook; starts the collector.
- `Claude Usage Tracker/claude-usage-tracker/src/app/layout.tsx` — Root HTML layout + metadata.
- `Claude Usage Tracker/claude-usage-tracker/src/app/page.tsx` — Dashboard SPA entry.
- `Claude Usage Tracker/claude-usage-tracker/scripts/start-app.ps1` — Production launcher (scheduled-task target).
- `Claude Message Sender/claude_message_send_with_browser.py` — Browser-driven sender.
- `Claude Message Sender/claude_message_send_with_CC_CLI.py` — Claude-CLI-driven sender.
- `Claude Message Sender/test_send_now.py` — Manual trigger.

**Configuration:**
- `Claude Usage Tracker/claude-usage-tracker/.env.example` — Documented env-var template.
- `Claude Usage Tracker/claude-usage-tracker/.env.local` — Local secrets (gitignored).
- `Claude Usage Tracker/claude-usage-tracker/next.config.ts` — Next.js config (`serverExternalPackages`).
- `Claude Usage Tracker/claude-usage-tracker/tsconfig.json` — TS config with `@/*` path alias.
- `Claude Usage Tracker/claude-usage-tracker/eslint.config.mjs` — Flat-config ESLint.
- `Claude Usage Tracker/claude-usage-tracker/postcss.config.mjs` — Tailwind v4.
- `Claude Usage Tracker/claude-usage-tracker/package.json` — Scripts (`dev`, `start:prod`, `test`, `startup:*`, `lint`, `build`).
- `Claude Message Sender/requirements.txt` — Python deps.
- `.gitignore` (root) — Combined Node + Python + env patterns.

**Core Logic:**
- `Claude Usage Tracker/claude-usage-tracker/src/lib/collector.ts` — `UsageCollector` + `computeNextDelay` + `computePollingDelta`.
- `Claude Usage Tracker/claude-usage-tracker/src/lib/collector-singleton.ts` — `getCollector()` with demo seeding.
- `Claude Usage Tracker/claude-usage-tracker/src/lib/config.ts` — `getConfig()` env resolution.
- `Claude Usage Tracker/claude-usage-tracker/src/lib/db.ts` — Schema, migrations, `insertSnapshot`, `querySnapshots`, `getDbMeta`.
- `Claude Usage Tracker/claude-usage-tracker/src/lib/analysis.ts` — `buildDashboardData` + `DashboardData` type.
- `Claude Usage Tracker/claude-usage-tracker/src/lib/normalize.ts` — `normalizeUsagePayload`.
- `Claude Usage Tracker/claude-usage-tracker/src/lib/usage-window.ts` — `computeUsageDelta`.
- `Claude Usage Tracker/claude-usage-tracker/src/lib/auth-diagnostics.ts` — `getAuthPreflightError`, `explainAuthFailure`.

**Testing:**
- `Claude Usage Tracker/claude-usage-tracker/test/` — Unit + scenario tests (see TESTING.md if present).
- Run via `npm test` in the tracker directory.

**Database Schema:**
- `Claude Usage Tracker/claude-usage-tracker/src/lib/db.ts` — Look for the `SCHEMA` and `MIGRATIONS` string constants. Columns on `usage_snapshots`: `id`, `timestamp`, `status`, `endpoint`, `auth_mode`, `response_status`, `five_hour_utilization`, `five_hour_resets_at`, `seven_day_utilization`, `seven_day_resets_at`, `raw_json`, `error_message`, plus migrated `extra_usage_enabled`, `extra_usage_monthly_limit`, `extra_usage_used_credits`, `extra_usage_utilization`. Separate `app_meta(key,value)` table tracks migration flags.

## Naming Conventions

**Files (TypeScript/TSX):**
- Components: `PascalCase.tsx` (e.g., `UsageTimeline.tsx`, `CollectorHealth.tsx`).
- Library modules: `kebab-case.ts` (e.g., `collector-singleton.ts`, `auth-diagnostics.ts`, `usage-window.ts`). Exception: single-word modules use one word (`collector.ts`, `config.ts`, `db.ts`, `analysis.ts`, `normalize.ts`).
- Route handlers: Next.js requires `route.ts` inside a named folder (e.g., `api/dashboard/route.ts`).
- Tests: `kebab-case.test.ts` matching the module under test (e.g., `auth-diagnostics.test.ts`).
- CSS: `globals.css` (single file; all styles use Tailwind utilities + CSS variables).

**Files (Python):**
- `snake_case_with_descriptive_suffix.py` (e.g., `claude_message_send_with_browser.py`). The acronym `CC_CLI` is preserved as uppercase inside the snake_case name.

**Files (PowerShell):**
- `kebab-case.ps1` for scripts (e.g., `install-startup.ps1`, `start-app.ps1`).

**Directories:**
- Tracker uses `kebab-case` (`claude-usage-tracker`) and Next.js conventions (`app/`, `lib/`, `components/`, `api/`, `public/`, `scripts/`, `test/`).
- The umbrella repo uses two directories with spaces (`Claude Message Sender/`, `Claude Usage Tracker/`) — these are human-readable labels, not code-referenced paths.
- **Quote paths with spaces in shell commands** (`"Claude Usage Tracker"`).

**TypeScript identifiers:**
- Types and interfaces: `PascalCase` (`UsageCollector`, `DashboardData`, `SnapshotRow`, `NormalizedPayload`, `TierState`, `Config`).
- Functions: `camelCase` (`getConfig`, `buildDashboardData`, `computeNextDelay`, `normalizeUsagePayload`).
- Constants: `SCREAMING_SNAKE_CASE` for module-level constants (`SCHEMA`, `MIGRATIONS`, `TIER_DELAYS`, `TIER_DOWN`, `ERROR_BACKOFF`, `OAUTH_USAGE_ENDPOINT`, `COOLDOWN_MS`, `COLORS`, `RANGE_CONFIG`, `DAY_LABELS`).
- String-literal union types over enums (e.g., `type Tier = "idle" | "light" | "active" | "burst"`, `authMode: "bearer" | "cookie" | "none"`).

**SQL columns:** `snake_case` (`five_hour_utilization`, `extra_usage_monthly_limit`). The TypeScript `SnapshotRow` interface mirrors these exactly; camelCase versions appear only in the `insertSnapshot` function's parameter shape.

**Import aliases:** `@/*` resolves to `./src/*` (configured in `tsconfig.json` paths). Use `@/lib/...` and `@/components/...` in `src/app/*` and within components.

## Where to Add New Code

**New dashboard section / UI component:**
- Implementation: `Claude Usage Tracker/claude-usage-tracker/src/components/<PascalCase>.tsx` — must declare `"use client"` if it uses hooks or browser APIs.
- Wire-up: Add to `Claude Usage Tracker/claude-usage-tracker/src/app/page.tsx` using the `<Section title="..." label="...">` wrapper already defined there.
- Data: If the component needs new fields, add them to `DashboardData` in `src/lib/analysis.ts` and compute them in `buildDashboardData`; do not fetch separately from the client.

**New HTTP endpoint:**
- Implementation: `Claude Usage Tracker/claude-usage-tracker/src/app/api/<name>/route.ts`.
- Export: `GET` / `POST` / etc. as async functions returning `NextResponse.json(...)`.
- Always export `export const dynamic = "force-dynamic"` to avoid accidental caching.
- Read config with `getConfig()`; do not access env vars directly.

**New analytics / derived field:**
- Implementation: Extend `buildDashboardData` in `Claude Usage Tracker/claude-usage-tracker/src/lib/analysis.ts` and the exported interfaces (`DashboardData`, `TimelinePoint`, `ExtraUsageInsights`, etc.).
- Tests: Add cases to `test/analysis.test.ts` (or `test/dashboard-health.test.ts` if it's a health/summary field).

**New polling behavior / tier:**
- Pure logic: `Claude Usage Tracker/claude-usage-tracker/src/lib/collector.ts` — update `Tier`, `TIER_DELAYS`, `TIER_DOWN`, `ERROR_BACKOFF`, or the `computeNextDelay` function.
- Tests: `test/collector.test.ts` covers `computeNextDelay` / `computePollingDelta` directly — mirror the existing `state()` helper.

**New persisted column:**
- Migration: Append an `ALTER TABLE usage_snapshots ADD COLUMN ...` line to the `MIGRATIONS` constant in `src/lib/db.ts` (each statement is wrapped in its own `try`/`catch`, so additions are idempotent).
- Schema: Add the column to the `CREATE TABLE` in the same `SCHEMA` constant so fresh DBs pick it up.
- Type: Add the field to `SnapshotRow` and to the `insertSnapshot` parameter object; remember to pass it through from the collector.
- Tests: `test/db.test.ts` exercises the DB layer against a temp file.

**New config / env var:**
- Implementation: Extend the `Config` interface and `getConfig()` in `src/lib/config.ts`.
- Documentation: Add a commented line to `.env.example`.
- Tests: `test/config.test.ts` already exercises env-var resolution.

**New test:**
- Location: `Claude Usage Tracker/claude-usage-tracker/test/<name>.test.ts`.
- Style: Use `describe` / `it` from `node:test` and `assert` from `node:assert/strict`; import the module under test from `../src/lib/...`.

**New Python scheduler variant:**
- Location: `Claude Message Sender/claude_message_send_with_<name>.py`.
- Pattern: Copy the `generate_daily_times` / `get_next_time_slot` / `main` skeleton from an existing variant and swap only the action function (`send_claude_message` / `ask_claude`).

**Shared utility (TypeScript):**
- There is no `src/lib/utils/` subfolder today. Add helpers to the most relevant existing `src/lib/*.ts` file, or create a new `src/lib/<kebab-case>.ts` module. Avoid adding `index.ts` barrels — the codebase imports each module by its full path.

## Special Directories

**`claude-usage-tracker/` (lowercase, at repo root):**
- Purpose: A stale mirror of the tracker. Contains `.next/`, `node_modules/`, `data/`, `.env.local`, `next-env.d.ts`, `package-lock.json`, and `tsconfig.tsbuildinfo`, but its `src/{app,components,lib}/` subtrees are empty (only `src/app/api/` exists as an empty dir).
- Generated: Mixed — build outputs yes, but the empty source tree is a relic of a previous layout or a broken rename.
- Committed: No (everything here is gitignored).
- Action: Treat the `Claude Usage Tracker/claude-usage-tracker/` path as canonical. Do not add new files under the lowercase copy; flag it for cleanup (see CONCERNS.md if generated).

**`.next/`:**
- Purpose: Next.js build output (cache, compiled routes, `BUILD_ID`).
- Generated: Yes (by `next dev` / `next build`).
- Committed: No (`**/.next/` in `.gitignore`).

**`node_modules/`:**
- Generated: Yes (by `npm install`).
- Committed: No.

**`data/`:**
- Purpose: SQLite databases.
- Generated: Yes (by `getDb()` on first poll). Also seeded by `seedDemoData()` when `demoMode` is true.
- Committed: No (`**/data/` in `.gitignore`).

**`.planning/`:**
- Purpose: GSD planning artifacts.
- Committed: Yes.
- Note: There are two copies — one at the repo root and one inside `Claude Usage Tracker/claude-usage-tracker/`. The root copy is canonical for the umbrella repo.

**`Untitled-1.md` files:**
- Present at the repo root and inside `Claude Usage Tracker/claude-usage-tracker/`.
- Scratch notes, untracked at the root. Not source code.

---

*Structure analysis: 2026-04-16*
