# Claude Usage Optimizer — SaaS Pivot Design

**Date:** 2026-04-20
**Status:** Draft — pending Anthropic approval for third-party OAuth token usage

## Overview

Transform the Claude Usage Optimizer from a self-hosted single-user app into a hosted multi-tenant service. Users sign up on a website, provide their Claude Code OAuth token, and the system handles usage tracking + optimized send scheduling on their behalf. The core value proposition is unchanged: schedule anchor sends so two consecutive 5-hour windows span the user's peak usage period.

### Why SaaS

The self-hosted model requires each user to provision a GCP VM, install dependencies, configure systemd, and manage backups. Phase 7 of the current roadmap dedicates an entire phase to making this tolerable. The SaaS model eliminates all of that — users sign up, paste a token (or run an npm command), and the system works.

### Anthropic Approval Required

The Claude Agent SDK docs state: "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products." This service accepts users' OAuth tokens and makes Claude Agent SDK calls on their behalf. While the service is free and doesn't consume meaningful resources (5 trivial Haiku sends/day per user), formal approval from Anthropic is required before launch. This design document serves as the technical plan to accompany that request.

## Architecture

### Three Components, Two Deployments

```
+----------------------------------+
|  Vercel (free tier)              |
|  Next.js App                     |
|  - Landing page                  |
|  - Auth (Supabase Auth)          |
|  - User dashboard                |
|  - API routes (writes)           |
+----------------+-----------------+
                 |
         +-------+-------+
         |   Supabase    |
         |  (free tier)  |
         |  - Auth       |
         |  - Postgres   |
         |  - Realtime   |
         +-------+-------+
                 |
+----------------+-----------------+
|  GCP e2-micro (free tier)        |
|  Polling & Sending Engine        |
|  - Per-user polling loops        |
|  - Adaptive state machine        |
|  - Schedule executor             |
|  - Claude Agent SDK calls        |
+----------------------------------+
```

### Data Flow

1. User signs up on Vercel app -> Supabase Auth creates account
2. User provides OAuth token -> encrypted (AES-256) and stored in Supabase `profiles`
3. GCP engine detects new user via Supabase Realtime, spawns a `UserAgent`
4. `UserAgent` runs adaptive polling loop, writes snapshots to Supabase
5. Nightly at 03:00 UTC: peak detection + schedule generation per user
6. Scheduled sends fire via Claude Agent SDK with the user's decrypted token
7. Dashboard reads from Supabase scoped by Row Level Security

## Data Model (Supabase Postgres)

All tables with `user_id` have Row Level Security policies: `auth.uid() = user_id`.

### `profiles`

Extended user info beyond Supabase Auth.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | FK to `auth.users`, PK |
| `token_status` | text | `'configured'`, `'missing'`, `'expired'` (client-visible) |
| `token_type` | text | `'oauth'` or `'cookie'` |
| `timezone` | text | IANA timezone, default `'America/Los_Angeles'` |
| `created_at` | timestamptz | |

RLS: Users can read/write their own row. No sensitive data in this table.

### `secrets`

Stores encrypted OAuth tokens. Physically separated from client-readable data.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `user_id` | uuid | FK to `auth.users`, unique |
| `encrypted_token` | text | Encrypted with GCP engine's public key |
| `updated_at` | timestamptz | |

RLS: **No client-readable policy.** This table has zero RLS select/update/delete policies for authenticated users. Only the GCP engine (Supabase service role key) can read it. The Vercel app writes to it via a server-side API route using the service role, but never reads back.

**Encryption model (asymmetric):** The GCP engine holds an RSA-2048 private key. Vercel holds the corresponding public key. When a user submits their token, the Vercel API route encrypts it with the public key and writes the ciphertext to `secrets`. Only the GCP engine can decrypt. A Vercel compromise exposes only the encrypt capability — not the decryption key, not the stored tokens.

### `usage_snapshots`

One row per poll result per user. Same shape as current SQLite schema + `user_id`.

| Column | Type | Notes |
|--------|------|-------|
| `id` | bigint | Auto-increment PK |
| `user_id` | uuid | FK to `auth.users` |
| `timestamp` | timestamptz | |
| `status` | text | `'ok'` or `'error'` |
| `endpoint` | text | |
| `response_status` | int | |
| `raw_json` | jsonb | Full API response |
| `error_message` | text | |

Indexes: `(user_id, timestamp)`, `(user_id, status)`.

### `send_log`

One row per send attempt. Uses an execution key to prevent duplicate sends.

| Column | Type | Notes |
|--------|------|-------|
| `id` | bigint | Auto-increment PK |
| `user_id` | uuid | FK to `auth.users` |
| `execution_key` | text | Unique. Format: `{user_id}:{date}:{fire_index}` for scheduled, `cmd:{command_id}` for manual. |
| `fired_at` | timestamptz | |
| `scheduled_for` | timestamptz | NULL for manual sends |
| `is_anchor` | boolean | |
| `status` | text | `'claimed'`, `'ok'`, `'error'`, `'timeout'` |
| `duration_ms` | int | |
| `question` | text | |
| `response_excerpt` | text | |
| `error_message` | text | |

Unique constraint: `(execution_key)`.

**Send protocol:** Before firing a send, the engine inserts a `send_log` row with `status='claimed'` and the execution key. If the insert fails (unique violation), the send was already claimed — skip. After the send completes, update the row to `'ok'`, `'error'`, or `'timeout'`. On crash recovery, any `'claimed'` row older than 5 minutes is treated as a failed send and not retried (avoids double-send after crash).

### `schedules`

Computed schedule per user per day.

| Column | Type | Notes |
|--------|------|-------|
| `id` | bigint | Auto-increment PK |
| `user_id` | uuid | FK to `auth.users` |
| `date` | date | |
| `fires` | jsonb | Array of 5 fire time objects |
| `peak_block` | jsonb | `{start, end, midpoint}` |
| `generated_at` | timestamptz | |

Unique constraint: `(user_id, date)`.

### `user_settings`

Per-user overrides. Replaces the `app_meta` key-value pattern.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `user_id` | uuid | FK to `auth.users`, unique |
| `schedule_override_start_time` | text | NULL = use auto-detected peak |
| `peak_window_hours` | int | Default 4, range 3-6 |
| `anchor_offset_minutes` | int | Default 5, range 0-15 |
| `default_seed_time` | text | Default `'05:05'` |
| `paused` | boolean | Default `false` |

### `commands`

Ephemeral table for dashboard -> engine communication. Uses claim semantics to prevent duplicate execution.

| Column | Type | Notes |
|--------|------|-------|
| `id` | bigint | Auto-increment PK |
| `user_id` | uuid | FK to `auth.users` |
| `idempotency_key` | uuid | Client-generated, unique constraint. Prevents duplicate commands from retries. |
| `type` | text | `'send_now'`, `'recompute'` |
| `status` | text | `'pending'`, `'claimed'`, `'done'`, `'failed'` |
| `claimed_by` | text | Engine instance ID (for future multi-instance) |
| `claimed_at` | timestamptz | NULL until claimed |
| `created_at` | timestamptz | |

Unique constraint: `(idempotency_key)`.

**Execution protocol:** Engine picks up `pending` commands via Realtime. Before executing, it atomically transitions `status` from `'pending'` to `'claimed'` using a conditional update (`WHERE status = 'pending'`). If the update affects 0 rows, another instance already claimed it — skip. After execution, mark `'done'` or `'failed'`.

### Retention Policy

- `usage_snapshots`: Delete rows older than 30 days (nightly cron)
- `send_log`: Delete rows older than 90 days
- `commands`: Delete rows older than 24 hours
- Keeps Supabase well under the 500 MB free tier limit

## GCP Engine

### Process Architecture

A single Node.js process that manages all active users.

```
Engine Process
+------------------------------------------+
|  EngineManager                           |
|  - Connects to Supabase (service role)   |
|  - Loads all active users on startup     |
|  - Subscribes to Realtime for changes    |
|  - Manages UserAgent lifecycle           |
|                                          |
|  +-------------+ +-------------+        |
|  | UserAgent 1 | | UserAgent 2 | ...    |
|  | - poll loop | | - poll loop |        |
|  | - schedule  | | - schedule  |        |
|  | - sends     | | - sends     |        |
|  +-------------+ +-------------+        |
|                                          |
|  ScheduleRunner                          |
|  - 60s tick loop                         |
|  - Checks all agents for due fires      |
|  - Nightly recompute at 03:00 UTC       |
+------------------------------------------+
```

### `EngineManager`

- On startup: query all users with valid tokens, create a `UserAgent` per user
- Subscribe to Supabase Realtime on `profiles`, `user_settings`, `commands` tables
- On new user (token saved): create and start a new `UserAgent`
- On token update: restart that user's `UserAgent` with the new token
- On user deletion / token removal: stop and remove the `UserAgent`
- On settings change: update the `UserAgent`'s config
- On command (send_now, recompute): dispatch to the appropriate `UserAgent`

### `UserAgent`

One per active user. Owns:

- **Adaptive polling loop** — Same idle/light/active/burst state machine from the current codebase. Polls usage endpoint with the user's OAuth token. Writes snapshots to Supabase. Adaptive frequency: 30s (burst) to 10min (idle).
- **Schedule state** — Today's 5 fire times in memory. Loaded from `schedules` table on startup.
- **Send execution** — When a fire is due, calls Claude Agent SDK with the user's decrypted token. Sends a trivial Haiku message from the question rotation. Writes result to `send_log`.

### Nightly Recompute (03:00 UTC)

For each user:
1. Read historical `status='ok'` snapshots from Supabase (last 14 days)
2. Run `peakDetector()` — same pure function from Phase 2
3. Run `generateSchedule()` — same pure function from Phase 2
4. Write to `schedules` table (today + tomorrow)
5. Update `UserAgent`'s in-memory fire times

### Crash Recovery

- Process managed by systemd with `Restart=always`
- On restart, each `UserAgent` checks `send_log` for today
- Missed fire <15 minutes old: fire immediately
- Missed fire >=15 minutes old: skip
- Polling resumes from idle tier, ramps up naturally

### Memory Budget

| Component | Per-user | 50 users |
|-----------|----------|----------|
| UserAgent state | ~2-5 KB | ~250 KB |
| HTTP connections | ~50 KB | ~2.5 MB |
| Node.js process | ~100 MB | ~100 MB |
| **Total** | | **~103 MB** |

Well within 1 GB RAM + 2 GB swap.

## Vercel App

### One Next.js App, Three Zones

**Public zone (unauthenticated):**
- Landing page: explains the optimizer, value proposition, how it works
- Auth: Supabase Auth with email+password, Google OAuth, GitHub OAuth

**Onboarding zone (authenticated, no token):**
- Step 1: "Do you use Claude Code?" -> Yes / No
  - Yes: "Run this on each computer you use Claude Code on:" -> `npx claude-usage-optimizer connect` -> npm package extracts OAuth token + session history from `~/.claude/`, uploads to Supabase
  - No: Instructions to extract session cookie from claude.ai -> paste into form -> encrypted and stored
- Step 2: Timezone selection (auto-detected, user-confirmable)
- On token save: GCP engine picks up via Realtime, starts polling

**Dashboard zone (authenticated, token configured):**
- All existing dashboard panels, reading from Supabase with user's auth session (RLS):
  - Peak block + schedule card with live countdown
  - Today's 5 fires (pending/fired/failed status)
  - Tomorrow's schedule preview
  - Send history (last 20 entries)
  - Overrides form
  - Pause toggle
  - Send Now button
  - Usage heatmap, hourly bars, usage timeline
- Reads: direct Supabase client queries (no API routes needed, RLS handles scoping)
- Writes: Next.js API routes that write to Supabase (settings, commands)

## npm Package (`claude-usage-optimizer`)

Lightweight CLI tool. Not a daemon — runs once, uploads, exits.

**What it does:**
1. Prompts for login or accepts an auth token from the website
2. Reads `~/.claude/.credentials.json` for OAuth token
3. Reads local Claude Code session history for timestamps + token counts (bootstraps peak detection from day one)
4. Uploads everything to Supabase via the user's auth session (deduplicated — see below)
5. Exits

**Re-run on additional machines:** Each machine may have different session history. User runs the package on each computer they use Claude Code on.

**Future:** Could optionally be re-run periodically for fresh local data, but the server handles all ongoing tracking.

**Deduplication model:** Each historical event uploaded includes a stable `source_id` composed of `{machine_id}:{session_id}:{timestamp}`. The `machine_id` is a hash of the machine's hostname + Claude Code install path (stable across re-runs on the same machine). Events are upserted on `(user_id, source_id)` — if the same event is uploaded again (same machine, same session, same timestamp), it overwrites rather than duplicates. This ensures:
- Re-running on the same machine is safe (idempotent)
- Running on a second machine with overlapping history doesn't double-count
- Peak detection sees each real usage event exactly once

## Security

### Token Handling

- OAuth tokens grant access to the user's Claude account — high-sensitivity data
- **Physical separation:** Tokens live in the `secrets` table, which has no client-readable RLS policy. The `profiles` table (which the dashboard reads) contains only a `token_status` field — never the token itself.
- **Asymmetric encryption:** RSA-2048 keypair. GCP engine holds the private key (decrypt). Vercel holds only the public key (encrypt). A Vercel compromise exposes the encrypt capability but cannot decrypt stored tokens.
- **Write path:** User submits token -> Vercel API route encrypts with public key -> writes ciphertext to `secrets` table via service role -> updates `profiles.token_status` to `'configured'`.
- **Read path:** Only the GCP engine (service role + private key) can read and decrypt from `secrets`.
- **Token rotation:** Re-running `npx claude-usage-optimizer connect` overwrites the `secrets` row. Engine picks up change via Realtime subscription on `secrets`.

### Network

- GCP engine: no public-facing ports. Outbound only (Supabase + Anthropic API).
- Vercel app: public, but all data gated by Supabase Auth + RLS.
- All connections over HTTPS/TLS.

### npm Package

- Reads local `~/.claude/` credentials
- Transmits over HTTPS to Supabase using the user's authenticated session
- Does not persist anything locally beyond what Claude Code already stores

## Constraints & Limits

### Free Tier Boundaries

| Resource | Limit | Impact |
|----------|-------|--------|
| GCP e2-micro | 1 GB RAM + 2 GB swap | ~30-50 concurrent active users |
| Supabase free | 500 MB database, 50K auth users, 1 GB bandwidth/day | 500 MB is the binding constraint. Retention policy keeps it under control. |
| Vercel free | 100 GB bandwidth, 1M function invocations | Comfortable for <50 users |

### Storage Budget

At 50 users, ~1 KB/snapshot, ~288 polls/day average:
- Daily: 50 * 288 * 1 KB = ~14 MB
- 30-day retention: ~420 MB (tight but viable with pruning)
- At 30 users with retention: ~250 MB (comfortable)

### Rate Limiting

- One polling loop per user max
- Sends: 5 scheduled + 5 manual per day per user
- Signup: Supabase Auth default rate limits

### Scaling Path

At ~50 users, upgrade GCP to e2-small (~$5/month, 2 GB RAM). At that point, consider charging a small fee or accepting donations to cover costs.

## What Stays the Same

The core algorithms from the current roadmap (Phases 2-4) are reused as-is:

- **Peak detection** (`peak-detector.ts`) — pure function, no changes
- **Schedule generation** (`schedule.ts`) — pure function, no changes
- **Adaptive polling state machine** — same tier logic, now instantiated per user
- **Send execution** — same concept, Claude Agent SDK instead of CLI spawn

## What Changes vs. Current Roadmap

| Current (self-hosted) | SaaS |
|-----------------------|------|
| SQLite on disk | Supabase Postgres |
| `app_meta` key-value store | `user_settings` + `schedules` tables |
| Single `UsageCollector` singleton | Per-user `UserAgent` managed by `EngineManager` |
| `child_process.spawn('claude')` | Claude Agent SDK with per-user OAuth token |
| `127.0.0.1:3018` dashboard | Vercel-hosted dashboard with Supabase Auth |
| `curl \| bash` installer + systemd | Website signup + npm package for token collection |
| `.env.local` config | Supabase `profiles` + `user_settings` |
| Nightly GCS backup | Supabase managed backups (free tier: weekly) |

## Phases (Revised)

The existing Phase 1 (Foundation & DB Refactor) work is still valuable — the pure-function patterns and test suite carry forward. The roadmap shifts to:

1. **Phase 1: Foundation & DB Refactor** — DONE (tests, patterns, conventions carry forward)
2. **Phase 2: Algorithm Core** — Same as current. Pure functions for peak detection + schedule generation. No changes needed.
3. **Phase 3: Supabase Setup** — Schema, RLS policies, auth configuration, token encryption utilities
4. **Phase 4: GCP Engine** — `EngineManager`, `UserAgent`, adaptive polling, schedule executor, Claude Agent SDK integration, Realtime subscriptions
5. **Phase 5: Vercel App** — Landing page, auth flow, onboarding wizard, per-user dashboard
6. **Phase 6: npm Package** — `claude-usage-optimizer` CLI for token + history collection
7. **Phase 7: Deployment & Hardening** — GCP systemd setup, monitoring, error notifications, retention cron jobs
8. **Phase 8: Quality & Acceptance** — End-to-end testing, load testing with simulated users, documentation
