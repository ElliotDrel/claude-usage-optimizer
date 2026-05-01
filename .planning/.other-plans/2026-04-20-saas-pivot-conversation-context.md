# SaaS Pivot — Conversation Context

**Date:** 2026-04-20
**Purpose:** Documents the ideas, discussion, and decisions that led to the SaaS pivot design spec.

## Starting Point

The project was at Phase 2 of 8 in the self-hosted roadmap. Phase 1 (Foundation & DB Refactor) was complete — 84 tests passing, simplified schema, read-path normalization through `queries.ts`. The existing plan called for each user to provision their own GCP e2-micro VM and run the app themselves. Phase 7 was dedicated entirely to making installation tolerable for non-technical users (a `curl | bash` installer + first-run web wizard).

## The Initial Idea

Instead of having everyone set up their own GCP VM, host the service centrally. Users sign up on a website, provide their credentials, and the system handles everything. Store data in Supabase instead of local SQLite. Make it free.

The motivation: the self-hosted GCP setup is the biggest friction point. Removing it would massively widen the audience. A non-technical user shouldn't need to provision infrastructure.

## Key Discussion Points

### "Do we need a server per person?"

Initial assumption was that each user would need their own isolated server because:
- The Claude CLI authentication is session-based
- Each user needs their own polling process with their own credentials

**Resolution:** No. Usage polling is just HTTP requests with different auth headers per user — one process can handle many users. CLI sends could potentially use per-invocation env vars (`CLAUDE_CODE_OAUTH_TOKEN=xxx claude -p "hello"`). The real question became whether the CLI respects the token purely from env vars or also reads/writes shared `~/.claude/` config files.

### Docker containers vs single process

If isolation was truly needed, Docker containers on one VM was discussed as the path. Each user would get a lightweight container with their own `~/.claude/` config. The concern was whether containers sharing one public IP could look suspicious to Anthropic (many OAuth tokens from one IP) and whether one flagged IP could take down all users.

**Resolution:** Moved past this when the Claude Agent SDK was discovered — no CLI or filesystem isolation needed at all.

### API vs CLI vs Agent SDK

Three sending mechanisms were discussed:

1. **Anthropic API** (`@anthropic-ai/sdk` with `ANTHROPIC_API_KEY`) — Rejected. API calls use separate per-token billing, not the user's Pro/Max subscription. Wouldn't trigger the 5-hour window resets that the whole optimizer depends on.

2. **Claude CLI** (`claude -p`) — The current self-hosted approach. Works but requires CLI installation, `~/.claude/` config per user, and process isolation for multi-tenant.

3. **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) — Discovered during research. Supports `CLAUDE_CODE_OAUTH_TOKEN`, usage counts against the user's subscription, no CLI installation needed. Cleanest multi-tenant approach.

**Resolution:** Claude Agent SDK. No CLI, no Docker, no filesystem isolation. Just SDK calls with different tokens from one process.

### Anthropic ToS concern

The Agent SDK docs state: "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK."

**Discussion:** The service isn't reselling compute or offering Claude access — it's just timing when the user's existing subscription sends fire. It's free and consumes negligible resources (5 trivial Haiku messages/day per user). The intent is to help users fully utilize their existing subscriptions.

**Resolution:** Send Anthropic an email requesting approval before launch. The design doc serves as the technical plan to accompany that request. Build the architecture in the meantime since it's the same regardless of the approval path.

### Adaptive polling frequency

The polling can't be a cron job because frequency adapts to user activity — up to every 30 seconds when the user is active, down to 10 minutes when idle. This rules out serverless approaches (Cloud Run Jobs, Supabase Edge Functions, Vercel cron) and requires a persistent process.

**Resolution:** Single long-running Node.js process on GCP e2-micro. Each user gets an in-memory `UserAgent` running the same adaptive polling state machine from the existing codebase.

### Local data bootstrapping

The existing system requires ~3 days of polling data before peak detection has enough signal. The idea was raised to extract historical session data from Claude Code's local storage (`~/.claude/`) to bootstrap peak detection from day one.

**Discussion:** Claude Code stores session timestamps and token counts locally. An npm package (`claude-usage-optimizer`) would read this data and upload it on first connect. Users would run it on each machine they use Claude Code on.

**Resolution:** Include this in the design but defer implementation details. The npm package handles token collection (primary purpose) and historical data upload (bonus for cold-start optimization).

## Architecture Decisions

### Approach selection

Three approaches were evaluated:

- **A: Single Node.js Process on GCP** — One process manages all users' polling loops. Simplest. Ceiling ~30-50 users on free tier.
- **B: Worker Queue Architecture** — Job scheduler + queue + workers. Overengineered for <50 users.
- **C: Supabase Edge Functions + pg_cron** — No persistent server. Doesn't work with adaptive polling (30s intervals exceed Edge Function limits).

**Chosen: Approach A.** Complexity of B and C isn't justified at this scale. Upgrade the box before upgrading the architecture.

### Hosting split

- **Vercel free tier:** Landing page, auth, dashboard (Next.js app)
- **Supabase free tier:** Auth, Postgres database, Realtime subscriptions
- **GCP e2-micro free tier:** Polling & sending engine (Node.js process)

All communication between Vercel and GCP goes through Supabase as the shared data layer. The engine has no public-facing ports.

### Auth

Supabase Auth with email+password, Google OAuth, and GitHub OAuth. Row Level Security on all user-scoped tables so the dashboard can query Supabase directly from the client.

### Token security

User OAuth tokens are AES-256 encrypted before storage. Encryption key in environment variables. Vercel writes encrypted tokens but never reads them. Only the GCP engine decrypts. Users see "token configured" status, never the raw value.

### Budget

Hard constraint: $0/month. Everything on free tiers. At ~50 users, either upgrade GCP to e2-small (~$5/month) or implement polling priority to reduce load.

## What Carries Forward

- Phase 1 work (schema, conventions, test patterns) remains valuable
- Phase 2 (peak detection + schedule algorithms) is identical — pure functions with no runtime coupling
- The adaptive polling state machine code is reused, just instantiated per user
- Dashboard panel designs stay the same, just reading from Supabase instead of local SQLite

## What's New

- Multi-tenant data model with RLS
- `EngineManager` + `UserAgent` abstraction on the GCP engine
- Supabase Realtime for engine coordination (new users, settings changes, commands)
- Claude Agent SDK for sends instead of CLI spawn
- Vercel-hosted public dashboard with auth
- npm package for token + history collection
- Token encryption layer
