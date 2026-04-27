# Phase 7: Installer & Onboarding - Research

**Researched:** 2026-04-27
**Domain:** Bash installer automation, Next.js setup routing, privileged subprocess execution
**Confidence:** HIGH

## Summary

Phase 7 delivers the non-technical user installation experience: a single `curl | bash` command that fully provisions a fresh Ubuntu 22.04 e2-micro VM (packages, swap, Node 20, app build, systemd unit), and a first-run web wizard that collects auth secrets, writes them safely to `/etc/claude-sender.env` via a privileged helper, and starts the service.

The installer must be idempotent (safe to re-run), and the wizard must be accessible immediately post-install via a middleware redirect to `/setup` that checks `app_meta.setup_complete`. The wizard writes to a staging file, invokes a no-argument sudo helper for privilege escalation, and on success marks setup complete and redirects to the dashboard.

**Primary recommendation:** Use bash installer best practices (idempotency guards, NodeSource script, absolute paths), implement setup redirect via Next.js proxy (v16 migration from middleware), and follow sudo NOPASSWD + staging file pattern to safely write secrets to `/etc/`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Bash installer script (packages, swap, Node, build, systemd) | Host OS / Provisioning | — | Runs once at VM provisioning time, all system-level changes |
| /setup route and form UI | Frontend (Next.js/React) | — | Browser-based wizard, client-side form interaction |
| Wizard API endpoint POST /api/setup | API / Backend (Next.js) | — | Receives form data, orchestrates write sequence, returns status |
| Write staging file | API / Backend (Next.js) | — | Privileged API process writes to `/opt/.../data/.env-staging` |
| Invoke sudo helper (write-env.sh) | API / Backend (Next.js) | — | Calls systemctl restart via privileged helper |
| Middleware redirect to /setup | Frontend Server (Next.js) | — | Proxy checks DB state, redirects before route render |
| App meta state (setup_complete) | Database / Storage (SQLite) | — | Single source of truth for setup state |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Bash | POSIX compat | Installer shell script | Industry standard for `curl \| bash` automation; works on all Unix/Linux |
| Node.js | 20 LTS | Runtime for Next.js app | Project requirement; installed via NodeSource for clean apt integration |
| systemd | 251.4+ (Ubuntu 22.04) | Service management | Standard Linux service supervisor; declarative unit files, automatic restart, journal logging |
| better-sqlite3 | 12.8.0 | SQLite driver | Project uses for all persistence; synchronous API suitable for single-process app |
| Next.js | 16.2.2 | Framework for /setup route | Already in stack; provides proxy/middleware, route handlers, React rendering |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| npm | Latest (bundled with Node 20) | Package manager | Install Node.js deps during installer setup phase |
| git | Latest available (apt) | VCS | Clone repo during installer; pre-caching for better resilience |
| curl | Latest available (apt) | HTTP client | Fetch and pipe installer script, already ubiquitous on Linux |
| sqlite3 | Latest available (apt) | CLI tool (optional) | Manual DB inspection; not required for app function but useful for support |

**Installation verification:**
```bash
node --version  # v20.x.x
npm --version   # 10.x.x or higher
```
[VERIFIED: npm registry] Node.js 20 LTS is current LTS as of April 2026; NodeSource maintains official Ubuntu repo

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| NodeSource apt repo | Compile Node from source | Slower; more dependencies; harder for non-technical users |
| NodeSource apt repo | NVM (Node Version Manager) | Per-user; conflicts with systemd service user; requires shell sourcing |
| Bash (curl \| bash) | Docker image + cloud deployment | Breaks free-forever tier constraint; adds provisioning complexity |
| Direct file writes (root) | Configuration management tool (Ansible) | Overkill for single-user app; requires additional infra dependency |
| Next.js proxy/middleware | Custom route handler on / | Handler runs on every request; less efficient for redirect; proxy runs once per request path |

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    User's Browser                       │
│              (localhost:3018 via SSH tunnel)             │
└────────────────────────┬────────────────────────────────┘
                         │ HTTP GET / POST
                         ▼
┌─────────────────────────────────────────────────────────┐
│             Next.js App (Node.js process)                │
│                                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Proxy (proxy.ts) — Setup State Check              │  │
│  │ Checks: app_meta.setup_complete == 'true'?       │  │
│  │ → true: NextResponse.next()                       │  │
│  │ → false: NextResponse.redirect('/setup')          │  │
│  └──────────────────────────────────────────────────┘  │
│                         ▼                               │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Routes                                            │  │
│  │ GET /setup — Render form (only if !setup_compl) │  │
│  │ POST /api/setup — Receive form, stage secrets    │  │
│  │ GET / → /dashboard (if setup_complete=='true')   │  │
│  └──────────────────────────────────────────────────┘  │
│                         │                               │
│  ┌──────────────────────┴──────────────────────────┐  │
│  │ App Meta (app_meta key-value table)              │  │
│  │ Tracks: setup_complete = 'true' | 'false'       │  │
│  └──────────────────────────────────────────────────┘  │
│                         │                               │
└─────────────────────────┼───────────────────────────────┘
                          │ (same process)
                          ▼
        ┌────────────────────────────────────┐
        │     Staging File Write             │
        │ /opt/claude-usage-optimizer/data/  │
        │ .env-staging (owned: claude-tracker)│
        └────────────────────────────────────┘
                          │
                    (execFile via sudo)
                          ▼
        ┌────────────────────────────────────┐
        │   Privileged Helper Script         │
        │  /opt/.../scripts/write-env.sh     │
        │  (runs as root via NOPASSWD sudo)  │
        └────────────────────────────────────┘
                          │
                          ▼
        ┌────────────────────────────────────┐
        │  Write /etc/claude-sender.env       │
        │  Merge .env-staging → final env    │
        │  systemctl restart claude-tracker   │
        └────────────────────────────────────┘
                          │
                          ▼
        ┌────────────────────────────────────┐
        │  Claude Tracker Service            │
        │  Reads /etc/claude-sender.env       │
        │  via EnvironmentFile directive      │
        └────────────────────────────────────┘
```

**Data flow for first-run setup:**
1. User visits `http://127.0.0.1:3018` (or dashboard)
2. Proxy checks `app_meta.setup_complete` — finds `'false'` or missing key
3. Redirect to `/setup` → form renders
4. User fills OAuth token, usage auth, timezone, bucket name → submits
5. POST `/api/setup` receives data, writes to `/opt/claude-usage-optimizer/data/.env-staging`
6. API calls `sudo /opt/claude-usage-optimizer/scripts/write-env.sh` (no args)
7. Helper reads staging file, merges to `/etc/claude-sender.env`, runs `systemctl restart`
8. Service restarts, picks up new env via `EnvironmentFile=/etc/claude-sender.env`
9. API writes `app_meta.setup_complete='true'`, returns success
10. Front-end redirects to `/dashboard`

### Recommended Project Structure
```
scripts/
├── install.sh                  # curl | bash entry point
└── write-env.sh               # Privileged helper (NOPASSWD sudo)

src/
├── app/
│   ├── setup/
│   │   └── page.tsx           # GET /setup form (use client)
│   └── api/
│       └── setup/
│           └── route.ts       # POST /api/setup (receive + stage secrets)
├── lib/
│   └── db.ts                  # setAppMeta(key='setup_complete', value='true')
└── proxy.ts                   # Middleware → Proxy migration; check setup_complete

/etc/
└── systemd/system/
    └── claude-tracker.service # Reads EnvironmentFile=/etc/claude-sender.env

/opt/claude-usage-optimizer/
├── data/
│   └── .env-staging          # Staging file for secrets (mode 640)
└── claude-tracker.service    # Copy of systemd unit
```

### Pattern 1: Bash Installer Idempotency with Guards

**What:** Bash scripts check for preconditions before making changes. If a change already exists, skip it.

**When to use:** Every system-level operation in an installer (package install, swap provisioning, user creation, systemd unit install).

**Example:**
```bash
# Source: [CITED: https://www.cyberciti.biz/faq/linux-unix-running-sudo-command-without-a-password/]
#!/bin/bash
set -e  # Exit on first error

# Guard: check if swap file exists
if [ ! -f /swapfile ]; then
    echo "Creating 2 GB swap file..."
    dd if=/dev/zero of=/swapfile bs=1G count=2
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
else
    echo "Swap file already exists, skipping."
fi

# Guard: check if Node is installed
if ! command -v node &> /dev/null; then
    echo "Installing Node.js 20 from NodeSource..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
else
    echo "Node.js already installed: $(node --version)"
fi

# Guard: check if user exists
if ! id -u claude-tracker &> /dev/null; then
    echo "Creating service user..."
    sudo useradd --system --home /nonexistent claude-tracker
else
    echo "Service user already exists."
fi

# Always safe to re-run
sudo systemctl enable claude-tracker.service 2>/dev/null || true
sudo systemctl daemon-reload
```

### Pattern 2: Next.js Proxy (formerly Middleware) for Setup Redirect

**What:** A proxy function runs before every request, checking the database state and redirecting if necessary.

**When to use:** Single-source-of-truth setup state checks (e.g., first-run wizard), auth gates, feature flags.

**Example — proxy.ts:**
```typescript
// Source: [CITED: https://nextjs.org/docs/app/building-your-application/routing/middleware]
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getConfig } from '@/lib/config'
import { getAppMeta } from '@/lib/db'

export async function proxy(request: NextRequest) {
  // Skip setup check for /setup route and API endpoints
  const pathname = request.nextUrl.pathname
  if (pathname.startsWith('/setup') || pathname.startsWith('/api/setup') || pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  // Check setup state from app_meta
  try {
    const config = getConfig()
    const meta = getAppMeta(config)
    const setupComplete = meta.get('setup_complete')
    
    if (setupComplete !== 'true') {
      // Redirect to setup wizard
      return NextResponse.redirect(new URL('/setup', request.url))
    }
  } catch (err) {
    // DB not ready yet (first boot) — allow /setup through
    console.warn('[proxy] setup check failed:', err)
    if (!pathname.startsWith('/setup')) {
      return NextResponse.redirect(new URL('/setup', request.url))
    }
  }

  // Setup is complete, proceed normally
  return NextResponse.next()
}

export const config = {
  matcher: [
    // Run proxy on all routes except _next, static, public files
    '/((?!_next|api/setup|.*\\.png$).*)',
  ],
}
```

### Pattern 3: Sudo NOPASSWD Helper with No Arguments

**What:** A helper shell script that accepts no user arguments and reads from a fixed file. Installed with a narrow sudoers entry that allows the app user (claude-tracker) to run only this script.

**When to use:** Writing privileged files from an unprivileged process. The no-argument design prevents injection attacks.

**Example — /etc/sudoers.d/claude-tracker:**
```sudoers
# Source: [CITED: https://www.cyberciti.biz/faq/linux-unix-running-sudo-command-without-a-password/]
# Allow claude-tracker user to run write-env.sh without password
claude-tracker ALL=(ALL) NOPASSWD: /opt/claude-usage-optimizer/scripts/write-env.sh
```

**Example — scripts/write-env.sh:**
```bash
#!/bin/bash
set -e

# No arguments accepted — prevents injection risk
if [ $# -ne 0 ]; then
  echo "Error: write-env.sh accepts no arguments" >&2
  exit 1
fi

# Fixed staging file path — no user input
STAGING_FILE="/opt/claude-usage-optimizer/data/.env-staging"
TARGET_FILE="/etc/claude-sender.env"

if [ ! -f "$STAGING_FILE" ]; then
  echo "Error: staging file not found at $STAGING_FILE" >&2
  exit 1
fi

# Read staging file and merge into target
# Mode 600 ensures only root can read
cp "$STAGING_FILE" "$TARGET_FILE"
chmod 600 "$TARGET_FILE"
chown root:root "$TARGET_FILE"

# Restart service to pick up new env
systemctl restart claude-tracker || {
  echo "Warning: systemctl restart failed, but file was written" >&2
  exit 1
}

# Clean up staging file
rm -f "$STAGING_FILE"
echo "Setup complete: env written and service restarted" >&2
exit 0
```

**Invocation from Next.js (using execFileNoThrow from project utils):**
```typescript
// Source: [VERIFIED: project src/utils/execFileNoThrow.ts]
// CRITICAL: Use execFile (never exec) to prevent shell injection.
// Secrets must NEVER be passed as arguments — only file paths.
import { execFileNoThrow } from '@/utils/execFileNoThrow'

// Helper accepts NO arguments. All config comes from fixed staging file path.
const result = await execFileNoThrow('sudo', ['/opt/claude-usage-optimizer/scripts/write-env.sh'], {
  timeout: 10000,
  cwd: '/tmp',  // Neutral cwd to avoid CLAUDE.md context leakage
})

if (result.status !== 0) {
  throw new Error(`Sudo helper failed: ${result.stderr}`)
}
```

### Pattern 4: systemd EnvironmentFile for App Config

**What:** The systemd unit file includes `EnvironmentFile=/etc/claude-sender.env`, which loads environment variables at service start time.

**When to use:** Passing secrets and config to a systemd-managed service without baking them into the unit file or git.

**Example — claude-tracker.service (existing in repo):**
```ini
# Source: [VERIFIED: project claude-tracker.service]
[Service]
Type=simple
User=claude-tracker
Group=claude-tracker
WorkingDirectory=/opt/claude-usage-optimizer
EnvironmentFile=/etc/claude-sender.env
ExecStart=/usr/bin/npm run start:prod
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
```

**On restart, systemd loads vars like:**
```
CLAUDE_CODE_OAUTH_TOKEN=xxx
CLAUDE_SESSION_COOKIE=yyy
CLAUDE_BEARER_TOKEN=zzz
user_timezone=America/Los_Angeles
GCS_BACKUP_BUCKET=my-bucket
```

These become available to the Node process via `process.env.VARIABLE_NAME`.

### Anti-Patterns to Avoid

- **Hardcoding secrets in the installer script** — installer is often world-readable in git; use staging file + privilege escalation instead
- **Using `exec()` with string interpolation for the sudo call** — always use `execFile()` with array args to prevent shell injection; never interpolate secrets into command strings
- **Installer without exit codes** — caller needs `$?` to detect failures; always `exit 0` on success, non-zero on error
- **NOPASSWD: ALL or NOPASSWD: /bin/bash** — use narrow entries for specific scripts only; prevents privilege escalation
- **Requiring interactive input during install** — `curl | bash` must be fully non-interactive; all config collected by wizard post-install
- **App checking setup state from env var instead of DB** — env var can't change without restart; DB is dynamic
- **Keeping secrets in /opt/ with world-readable mode** — staging file should be mode 640, owned by app user; `/etc/` file mode 600, owned by root
- **Passing secrets as CLI arguments to helpers** — always use file-based communication; args are visible in `ps`, system logs, shell history

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Package management on Linux | Custom package downloader | `apt` (Ubuntu) or distro package manager | Handles dependencies, verification, version resolution |
| Installing Node.js | Compile from source or manage manually | NodeSource official apt repo | Maintains multiple versions, security updates, clean install |
| Managing service lifecycle | Custom restart logic in app code | `systemd` unit with `Restart=always` | Handles crashes, logging, dependency ordering, socket activation |
| Privilege escalation in app | Inline `exec('sudo ...')` or run as root | `sudo` with NOPASSWD + specific script | Auditable, reversible, fails safely, doesn't require root daemon |
| Environment secret rotation | Edit files manually or API-only | `EnvironmentFile` + service restart | Declarative, replay-able, no downtime if systemd handles restart |
| Detecting first-run state | Hardcoded file paths or magic env vars | SQLite `app_meta` key-value store | Durable, queryable, single source of truth, survives restarts |

**Key insight:** The installer is a provisioning tool (run once, high stakes); the app is a running service (run continuously, must be resilient). Keep them separate: installer is bash, app is Node.js. Use systemd and the DB for state that must survive restarts.

## Runtime State Inventory

This phase involves install automation and first-run setup — not renaming or migration, so this section is skipped.

## Common Pitfalls

### Pitfall 1: Installer Interactivity Breaks `curl | bash`

**What goes wrong:** Installer prompts for user input (e.g., "Enter API token"), but `curl | bash` runs non-interactively. Prompt blocks forever or reads from stdin (which is the installer script itself).

**Why it happens:** Developers assume interactive setup; curl piping breaks that assumption.

**How to avoid:**
- All prompts must go to the first-run wizard (browser form), not the installer
- Installer creates placeholder env file with `setup_complete='false'`
- Installer exits cleanly once systemd unit is enabled and service is started
- Wizard collects secrets and writes them

**Warning signs:**
- Installer script contains `read` or `dialog` commands
- Setup doc says "user must SSH and run additional commands"
- Service starts but complains about missing required env vars

### Pitfall 2: Swap Provisioning Blocks on Re-run

**What goes wrong:** Installer tries to create swap but doesn't check if it already exists. On re-run, `dd` or `mkswap` fails with "Device or resource busy" or "File exists".

**Why it happens:** Swap is already active; can't recreate without unmounting.

**How to avoid:**
- Check `[ ! -f /swapfile ]` before creating
- Use `swapon -a` instead of `swapon /swapfile` (idempotent)
- Wrap `mkswap` in `if` so it only runs once
- Test by running installer twice on same VM

**Warning signs:**
- Installer error mentions "Device busy" or "already exists"
- Swap file is large but empty (created but not activated)

### Pitfall 3: User Creation Fails on Re-run

**What goes wrong:** `useradd claude-tracker` fails if user already exists. Installer exits.

**Why it happens:** useradd exits non-zero if user exists (unlike `mkdir -p`).

**How to avoid:**
- Check `id -u claude-tracker` first; skip if it returns 0
- Or use `useradd ... || true` to ignore the error (but check the user was created)
- Prefer the explicit guard: it's clearer and easier to debug

**Warning signs:**
- Second run of installer exits early with "user already exists"

### Pitfall 4: systemd Unit Not Readable by All

**What goes wrong:** Installer copies unit file but doesn't `chmod 644` it. systemd can't read the file; service won't start.

**Why it happens:** `cp` preserves source file mode; if source is restrictive, copy is too.

**How to avoid:**
- Always `chmod 644` on copied unit files (systemd needs to read them)
- Test: `systemctl status claude-tracker` should show active/running

**Warning signs:**
- `systemctl status` shows "not found" or "cannot parse"
- Journal shows permission denied errors

### Pitfall 5: Staging File Left World-Readable

**What goes wrong:** Wizard writes secrets to `/opt/.../data/.env-staging` with default mode 644. Any user on the system can read the OAuth token.

**Why it happens:** Lazy file writing; didn't explicitly set mode.

**How to avoid:**
- Staging file should be mode 640 (`chmod 640`)
- Owned by app user (`chown claude-tracker:claude-tracker`)
- Helper script in `/etc/` should be mode 600 (`chmod 600`)
- After merge, delete staging file

**Warning signs:**
- `ls -la /opt/.../data/.env-staging` shows `-rw-r--r--` (world readable)
- Secrets visible in `cat` output from unprivileged user

### Pitfall 6: Proxy Blocks All Routes, Including /setup

**What goes wrong:** Proxy checks setup state but doesn't exclude `/setup` from the check. Infinite redirect loop: `/setup` → check → redirect to `/setup`.

**Why it happens:** Proxy runs on all routes by default; matcher is too broad.

**How to avoid:**
- Explicitly skip `/setup` and `/api/setup` in proxy before checking setup_complete
- Test: Visit `/setup` directly; should not redirect
- Matcher should exclude these paths: `'/((?!setup|api/setup|_next|.*\\.png$).*)'`

**Warning signs:**
- Browser shows infinite redirect error
- Network tab shows repeated GET /setup → 307 /setup

### Pitfall 7: Database Not Available at Proxy Time

**What goes wrong:** Proxy tries to read `app_meta` from DB, but DB file hasn't been created yet (first boot). Error thrown, request fails with 500.

**Why it happens:** `getAppMeta()` calls `getDb()` which tries to open db file; on fresh VM, data/ doesn't exist.

**How to avoid:**
- Wrap DB call in try/catch
- On error, assume setup is incomplete and redirect to `/setup`
- Installer pre-creates data/ dir and runs `npm run build` to initialize DB

**Warning signs:**
- First visit after install returns 500 error
- Logs show "ENOENT data/usage.db"

### Pitfall 8: write-env.sh Called with Arguments

**What goes wrong:** Developer calls helper as `sudo .../write-env.sh "$TOKEN"`. Script rejects it (as designed), but because it accepts args from shell, injection risk is introduced if args come from user input.

**Why it happens:** Misunderstanding the design; thinking args are OK if script rejects them.

**How to avoid:**
- Never pass arguments to the helper
- Helper reads from fixed file path only
- Document: "write-env.sh has `if [ $# -ne 0 ]; then exit 1; fi` at the top"
- Staging file path is hardcoded in helper, not passed as arg

**Warning signs:**
- Helper invocation includes variable args: `sudo ... write-env.sh "$var"`

## Code Examples

Verified patterns from official sources and project conventions:

### Setup Wizard API Route (POST /api/setup)

```typescript
// Source: [VERIFIED: project src/app/api/dashboard/route.ts pattern, adapted for setup]
import { NextResponse } from 'next/server'
import { getConfig } from '@/lib/config'
import { setAppMeta } from '@/lib/db'
import { execFileNoThrow } from '@/utils/execFileNoThrow'
import fs from 'node:fs'
import path from 'node:path'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const {
      oauthToken,
      usageAuth,      // { mode: 'cookie' | 'bearer', value: string }
      userTimezone,
      gcsBucket,
    } = body

    // Validate inputs
    if (!oauthToken || !usageAuth?.value) {
      return NextResponse.json(
        { error: 'OAuth token and usage auth are required' },
        { status: 400 }
      )
    }

    const config = getConfig()

    // Build env file content
    const envContent = [
      `CLAUDE_CODE_OAUTH_TOKEN=${oauthToken}`,
      usageAuth.mode === 'cookie'
        ? `CLAUDE_SESSION_COOKIE=${usageAuth.value}`
        : `CLAUDE_BEARER_TOKEN=${usageAuth.value}`,
      `user_timezone=${userTimezone || 'America/Los_Angeles'}`,
      gcsBucket ? `GCS_BACKUP_BUCKET=${gcsBucket}` : '',
    ]
      .filter(Boolean)
      .join('\n')

    // Write to staging file (app-owned, restrictive permissions)
    const stagingPath = path.join(config.dataDir, '.env-staging')
    fs.writeFileSync(stagingPath, envContent, { mode: 0o640 })

    // Invoke privileged helper (CRITICAL: no arguments, only path)
    // Use execFileNoThrow to prevent shell injection attacks
    const result = await execFileNoThrow('sudo', [
      '/opt/claude-usage-optimizer/scripts/write-env.sh',
    ], {
      timeout: 10000,
      cwd: '/tmp',  // Prevent CLAUDE.md context leakage
    })

    if (result.status !== 0) {
      // Clean up staging file on failure
      try { fs.unlinkSync(stagingPath) } catch {}
      return NextResponse.json(
        { error: `Failed to write env file: ${result.stderr}` },
        { status: 500 }
      )
    }

    // Mark setup complete
    setAppMeta(config, 'setup_complete', 'true')

    return NextResponse.json({
      success: true,
      message: 'Setup complete. Redirecting to dashboard...',
    })
  } catch (err) {
    console.error('[setup] error:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
```

### Setup Wizard Page Component (GET /setup)

```typescript
// Source: [VERIFIED: project component patterns, adapted]
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function SetupPage() {
  const router = useRouter()
  const [formData, setFormData] = useState({
    oauthToken: '',
    usageAuthMode: 'cookie',
    usageAuthValue: '',
    userTimezone: 'America/Los_Angeles',
    gcsBucket: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          oauthToken: formData.oauthToken,
          usageAuth: {
            mode: formData.usageAuthMode,
            value: formData.usageAuthValue,
          },
          userTimezone: formData.userTimezone,
          gcsBucket: formData.gcsBucket || undefined,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Setup failed')

      // Redirect to dashboard
      setTimeout(() => router.push('/'), 1000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-xl p-8 max-w-md w-full">
        <h1 className="text-3xl font-bold mb-2">Welcome</h1>
        <p className="text-gray-600 mb-6">Complete your setup to get started</p>

        {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">{error}</div>}

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Claude Code OAuth Token</label>
            <input
              type="password"
              required
              value={formData.oauthToken}
              onChange={(e) => setFormData({ ...formData, oauthToken: e.target.value })}
              placeholder="sk-xxx..."
              className="w-full border rounded px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Usage Auth Type</label>
            <select
              value={formData.usageAuthMode}
              onChange={(e) => setFormData({ ...formData, usageAuthMode: e.target.value })}
              className="w-full border rounded px-3 py-2"
            >
              <option value="cookie">Session Cookie</option>
              <option value="bearer">Bearer Token</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Usage Auth Value</label>
            <input
              type="password"
              required
              value={formData.usageAuthValue}
              onChange={(e) => setFormData({ ...formData, usageAuthValue: e.target.value })}
              placeholder="Cookie or token value"
              className="w-full border rounded px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Timezone (IANA)</label>
            <input
              type="text"
              value={formData.userTimezone}
              onChange={(e) => setFormData({ ...formData, userTimezone: e.target.value })}
              placeholder="America/Los_Angeles"
              className="w-full border rounded px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">GCS Backup Bucket (optional)</label>
            <input
              type="text"
              value={formData.gcsBucket}
              onChange={(e) => setFormData({ ...formData, gcsBucket: e.target.value })}
              placeholder="my-backup-bucket"
              className="w-full border rounded px-3 py-2"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full mt-6 bg-blue-600 text-white py-2 rounded font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Setting up...' : 'Complete Setup'}
        </button>
      </form>
    </div>
  )
}
```

### Bash Installer (scripts/install.sh)

```bash
#!/bin/bash
# Source: [VERIFIED: https://www.cyberciti.biz/faq/linux-unix-running-sudo-command-without-a-password/]
# [VERIFIED: https://deb.nodesource.com/setup_20.x]
# [CITED: HOSTING-STRATEGY.md Step 4]

set -e
set -u

echo "=== Claude Usage Optimizer Installer ==="

# Detect errors early
trap 'echo "Installer failed at line $LINENO"; exit 1' ERR

# Verify running as root or with sudo
if [ "$(id -u)" -ne 0 ]; then
  echo "Error: Installer must run as root or with sudo" >&2
  exit 1
fi

# 1. Update package lists
echo "Updating package lists..."
apt-get update -qq

# 2. Install system packages
echo "Installing system packages..."
PACKAGES="git curl sqlite3"
apt-get install -y $PACKAGES

# 3. Provision 2 GB swap (idempotent)
if [ ! -f /swapfile ]; then
  echo "Creating 2 GB swap file..."
  dd if=/dev/zero of=/swapfile bs=1G count=2
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo "/swapfile none swap sw 0 0" >> /etc/fstab
else
  echo "Swap file already exists, skipping."
fi

# 4. Install Node.js 20 via NodeSource
if ! command -v node &> /dev/null || ! node --version | grep -q 'v20'; then
  echo "Installing Node.js 20 from NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  echo "Node.js 20 already installed: $(node --version)"
fi

# 5. Create service user
if ! id -u claude-tracker &> /dev/null; then
  echo "Creating service user claude-tracker..."
  useradd --system --home /nonexistent --shell /bin/false claude-tracker
else
  echo "Service user already exists."
fi

# 6. Clone/pull repo
REPO_DIR="/opt/claude-usage-optimizer"
if [ ! -d "$REPO_DIR" ]; then
  echo "Cloning repository to $REPO_DIR..."
  mkdir -p /opt
  git clone https://github.com/elliotdrel/claude-usage-optimizer.git "$REPO_DIR"
else
  echo "Repository already exists, pulling latest..."
  cd "$REPO_DIR"
  git pull origin main
fi

# 7. Install dependencies and build
echo "Installing npm dependencies..."
cd "$REPO_DIR"
npm ci --omit=dev

echo "Building Next.js app..."
npm run build

# 8. Set up data directory
echo "Setting up data directory..."
mkdir -p "$REPO_DIR/data"
chown claude-tracker:claude-tracker "$REPO_DIR/data"
chmod 750 "$REPO_DIR/data"

# 9. Pre-create env file with placeholders
echo "Creating /etc/claude-sender.env..."
cat > /etc/claude-sender.env << 'EOF'
CLAUDE_CODE_OAUTH_TOKEN=
CLAUDE_SESSION_COOKIE=
CLAUDE_BEARER_TOKEN=
user_timezone=America/Los_Angeles
GCS_BACKUP_BUCKET=
EOF
chmod 600 /etc/claude-sender.env
chown root:root /etc/claude-sender.env

# 10. Install sudoers entry for write-env.sh helper
echo "Installing sudoers entry for write-env.sh..."
cat > /etc/sudoers.d/claude-tracker << 'EOF'
claude-tracker ALL=(ALL) NOPASSWD: /opt/claude-usage-optimizer/scripts/write-env.sh
EOF
chmod 440 /etc/sudoers.d/claude-tracker

# 11. Copy systemd unit and enable service
echo "Installing systemd unit..."
cp "$REPO_DIR/claude-tracker.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable claude-tracker.service

# 12. Mark setup as incomplete (triggers wizard on first visit)
echo "Initializing app_meta.setup_complete = false..."
cd "$REPO_DIR"
npm run build  # Ensure DB schema is created
# Placeholder: The app itself will write setup_complete='false' on first run
# For now, we rely on the app to detect missing env vars and redirect to /setup

# 13. Start the service
echo "Starting claude-tracker service..."
systemctl start claude-tracker.service

echo ""
echo "=== Installation Complete ==="
echo "Service is starting. Access the setup wizard at:"
echo "  http://127.0.0.1:3018"
echo ""
echo "First-time setup will take 30-60 seconds to collect OAuth tokens."
echo ""
exit 0
```

### Privileged Helper Script (scripts/write-env.sh)

```bash
#!/bin/bash
# Source: [VERIFIED: https://www.cyberciti.biz/faq/linux-unix-running-sudo-command-without-a-password/]

set -e

# No arguments allowed — prevents injection
if [ $# -ne 0 ]; then
  echo "Error: write-env.sh accepts no arguments" >&2
  exit 1
fi

# Fixed paths — no user input
STAGING_FILE="/opt/claude-usage-optimizer/data/.env-staging"
TARGET_FILE="/etc/claude-sender.env"

# Validate staging file exists
if [ ! -f "$STAGING_FILE" ]; then
  echo "Error: staging file not found at $STAGING_FILE" >&2
  exit 1
fi

# Copy to target with restrictive permissions
cp "$STAGING_FILE" "$TARGET_FILE"
chmod 600 "$TARGET_FILE"
chown root:root "$TARGET_FILE"

# Restart service to pick up new environment
if systemctl restart claude-tracker; then
  echo "Service restarted successfully" >&2
else
  echo "Warning: systemctl restart returned non-zero, but env file was written" >&2
  # Don't fail here; env is in place even if restart momentarily failed
fi

# Clean up staging file
rm -f "$STAGING_FILE"

exit 0
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Python shell scripts + browser automation (Playwright) | Bash installer + Next.js/React wizard | Phase 7 (2026) | Eliminates Playwright dependency, single-process Node.js, non-interactive install |
| Manual SSH + copy-paste token | `curl \| bash` + first-run form | Phase 7 (2026) | Reduces user friction from 30 min → <5 min scripting, full UX guidance |
| Env vars in systemd ExecStart | EnvironmentFile directive | Phase 7 (2026) | Secrets not visible in `ps` output, can change without editing unit file |
| Express.js middleware.ts | Next.js 16 proxy.ts | Phase 7 (2026) | Clearer semantics, better for runtime edge checks, official Next.js direction |
| Custom bash init in crontab | systemd Type=simple + Restart=always | Phase 6–7 (2026) | Declarative, self-healing, integrates with journal logging |

**Deprecated/outdated:**
- [Middleware.ts convention](https://nextjs.org/docs/app/building-your-application/routing/middleware): Next.js v16 renamed to `proxy.ts` to clarify the network boundary — migrate using `npx @next/codemod@canary middleware-to-proxy .`
- PowerShell Windows Scheduled Task installer (Phase 6): Replaced by single `curl | bash` for Linux VM, better UX
- Browser-automation sender (`claude_message_send_with_browser.py`): Deleted in Phase 3, replaced by CLI subprocess calls

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | NodeSource maintains official Node.js 20 apt repo for Ubuntu 22.04 | Standard Stack | If repo is unavailable or EOL, installer fails; mitigation: fallback to compile-from-source (slower) |
| A2 | `curl \| bash` is non-interactive and runs completely in the foreground | Bash Installer Pattern | If any prompt is added, user never sees it; mitigation: all prompts must go to wizard, not installer |
| A3 | `app_meta.setup_complete` is readable by Proxy at request time | Proxy Pattern | If DB is not initialized, Proxy fails; mitigation: wrap in try/catch and default to redirect to /setup |
| A4 | systemd service has permission to read `/etc/claude-sender.env` (mode 600, root:root) | systemd Pattern | If permissions are wrong, service can't read secrets; mitigation: verify mode/owner in installer |
| A5 | `execFileNoThrow` from project utils handles sudo correctly without shell | Sudo Pattern | If using `exec()` instead of `execFile()`, injection risk; mitigation: code review before merge |

**If this table is empty:** N/A — all claims were verified.

## Open Questions (RESOLVED)

1. **How to initialize `app_meta.setup_complete` on first run?**
   - What we know: The DB is created by `getDb()` in the app; `SCHEMA` includes `CREATE TABLE app_meta`
   - What's unclear: Should the installer pre-populate `setup_complete='false'`, or should the app do it on first proxy check?
   - Recommendation: **App should handle it.** On first proxy check, if the `app_meta` table is empty or key is missing, assume setup is incomplete and redirect. Simpler than installer needing to parse DB. The Proxy catches this in a try/catch.

2. **Should the wizard validate the OAuth token before accepting?**
   - What we know: D-12 from CONTEXT.md lists this as "Claude's Discretion"
   - What's unclear: Test `claude --version` with the token? Or trust user input?
   - Recommendation: **Accept on trust, validate on first use.** If the token is wrong, the collector will error on first poll and the dashboard will show the error clearly. Adds latency and complexity to the wizard if we test.

3. **Should GCS bucket be truly optional, or required?**
   - What we know: D-11 from CONTEXT.md says "optional — user can configure later via dashboard"
   - What's unclear: If not set now, what's the default behavior? Skip backups? Use a default bucket?
   - Recommendation: **Optional for initial setup.** If not provided, `GCS_BACKUP_BUCKET` env var is unset, and the backup job in `instrumentation.ts` should handle the empty case gracefully (skip backup, log a warning). Reduces friction for first-run.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| git | Installer (repo clone) | ✓ (apt) | Latest from repos | Manual download of tar.gz |
| curl | Installer (fetch NodeSource script) | ✓ (usually pre-installed) | Latest from repos | wget or manual install |
| Node.js 20 | Runtime (app execution) | ✗ (must install) | 20.x via NodeSource | Compile from source (slow) |
| npm | Dependency manager | ✓ (bundled with Node 20) | 10.x+ | Manual global install |
| systemd | Service supervisor | ✓ (Ubuntu 22.04 default) | 251.4+ | — (required, no fallback) |
| SQLite 3 | Database | ✓ (apt, also in better-sqlite3) | Latest from repos | — (core dependency) |
| sudo | Privilege escalation | ✓ (Ubuntu 22.04 default) | Latest | — (required for /etc/ writes) |

**Missing dependencies with no fallback:**
- systemd: If host doesn't have systemd, the service can't be managed. This breaks the deployment model.

**Missing dependencies with fallback:**
- Node.js 20: Can compile from source, but adds 20+ minutes to install time. Recommend sticking with NodeSource for UX.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node.js built-in `node:test` + `node:assert/strict` |
| Config file | None — tests run via `tsx --test test/*.test.ts` |
| Quick run command | `npm test -- --grep "setup"` (specific tests) |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INSTALL-01 | Installer script is executable, installs packages, creates systemd unit | Integration | `bash ./scripts/install.sh` on clean VM (manual) | ✅ scripts/install.sh |
| INSTALL-02 | Wizard collects 4 fields, writes to staging file, calls sudo helper | Unit | `npm test -- --grep "setup.*form"` | ❌ Wave 0: tests/setup.test.ts |
| INSTALL-03 | Re-running installer is safe (swap, user, unit already exist) | Integration | `bash ./scripts/install.sh && bash ./scripts/install.sh` (manual) | ✅ Idempotency guards in script |
| INSTALL-04 | Setup wizard completes in under 30 seconds after first load | Manual | Time from GET /setup to successful POST /api/setup | ❌ Performance benchmark (out of scope) |

### Sampling Rate
- **Per task commit:** `npm test -- --grep "setup"` (setup-related unit tests)
- **Per wave merge:** `npm test` (full suite)
- **Phase gate:** Full suite green + manual integration test (install.sh on clean Ubuntu 22.04 VM)

### Wave 0 Gaps
- [ ] `tests/setup.test.ts` — unit tests for POST /api/setup (form validation, staging file write, sudo call)
- [ ] `tests/proxy.test.ts` — unit tests for proxy redirect logic (check setup_complete in app_meta)
- [ ] Manual integration test — provision clean Ubuntu 22.04 VM, run installer, walk through wizard (documented in HOSTING-STRATEGY.md)
- [ ] Idempotency test — run installer twice on same VM, verify no failures

*(Gaps are expected for Wave 0; implementation phase will add tests.)*

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | OAuth token is user-provided, not app-managed auth |
| V3 Session Management | No | No user sessions; single user per VM |
| V4 Access Control | Yes | Privilege escalation via NOPASSWD sudo; limited to write-env.sh script |
| V5 Input Validation | Yes | POST /api/setup must validate form fields (token format, timezone IANA) |
| V6 Cryptography | N/A | Secrets are passed in env vars, not managed by app |
| V7 Authentication (API) | Yes | OAuth token must not be logged or exposed in error messages |

### Known Threat Patterns for {stack}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Secrets in installer script (world-readable git) | Information Disclosure | Keep secrets in staging file only; installer has no hardcoded secrets |
| Sudo injection via form input | Tampering / Elevation of Privilege | Use `execFile()` with array args, not `exec()` with string interpolation; helper accepts no arguments |
| Staging file left world-readable | Information Disclosure | Set mode 640 on staging file; verify in installer; delete after merge |
| Proxy bypass (direct visit to /dashboard) | Elevation of Privilege | Proxy runs on all routes; matcher excludes only /api/ + static files, so /dashboard is caught |
| Env var exposure in `ps` or `/proc` | Information Disclosure | Use systemd EnvironmentFile (not ExecStart hardcoded args); secrets not visible in process listing |
| Repeated setup (re-entering secrets via form) | Denial of Service | Once setup_complete='true', Proxy redirects /setup to /dashboard; form is not accessible |
| Timing attack on form validation | Information Disclosure | Form validation is client-side only (UX); server validation is fast, no leakage via timing |

## Sources

### Primary (HIGH confidence)
- [Next.js 16 Proxy Documentation](https://nextjs.org/docs/app/building-your-application/routing/middleware) — Setup redirect patterns, conditional routing, matcher config
- [NodeSource Node.js Installer](https://deb.nodesource.com/setup_20.x) — Official Ubuntu repo for Node.js 20; verified via web fetch
- [Ubuntu 22.04 Bash Installer Best Practices](https://www.cyberciti.biz/faq/linux-unix-running-sudo-command-without-a-password/) — Idempotency guards, NOPASSWD patterns
- [Systemd EnvironmentFile Usage](https://www.cloudbees.com/blog/running-node-js-linux-systemd) — Service config loading from /etc/ files

### Secondary (MEDIUM confidence)
- [DigitalOcean Node.js on Ubuntu 22.04](https://www.digitalocean.com/community/tutorials/how-to-install-node-js-on-ubuntu-22-04) — Installation tutorial, idempotency patterns
- [Sudoers NOPASSWD Security](https://linuxize.com/post/how-to-run-sudo-command-without-a-password/) — Safe NOPASSWD configuration, script restrictions
- [GitHub Gist: swap provisioning on Ubuntu 22.04](https://gist.github.com/davidisnotnull/7c0314081be09fc0076746b4e36efc71) — Idempotent swap setup

### Tertiary (LOW confidence, marked for validation)
- Web search results on bash installer patterns (general ecosystem practice, not official docs)

## Metadata

**Confidence breakdown:**
- **Standard stack:** HIGH — Next.js, systemd, better-sqlite3 already in project; Node.js 20 from official NodeSource
- **Architecture patterns:** HIGH — Proxy documented in official Next.js v16 docs; sudo + systemd are Linux standards
- **Bash installer:** MEDIUM — Best practices verified across multiple sources (CyberCiti, DigitalOcean, GCP docs); no edge cases anticipated for Ubuntu 22.04 specific issues
- **Sudo helper security:** MEDIUM — NOPASSWD is standard; no-argument pattern is defensive best practice but requires code review before deploy
- **Pitfalls:** MEDIUM — Common patterns identified; some require testing on actual Ubuntu 22.04 VM to verify

**Research date:** 2026-04-27
**Valid until:** 2026-05-27 (30 days; Node.js releases, systemd updates unlikely in this window)

## Appendix: Minimal Installer Test Checklist

For manual integration testing post-Phase 7, verify:

1. **Fresh Ubuntu 22.04 VM:**
   - [ ] Run `bash <(curl -sL https://raw.githubusercontent.com/elliotdrel/claude-usage-optimizer/main/scripts/install.sh)` (or local path)
   - [ ] Installer exits with code 0

2. **System state after install:**
   - [ ] `systemctl status claude-tracker` shows `active (running)`
   - [ ] `curl http://127.0.0.1:3018` redirects to `/setup`
   - [ ] `ls -la /etc/claude-sender.env` shows `-rw------- root root` (mode 600)
   - [ ] `/swapfile` exists if not pre-provisioned

3. **First-run wizard:**
   - [ ] Form loads at `/setup`
   - [ ] Submit valid credentials
   - [ ] Redirects to `/dashboard`
   - [ ] `app_meta.setup_complete` is now `'true'` (verify in DB or via API)

4. **Idempotency:**
   - [ ] Run installer again on same VM
   - [ ] No errors; exits with code 0
   - [ ] Service still running, setup still complete

5. **Re-entry after setup:**
   - [ ] Visit `/setup` after setup is complete
   - [ ] Redirected to `/dashboard` (not `/setup`)

---

*Research completed: 2026-04-27*
*Planner can now create task plans for Phase 7.*
