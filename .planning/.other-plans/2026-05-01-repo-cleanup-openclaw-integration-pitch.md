# Plan: Repo Cleanup + OpenClaw Integration Pitch

## Context

**Why this work:** The owner is pitching a potential employer (who builds an OpenClaw-style autonomous agent that runs on Claude subscriptions via the Claude Agent SDK) on integrating this repo's peak-window optimization into their product. The pitch will succeed or fail on two artifacts: (1) the repo passing a 60-second eyeball test from a senior dev, and (2) a sharp integration proposal that proves this is more than a personal dashboard.

The repo is functional and the algorithm is sound, but it has surface-level mess that would tank credibility on first glance: stray scratch files, a contradictory license, package.json/repo name mismatch, two `as any` casts in production paths, and no public-facing artifact that reframes the project as **infrastructure** rather than a personal tool.

**Outcome:** A repo a senior dev would call "tidy" on first scan, plus an `INTEGRATION-PROPOSAL.md` and two new code surfaces (`/api/optimize` endpoint + Claude Agent SDK sender example) that demonstrate the project is already shaped for embedding into another product.

**Scope guardrails:**
- Do NOT touch anything under `.planning/` — and keep it committed in git as-is (per user instruction). No file edits, no deletions, no .gitignore changes that would untrack it.
- Do NOT modify or delete `.env.local` (gitignored, leave it)
- Do NOT rewrite CLAUDE.md (broken `.planning/` refs are acceptable)
- Do NOT push to remote — that's the user's call after review

---

## Phase 1: Repo Cleanup (~2.5 hrs)

### 1.1 Delete stray files at repo root
- Delete `Untitled-1.md` (1.9 KB scratch)
- Delete `test-output.log` (11 KB)
- Delete `tsconfig.tsbuildinfo` (183 KB stale buildinfo)
- Delete `AGENTS.md` (12-byte stub `@CLAUDE.md` redirect — useless)

### 1.2 Replace LICENSE with real MIT
- Overwrite `LICENSE` with standard MIT text, copyright "Elliot Drel 2026"

### 1.3 Fix `package.json`
- Rename: `claude-usage-tracker` → `claude-usage-optimizer`
- Bump version: `0.1.0` → `1.0.0` (v1.0 shipped per STATE.md)
- Change `"license": "UNLICENSED"` → `"license": "MIT"`
- Add `"repository": { "type": "git", "url": "https://github.com/<user>/claude-usage-optimizer" }` (placeholder, user fills in actual remote)
- Add `"author": "Elliot Drel"`
- Add `"keywords": ["claude", "claude-code", "anthropic", "agent-sdk", "usage-optimization", "openclaw", "claude-agent-sdk"]`
- Tighten `"description"` to one crisp sentence about anchor-window optimization

### 1.4 Rewrite README.md as portfolio-grade
**Critical files:** `README.md` (replace wholesale, ~120 lines)

Structure:
1. **Hero (3-line pitch):** What it does, who it's for, why it matters — in plain English
2. **The problem:** Claude Pro/Max subscribers (and OpenClaw-style agents running on those subscriptions) hit the 5-hour rolling quota window and lose hours of usable agent time
3. **The solution:** Detect the user's 4-hour peak block, anchor sends so two 5-hour windows span it → ~2x more usable hours per dollar
4. **Screenshot/demo placeholder:** `![Dashboard](docs/screenshot.png)` with a TODO note (user adds image post-merge)
5. **Architecture diagram (ASCII):** Collector → SQLite → Analyzer → Scheduler → Sender. Five boxes, two arrows
6. **Quick start:** Verified `npm ci && npm run dev` flow
7. **Production deploy:** One-line link to `docs/HOSTING-STRATEGY.md`
8. **Built for embedding:** Short section calling out that `/api/optimize` exposes the algorithm as a service for agent integration (links to `INTEGRATION-PROPOSAL.md`)
9. **License:** MIT

### 1.5 Add a one-page `ARCHITECTURE.md` at repo root
**Critical file:** `ARCHITECTURE.md` (new, ~80 lines)

Surface-level architecture doc with:
- Single ASCII diagram of the data flow (collector → DB → analyzer → scheduler → sender)
- Key abstractions list with file paths (`UsageCollector` @ `src/lib/collector.ts:?`, `peakDetector` @ `src/lib/peak-detector.ts:?`, `generateSchedule` @ `src/lib/schedule.ts:?`)
- One-paragraph "How to extend" pointing to `/api/optimize` and the SDK sender example

This is *separate* from the deep `.planning/codebase/ARCHITECTURE.md` (which we don't touch). Public-facing only.

### 1.6 Consolidate env example files
- Merge `claude-sender.env.example` into `.env.example` with clear `# ── Tracker ──` and `# ── Sender ──` section headers
- Delete `claude-sender.env.example`
- Update `claude-tracker.service` line 10: `EnvironmentFile=/etc/claude-sender.env` → `EnvironmentFile=/etc/claude-usage-optimizer.env`
- Update `docs/HOSTING-STRATEGY.md` references if they point to the old name

### 1.7 Fix the two `as any` / unsafe casts (functional bugs flagged in audit)
**Critical files:**
- `src/lib/notifier.ts:31` — replace `{ ... } as any` with proper Config build (or refactor `getDb` signature to accept partial)
- `src/utils/execFileNoThrow.ts:24` — replace `err as { code?: ... }` with a real type guard function

### 1.8 Cleanup miscellaneous
- `.gitignore`: dedupe the `.next/` rule (line 3 + later)
- `docs/`: move `2026-04-16-tracker-sender-merge-design.md` → `docs/archive/` (historical doc, no longer current)
- `scripts/install.sh:225`: fix the `127.0.0.1:3018` reference to match the documented port (or document why prod differs from dev)
- Delete root-level `tsconfig.tsbuildinfo` and add it to `.gitignore` if not already

## Phase 2: Functional Revisions (~1 hr)

These convert the project from "personal dashboard" → "infrastructure component an agent can call."

### 2.1 Add `/api/optimize` GET endpoint
**Critical file (new):** `src/app/api/optimize/route.ts` (~50 lines)

Reuses existing functions — no new logic:
- `getConfig()` from `src/lib/config.ts`
- `querySnapshots(config)` from `src/lib/db.ts`
- `peakDetector(snapshots, timezone, windowHours)` from `src/lib/peak-detector.ts`
- `generateSchedule(peakBlock, options)` from `src/lib/schedule.ts`

Returns JSON:
```json
{
  "peakBlock": { "startHour": 14, "endHour": 18, "totalUsage": 0.83 },
  "anchorTimeLocal": "16:00",
  "anchorTimeUtc": "2026-05-01T20:00:00.000Z",
  "fireSchedule": [{ "hour": 16, "minute": 0 }, ...],
  "timezone": "America/New_York",
  "computedAt": "2026-05-01T15:23:00.000Z"
}
```

Pure GET, no side effects. `dynamic = "force-dynamic"`. This is the API surface OpenClaw (or any agent) calls to get a recommendation without owning the algorithm.

### 2.2 Add Claude Agent SDK sender example
**Critical file (new):** `examples/agent-sdk-anchor-send.ts` (~80 lines)

Demonstrates the same anchor send the existing `src/lib/sender.ts` does via `claude` CLI, but using `@anthropic-ai/claude-agent-sdk` instead. This is the integration's "look, here's the exact pattern that drops into your product" artifact.

Structure:
- Imports `@anthropic-ai/claude-agent-sdk` (add to optional/dev deps with a README note — don't make it a required prod dep)
- Reads anchor time from `/api/optimize` (or accepts as CLI arg)
- Spawns a minimal Agent SDK session at the anchor time with one of the existing `QUESTIONS` constants from `src/lib/sender.ts`
- Logs to the same `send_log` table via `insertSendLog()` from `src/lib/db.ts`
- Inline comments explain the integration points (auth via `CLAUDE_CODE_OAUTH_TOKEN`, why timing matters)

Add a section to README.md ("Built for embedding") linking to this file.

## Phase 3: Integration Proposal Doc (~1 hr)

### 3.1 Write `INTEGRATION-PROPOSAL.md` at repo root (~3 pages, ~250 lines)

**Critical file (new):** `INTEGRATION-PROPOSAL.md`

Structure (sections, in order):

**1. Executive Summary (1 paragraph)**
- The problem agents on Claude subscriptions face
- What this project solves
- Three integration patterns ranked by effort

**2. The Quota Problem for Subscription-Auth Agents**
- Claude Pro/Max users get a 5-hour rolling window shared across claude.ai chat, Claude Code CLI, and any agent using `@anthropic-ai/claude-agent-sdk`
- Heavy agent users burn windows constantly; idle hours = wasted quota; busy hours = throttling
- Cite Anthropic's public confirmation that OpenClaw etc. are valid subscription consumers ([The New Stack](https://thenewstack.io/anthropic-agent-sdk-confusion/))

**3. The Solution (the algorithm in plain English)**
- Detect user's 4-hour peak block from historical usage (sliding-window over hourly aggregation)
- Fire an anchor send at the midpoint of that block
- Two consecutive 5-hour windows now span the peak → **doubled usable agent hours per subscription dollar**
- One-paragraph math worked example

**4. Three Integration Patterns**

| Pattern | Effort | Risk | Value |
|---------|--------|------|-------|
| **A. Sidecar service** | Lowest (days) | Lowest | Optimizer runs alongside the agent, calls `/api/optimize`, fires anchor sends via Agent SDK. Zero changes to the agent itself. |
| **B. Skill / plugin** | Medium (1-2 weeks) | Medium | Wrap the optimizer as an OpenClaw-style skill the agent installs. Shares user auth, runs in-process or as worker. |
| **C. Native module** | Highest (3-4 weeks) | Highest | Embed the scheduler + collector directly. Share persistence layer. Become a first-class quota-management subsystem. |

**5. What Ports vs. What Gets Rewritten**

Based on the file-by-file portability map (auditor output, see Phase 1 exploration):

**Port as-is (~290 lines, pure logic, zero coupling):**
- `src/lib/usage-window.ts` — window math (34 lines)
- `src/lib/normalize.ts` — payload parsing (85 lines)
- `src/lib/peak-detector.ts` — sliding-window peak detection (113 lines)
- `src/lib/schedule.ts` — fire-time generation (61 lines)

**Port with shim (~600 lines, swap I/O adapters):**
- `src/lib/collector.ts` — extract `computeNextDelay`, `computePollingDelta`, `fetchJson` from the class
- `src/lib/scheduler.ts` — extract `shouldRecomputeSchedule`, `fireTimeToUtcIso`, `recomputeSchedule`; swap app_meta R/W for target's config layer
- `src/lib/analysis.ts` — pure aggregation reusable; remove the dashboard-assembly tail
- `src/lib/config.ts` + `src/lib/auth-diagnostics.ts` — auth resolution reusable; rewrite credential-file reads for target's auth model

**Reference only (rewrite for target):**
- `src/lib/db.ts` — schema is portable, query layer is better-sqlite3-specific
- `src/lib/sender.ts` — `claude` CLI invocation specific to our keep-alive pattern; replace with target's execution model
- All Next.js routes, React components, `collector-singleton.ts`, `notifier.ts`, `backup.ts`

**6. Open Questions for Scoping**
A short list of things that need answers before writing a real spec:
- What's their auth flow today? (Agent SDK native? CLAUDE_CODE_OAUTH_TOKEN env? OAuth flow in their UI?)
- What's their persistence layer? (SQLite, Postgres, in-memory, none?)
- Do they already track quota state, or do users hit limits blindly?
- What's their scheduling primitive? (cron? in-process timer? workflow engine?)
- Multi-user vs single-user? (changes whether peak detection is per-user or global)

**7. Why Me**
Three sentences max. The project is shipped, the algorithm is tested, and the public API surface (`/api/optimize`, the Agent SDK example) demonstrates I've already shaped this for embedding.

### 3.2 Cross-link from README
Add a one-line link in README's "Built for embedding" section: `→ See [INTEGRATION-PROPOSAL.md](./INTEGRATION-PROPOSAL.md) for how this drops into agent products.`

## Order of Execution & Commit Strategy

Sequential, one logical commit per numbered subsection above. This produces a clean git log the employer will skim:

1. `chore: delete stray scratch files at repo root` (1.1)
2. `chore: switch to MIT license` (1.2)
3. `chore: align package.json with public repo metadata` (1.3)
4. `docs: rewrite README as portfolio-grade landing` (1.4)
5. `docs: add public ARCHITECTURE.md` (1.5)
6. `chore: consolidate env example files and fix systemd unit ref` (1.6)
7. `fix: replace unsafe type casts in notifier and execFileNoThrow` (1.7)
8. `chore: misc cleanup (gitignore, archive old design doc)` (1.8)
9. `feat: add /api/optimize endpoint exposing anchor-time recommendation` (2.1)
10. `feat: add Claude Agent SDK sender example for agent integration` (2.2)
11. `docs: add INTEGRATION-PROPOSAL.md` (3.1, 3.2)

Total: ~11 commits, ~4-5 hours wall time.

## Verification

After execution, run these checks end-to-end:

1. **Build still passes**
   ```
   npm ci
   npm run lint
   npm run build
   npm test
   ```
   All four must succeed. If `npm test` fails on something the cleanup touched, fix the test (or revert that specific change).

2. **`/api/optimize` returns a valid response**
   ```
   npm run dev
   curl http://localhost:3017/api/optimize
   ```
   Expect a JSON object with `peakBlock`, `anchorTimeLocal`, `anchorTimeUtc`, `fireSchedule`. With demo mode on (default in dev), this should return a populated response without auth.

3. **Agent SDK example syntax-checks**
   ```
   npx tsx examples/agent-sdk-anchor-send.ts --dry-run
   ```
   Should compile without TS errors and print the anchor time it *would* fire at, without actually invoking the SDK. Add a `--dry-run` flag for this.

4. **README quick-start works from a clean clone**
   ```
   cd /tmp && git clone <local repo path> test-clone && cd test-clone
   npm ci && npm run dev
   ```
   Open `http://localhost:3017`, confirm dashboard renders in demo mode.

5. **Visual check of the punch list**
   - `git status` clean (no `Untitled-1.md`, no `test-output.log`, no `tsconfig.tsbuildinfo`)
   - `cat LICENSE` shows real MIT text
   - `cat package.json` shows `claude-usage-optimizer` + `MIT` + repository field
   - `ls` at repo root: README, LICENSE, ARCHITECTURE.md, INTEGRATION-PROPOSAL.md, CONTRIBUTING.md, SECURITY.md, package.json, src/, test/, docs/, scripts/, examples/, .planning/ (untouched), and config files. No stray scratch files.
   - `tree examples/` shows `agent-sdk-anchor-send.ts`
   - `curl localhost:3017/api/optimize` returns 200 with the expected schema

6. **Git log scan**
   `git log --oneline -15` should read like a clean professional series of small focused commits, not "wip" or "fix stuff." This is the artifact the employer skims first when he opens the repo on GitHub.

## Files Changed Summary

**Deleted (4):** `Untitled-1.md`, `test-output.log`, `tsconfig.tsbuildinfo`, `AGENTS.md`, `claude-sender.env.example` (5 actually)

**Modified (9):**
- `LICENSE`
- `package.json`
- `README.md`
- `.env.example`
- `.gitignore`
- `claude-tracker.service`
- `docs/HOSTING-STRATEGY.md` (only env-file rename)
- `scripts/install.sh` (port fix)
- `src/lib/notifier.ts`
- `src/utils/execFileNoThrow.ts`

**Created (4):**
- `ARCHITECTURE.md`
- `INTEGRATION-PROPOSAL.md`
- `src/app/api/optimize/route.ts`
- `examples/agent-sdk-anchor-send.ts`

**Moved (1):**
- `docs/2026-04-16-tracker-sender-merge-design.md` → `docs/archive/`

**Untouched (per user instruction):**
- All of `.planning/` — stays committed in git, zero edits, zero deletions, zero gitignore changes
- `.env.local`
- `CLAUDE.md`