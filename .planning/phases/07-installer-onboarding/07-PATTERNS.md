# Phase 7: Installer & Onboarding - Pattern Map

**Mapped:** 2026-04-27
**Files analyzed:** 6 new/modified files
**Analogs found:** 5 / 6

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `scripts/install.sh` | script | batch | (none — bash provisioning scripts are new) | no-analog |
| `scripts/write-env.sh` | script | batch | (none — privileged helper scripts are new) | no-analog |
| `src/app/setup/page.tsx` | component | request-response | `src/app/page.tsx` | role-match |
| `src/app/api/setup/route.ts` | API route | request-response | `src/app/api/app-meta/route.ts` | exact |
| `src/proxy.ts` | middleware | request-response | (none — Next.js proxy is new for Phase 7) | no-analog |
| `src/lib/db.ts` | utility/library | CRUD | (existing file — add setup_complete support) | role-match |

## Pattern Assignments

### `src/app/setup/page.tsx` (component, request-response)

**Analog:** `src/app/page.tsx` (dashboard page)

**Imports & Component Structure** (lines 1-20):
```typescript
"use client";

import { useCallback, useEffect, useState } from "react";
import type { DashboardData } from "@/lib/analysis";

export default function SetupPage() {
  const [formData, setFormData] = useState({ /* fields */ });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // ...
}
```

**Form Field Pattern** (from `src/components/SendNowButton.tsx` lines 9-24):
```typescript
const handleClick = async () => {
  setIsLoading(true);
  setLastError(null);
  try {
    const response = await fetch("/api/send-now", { method: "POST" });
    if (!response.ok) throw new Error("Send failed");
    // Refetch or redirect on success
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    setLastError(msg);
  } finally {
    setIsLoading(false);
  }
};
```

**Form Rendering Pattern** (use Tailwind classes matching project style from `src/app/page.tsx` lines 86-166):
```typescript
// Tailwind + CSS custom properties (--accent, --bg-base, --text-primary, etc.)
<div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
  <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-xl p-8 max-w-md w-full">
    {/* fields */}
  </form>
</div>
```

**Key Patterns:**
- `"use client"` directive (client-side component)
- `useState` for form state management
- `useRouter().push()` for programmatic navigation after success
- Async fetch to POST `/api/setup` with JSON body
- Error state display in red box
- Disabled button during loading
- Form validation before submit (client-side, user-friendly)

---

### `src/app/api/setup/route.ts` (API route, request-response)

**Analog:** `src/app/api/app-meta/route.ts` (PATCH endpoint that validates, updates state, and returns JSON)

**Imports & Route Structure** (lines 1-7):
```typescript
import { NextResponse, NextRequest } from "next/server";
import { getConfig } from "@/lib/config";
import { setAppMeta, getAppMeta } from "@/lib/db";
import { recomputeSchedule } from "@/lib/scheduler";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest) {
  // ...
}
```

**Error Handling Pattern** (lines 43-86):
```typescript
export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as { key?: string; value?: string };
    if (!body.key || body.value === undefined) {
      return NextResponse.json(
        { error: "Missing key or value in request body" },
        { status: 400 }
      );
    }

    // Server-side validation
    const validator = OVERRIDE_VALIDATORS[body.key];
    if (validator && !validator(body.value)) {
      return NextResponse.json(
        { error: `Invalid value for key '${body.key}': '${body.value}'` },
        { status: 400 }
      );
    }

    const config = getConfig();
    
    // Business logic
    setAppMeta(config, body.key, body.value);
    recomputeSchedule(config);
    
    // Return success JSON
    const meta = getAppMeta(config);
    return NextResponse.json({
      success: true,
      key: body.key,
      value: body.value,
      scheduleFires: newScheduleFires ? JSON.parse(newScheduleFires) : null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[app-meta]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
```

**Specific Adaptations for Setup Route:**
- POST instead of PATCH (receive form data, not key-value override)
- Validate: `oauthToken`, `usageAuth` (with mode/value), `userTimezone`, `gcsBucket` (optional)
- Write staging file to `/opt/claude-usage-optimizer/data/.env-staging` (mode 0o640)
- Invoke sudo helper using `execFileNoThrow` (CRITICAL: use array args, never shell interpolation)
- On success, write `app_meta.setup_complete='true'` and return JSON with redirect hint

**Staging File Write Pattern:**
```typescript
import fs from "node:fs";
import path from "node:path";

const stagingPath = path.join(config.dataDir, '.env-staging');
const envContent = [
  `CLAUDE_CODE_OAUTH_TOKEN=${oauthToken}`,
  usageAuth.mode === 'cookie'
    ? `CLAUDE_SESSION_COOKIE=${usageAuth.value}`
    : `CLAUDE_BEARER_TOKEN=${usageAuth.value}`,
  `user_timezone=${userTimezone || 'America/Los_Angeles'}`,
  gcsBucket ? `GCS_BACKUP_BUCKET=${gcsBucket}` : '',
].filter(Boolean).join('\n');

fs.writeFileSync(stagingPath, envContent, { mode: 0o640 });
```

**Sudo Helper Invocation Pattern** (use `execFileNoThrow` if it exists in project; if not, create it):
```typescript
import { execFileNoThrow } from "@/utils/execFileNoThrow"; // May need to be created
// CRITICAL: Never pass secrets as arguments
// Helper accepts no arguments and reads fixed staging file path
const result = await execFileNoThrow('sudo', [
  '/opt/claude-usage-optimizer/scripts/write-env.sh',
], {
  timeout: 10000,
  cwd: '/tmp',  // Neutral working directory
});

if (result.status !== 0) {
  try { fs.unlinkSync(stagingPath); } catch {}
  return NextResponse.json(
    { error: `Failed to write env file: ${result.stderr}` },
    { status: 500 }
  );
}
```

---

### `src/lib/db.ts` (utility, CRUD)

**Existing File — Add Support for `setup_complete`**

**Current Pattern** (lines 236-252):
```typescript
export function getAppMeta(config: Config): Map<string, string> {
  const db = getDb(config);
  const rows = db.prepare("SELECT key, value FROM app_meta").all() as Array<{
    key: string;
    value: string;
  }>;
  return new Map(rows.map((r) => [r.key, r.value]));
}

export function setAppMeta(config: Config, key: string, value: string): void {
  const db = getDb(config);
  db.prepare(`
    INSERT INTO app_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}
```

**No changes required** — The existing `getAppMeta()` and `setAppMeta()` functions already support arbitrary keys including `setup_complete`. The key-value pattern at lines 245-251 uses `INSERT ... ON CONFLICT(key) DO UPDATE SET value = excluded.value`, which allows `setup_complete='true'` or `setup_complete='false'` to be written the same way as existing keys like `paused`, `schedule_override_start_time`, etc.

**Initialization Pattern** (lines 24-27, table schema is already defined):
```typescript
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

The table already exists and supports any string key. No schema migration needed.

---

### `src/proxy.ts` (middleware, request-response)

**Analog:** None (Next.js proxy is new for this phase), but pattern is documented in RESEARCH.md

**Template Structure** (from RESEARCH.md, Pattern 2):
```typescript
// source: RESEARCH.md, Pattern 2: Next.js Proxy Setup Redirect
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getConfig } from '@/lib/config'
import { getAppMeta } from '@/lib/db'

export async function middleware(request: NextRequest) {
  // Skip setup check for /setup route and API endpoints
  const pathname = request.nextUrl.pathname
  if (pathname.startsWith('/setup') || pathname.startsWith('/api/')) {
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
    '/((?!_next|api|.*\\.png$).*)',
  ],
}
```

**Key Patterns:**
- Async function that checks DB before rendering routes
- Try/catch to handle DB initialization on first boot
- Skip `/setup` and `/api/` routes to avoid infinite redirect loop
- Matcher excludes static assets and Next.js internals
- Returns `NextResponse.redirect()` for setup state check, `NextResponse.next()` to allow through

---

### `scripts/install.sh` (bash script, batch provisioning)

**Analog:** None (bash installers are new), but pattern is documented in RESEARCH.md

**Template Structure** (from RESEARCH.md, Pattern 1):
```bash
#!/bin/bash
# source: RESEARCH.md, Pattern 1: Bash Installer Idempotency with Guards

set -e
set -u

echo "=== Claude Usage Optimizer Installer ==="

# Detect errors early
trap 'echo "Installer failed at line $LINENO"; exit 1' ERR

# Verify running as root
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

# 12. Start the service
echo "Starting claude-tracker service..."
systemctl start claude-tracker.service

echo ""
echo "=== Installation Complete ==="
echo "Service is starting. Access the setup wizard at:"
echo "  http://127.0.0.1:3018"
echo ""
exit 0
```

**Key Patterns:**
- `set -e` to exit on first error
- `set -u` to error on undefined variables
- `trap` to catch line numbers on failure
- Root check before proceeding
- Idempotency guards (check `[ ! -f /swapfile ]` before creating)
- Explicit `apt-get update` before installs
- Use `apt-get install -y` for non-interactive install
- NodeSource curl-and-pipe pattern for Node.js 20
- `git clone` vs. `git pull` branch logic
- Explicit directory creation with `mkdir -p`
- Ownership/permission changes (chown, chmod)
- Heredoc for multi-line file writes with `<< 'EOF'` (single-quoted to prevent variable expansion)
- `systemctl daemon-reload` after unit file copy

---

### `scripts/write-env.sh` (bash script, batch privilege escalation)

**Analog:** None (privilege helper scripts are new), but pattern is documented in RESEARCH.md

**Template Structure** (from RESEARCH.md, Pattern 3):
```bash
#!/bin/bash
# source: RESEARCH.md, Pattern 3: Sudo NOPASSWD Helper with No Arguments

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
fi

# Clean up staging file
rm -f "$STAGING_FILE"

exit 0
```

**Key Patterns:**
- `set -e` to fail on any error
- Check `[ $# -ne 0 ]` to reject any arguments (security)
- Use only fixed, hardcoded paths (no user input)
- Validate staging file exists before proceeding
- `cp`, `chmod`, `chown` for secure file operations
- Mode 600 on target file (only root readable)
- Invoke `systemctl restart` to pick up new env via `EnvironmentFile`
- Clean up staging file after merge
- Exit code 0 on success, non-zero on error
- All debug/info output to stderr (not stdout)

---

## Shared Patterns

### Error Handling for API Routes
**Source:** `src/app/api/app-meta/route.ts` (lines 43–86)
**Apply to:** `src/app/api/setup/route.ts`

```typescript
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { /* fields */ };
    
    // Validate inputs early
    if (!required_field) {
      return NextResponse.json(
        { error: "Error message" },
        { status: 400 }
      );
    }

    // Business logic
    const config = getConfig();
    // ... operations ...

    return NextResponse.json({
      success: true,
      // ... response fields ...
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[setup]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
```

### App Meta Read/Write Pattern
**Source:** `src/lib/db.ts` (lines 236–251)
**Apply to:** Both `src/app/api/setup/route.ts` (write `setup_complete='true'` on success)

```typescript
import { getConfig } from '@/lib/config';
import { setAppMeta, getAppMeta } from '@/lib/db';

const config = getConfig();

// Read
const meta = getAppMeta(config);
const setupComplete = meta.get('setup_complete');

// Write
setAppMeta(config, 'setup_complete', 'true');
```

### Client-Side Form Fetch Pattern
**Source:** `src/components/SendNowButton.tsx` (lines 9–24) and `src/app/page.tsx` (lines 26–37)
**Apply to:** `src/app/setup/page.tsx`

```typescript
const [isLoading, setIsLoading] = useState(false);
const [error, setError] = useState<string | null>(null);

const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  setIsLoading(true);
  setError(null);

  try {
    const response = await fetch('/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ /* form data */ }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed');

    // Success: redirect or navigate
    router.push('/');
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    setError(msg);
    console.error('Error:', err);
  } finally {
    setIsLoading(false);
  }
};
```

### Styling Pattern
**Source:** `src/app/page.tsx` (lines 86–166) and `src/components/SendNowButton.tsx` (lines 26–48)
**Apply to:** `src/app/setup/page.tsx`

```typescript
// Use Tailwind base classes
<div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
  <form className="bg-white rounded-lg shadow-xl p-8 max-w-md w-full">
    {/* Use project CSS custom properties */}
    <h1 style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}>
      Title
    </h1>
    
    <button
      style={{
        background: isLoading ? "var(--text-tertiary)" : "var(--accent)",
        color: isLoading ? "var(--text-secondary)" : "var(--bg-base)",
      }}
    >
      Submit
    </button>
  </form>
</div>
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `scripts/install.sh` | script | batch | No existing bash provisioning scripts in codebase; pattern is documented in RESEARCH.md |
| `scripts/write-env.sh` | script | batch | No existing privilege escalation helpers; pattern is documented in RESEARCH.md |
| `src/proxy.ts` | middleware | request-response | Next.js proxy is new for Phase 7; middleware.ts does not exist yet. Pattern is documented in RESEARCH.md |

**Note:** Although no analogs exist in the codebase, all three files have detailed pattern documentation in RESEARCH.md (Patterns 1, 2, 3). The planner should use those patterns plus the verified code examples from RESEARCH.md as the source of truth.

---

## Implementation Notes

### Utility Function Requirement
The project may need `src/utils/execFileNoThrow.ts` if it doesn't exist. This utility is referenced in CONTEXT.md (line 66) as an existing project utility, but it was not found during search. Check the following:

1. **If it exists:** Use as-is in `src/app/api/setup/route.ts`
2. **If it doesn't exist:** Create a new utility following Node.js `execFile` patterns with timeout and error handling

**Minimal Implementation Pattern:**
```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function execFileNoThrow(
  file: string,
  args: string[],
  options?: { timeout?: number; cwd?: string }
): Promise<{ status: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(file, args, {
      timeout: options?.timeout || 30000,
      cwd: options?.cwd || process.cwd(),
    });
    return { status: 0, stdout, stderr };
  } catch (err) {
    if (err instanceof Error && 'status' in err) {
      return {
        status: (err as any).status || 1,
        stdout: (err as any).stdout || '',
        stderr: (err as any).stderr || '',
      };
    }
    throw err;
  }
}
```

---

## Metadata

**Analog search scope:** 
- `src/app/**/*.{tsx,ts}` — React components and Next.js routes
- `src/lib/**/*.ts` — Library utilities (db, config, etc.)
- `scripts/**` — Existing scripts (PowerShell, identified for style reference only)

**Files scanned:** 30+ source files across app, components, lib, and scripts directories

**Pattern extraction date:** 2026-04-27

**Coverage Summary:**
- API route pattern: 100% (matched `src/app/api/app-meta/route.ts`)
- Component pattern: 100% (matched `src/app/page.tsx`)
- Library pattern: 100% (matched `src/lib/db.ts` existing implementation)
- Error handling: 100% (matched patterns in all API routes)
- Form/UX pattern: 100% (matched `src/components/SendNowButton.tsx`)
- Bash/script patterns: 0% (no analogs, but documented in RESEARCH.md)
- Middleware/proxy: 0% (new for Phase 7, documented in RESEARCH.md)
