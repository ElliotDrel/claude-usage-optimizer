---
phase: 07-installer-onboarding
reviewed: 2026-04-27T00:00:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - scripts/install.sh
  - src/utils/execFileNoThrow.ts
  - src/proxy.ts
  - src/app/setup/page.tsx
  - src/app/api/setup/route.ts
  - scripts/write-env.sh
findings:
  critical: 3
  warning: 4
  info: 3
  total: 10
status: issues_found
---

# Phase 7: Code Review Report

**Reviewed:** 2026-04-27
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

The six files implement a two-phase onboarding flow: a bash installer that provisions the VM, and a wizard UI + API that collects secrets and writes them to the privileged env file via a narrowly-scoped sudo helper. The security architecture is sound in intent — array-arg subprocess invocation, hardcoded helper paths, no secrets in logs. However, three correctness/security bugs need to be fixed before shipping, and four warnings around coupling fragility and install reliability require resolution.

---

## Critical Issues

### CR-01: Newline injection into `/etc/claude-sender.env` via user-supplied values

**File:** `src/app/api/setup/route.ts:65-74`

**Issue:** `oauthToken`, `auth.value`, `timezone`, and `bucket` are concatenated directly into newline-delimited env-file lines. `.trim()` strips only leading/trailing whitespace — it does not strip embedded `\n`, `\r`, or NUL characters. A token containing a literal newline (e.g., `sk-ant-...\nMALICIOUS_VAR=evil`) injects an extra line into `/etc/claude-sender.env`, which is then written with `chown root:root` and `chmod 600` by the privileged helper. This gives an authenticated setup-page user full control over any env var read by the privileged service.

**Fix:**
```typescript
// At the top of POST(), after extracting oauthToken and auth.value
const CONTROL_CHAR_RE = /[\r\n\0]/;

if (CONTROL_CHAR_RE.test(oauthToken)) {
  return NextResponse.json(
    { error: "OAuth token contains invalid characters" },
    { status: 400 }
  );
}
if (CONTROL_CHAR_RE.test(auth.value)) {
  return NextResponse.json(
    { error: "Auth value contains invalid characters" },
    { status: 400 }
  );
}
if (CONTROL_CHAR_RE.test(timezone)) {
  return NextResponse.json(
    { error: "Timezone contains invalid characters" },
    { status: 400 }
  );
}
if (bucket && CONTROL_CHAR_RE.test(bucket)) {
  return NextResponse.json(
    { error: "Bucket name contains invalid characters" },
    { status: 400 }
  );
}
```

---

### CR-02: Service self-kill race — `setup_complete` may never be written

**File:** `src/app/api/setup/route.ts:88-115` / `scripts/write-env.sh:49`

**Issue:** The call sequence is:

1. `route.ts:88` — calls `sudo write-env.sh`
2. `write-env.sh:49` — runs `systemctl restart claude-tracker`, which sends SIGTERM to the **running Next.js process** handling this request
3. `route.ts:113` — calls `setAppMeta(config, "setup_complete", "true")` (may never execute if SIGTERM arrives first)
4. `route.ts:115` — returns HTTP 200 (may never reach the client)

If systemd's restart wins the race (highly likely on a responsive VM), `setup_complete` stays `'false'`, the client sees a network error, and on the next browser request the proxy redirects back to `/setup`. The user is stuck in a loop, and the service never becomes fully configured without manual DB intervention.

**Fix — two-part:**

Option A (preferred): Write `setup_complete = 'true'` to the database **before** invoking the sudo helper, so it survives a restart:

```typescript
// route.ts — reorder: mark complete BEFORE service restart
setAppMeta(config, "setup_complete", "true");

const result = await execFileNoThrow(
  "sudo",
  ["/opt/claude-usage-optimizer/scripts/write-env.sh"],
  { timeout: 10_000, cwd: "/tmp" }
);

if (result.status !== 0) {
  // Roll back the flag if the helper failed
  setAppMeta(config, "setup_complete", "false");
  return NextResponse.json(
    { error: "Failed to apply configuration. Please try again." },
    { status: 500 }
  );
}
```

Option B: Move the `systemctl restart` out of `write-env.sh` (remove lines 49-53) and instead have the startup logic reload the env file on startup, so no in-request restart is needed. The service naturally picks up the new env at its next scheduled restart or on the next boot.

---

### CR-03: Fresh install fails — build-time devDependencies excluded before `npm run build`

**File:** `scripts/install.sh:110-113`

**Issue:** Step 7 runs `npm ci --omit=dev` (line 110) which excludes `tailwindcss`, `@tailwindcss/postcss`, and `typescript`. Step 8 immediately runs `npm run build` (line 113), which requires all three packages — Tailwind is consumed as a PostCSS plugin during CSS compilation, and TypeScript is the compiler. On a fresh Ubuntu VM these packages will be absent and the build will abort, causing the installer to exit at line 15 (`set -e`). Every first-time install fails at step 8.

**Fix:**
```bash
# [7/14] Install ALL dependencies (dev included) for build
echo "[7/14] Installing npm dependencies..."
npm ci   # No --omit=dev; dev deps are needed for the build step

echo "[8/14] Building Next.js app..."
npm run build

# Prune dev dependencies after a successful build to reduce disk usage on e2-micro
echo "[8b/14] Pruning dev dependencies after build..."
npm prune --omit=dev
```

---

## Warnings

### WR-01: Staging-file path coupling — hardcoded path vs. runtime-computed path

**File:** `scripts/write-env.sh:30` / `src/app/api/setup/route.ts:81`

**Issue:** `write-env.sh` hardcodes `STAGING_FILE="/opt/claude-usage-optimizer/data/.env-staging"`. The API route computes `stagingPath = path.join(config.dataDir, ".env-staging")`, where `config.dataDir` is driven by `DATA_DIR` env var and `process.cwd()`. If the service is ever run from a different working directory or with a different `DATA_DIR`, the helper looks in the wrong location and reports "staging file not found" — a silent misconfiguration with no indication of the mismatch.

**Fix:** Either:
- Lock `DATA_DIR` to `/opt/claude-usage-optimizer/data` in the systemd unit and document this contract, or
- Add a comment in `write-env.sh` explicitly calling out the coupling: `# COUPLING: matches config.dataDir in src/lib/config.ts (must be /opt/claude-usage-optimizer/data)`

---

### WR-02: `writeFileSync` mode 0o640 silently ignored on pre-existing staging file

**File:** `src/app/api/setup/route.ts:84`

**Issue:** `fs.writeFileSync(stagingPath, envContent, { mode: 0o640 })` — the `mode` option in Node.js's `writeFileSync` only applies on **file creation**. If a stale `.env-staging` from a prior failed run exists, the existing permissions (which may be more permissive, e.g., 0o644 from a different process) are preserved. The staging file briefly contains plaintext secrets with looser-than-intended permissions.

**Fix:**
```typescript
fs.writeFileSync(stagingPath, envContent, { mode: 0o640 });
// Explicitly enforce mode regardless of file pre-existence
fs.chmodSync(stagingPath, 0o640);
```

Or unconditionally unlink first:
```typescript
try { fs.unlinkSync(stagingPath); } catch { /* ignore if not exists */ }
fs.writeFileSync(stagingPath, envContent, { mode: 0o640 });
```

---

### WR-03: `proxy.ts` — `/setup` prefix match also intercepts `/setup-anything` routes

**File:** `src/proxy.ts:22`

**Issue:** `pathname.startsWith("/setup")` (line 22) matches `/setup-complete`, `/setup-legacy`, or any future route that begins with the string "setup". The gate logic — redirect away if setup is complete, allow through if not — would incorrectly apply to those routes.

**Fix:**
```typescript
// Match only the exact /setup route and sub-paths like /setup/step2
if (pathname === "/setup" || pathname.startsWith("/setup/")) {
```

---

### WR-04: `write-env.sh` missing `set -u` — unbound variable silently expands to empty

**File:** `scripts/write-env.sh:18`

**Issue:** The script has `set -e` but not `set -u`. `STAGING_FILE` and `TARGET_FILE` are set immediately, so in practice this is low-risk, but any future edit that references a typo'd variable name will silently produce an empty expansion rather than an immediate abort. Inconsistent with `install.sh` which has both `set -e` and `set -u`.

**Fix:**
```bash
set -e
set -u
```

---

## Info

### IN-01: `await Promise.resolve(getAppMeta(config))` — no-op async wrapper

**File:** `src/proxy.ts:19`

**Issue:** `getAppMeta` is synchronous (it uses `better-sqlite3`). Wrapping it in `Promise.resolve()` is a no-op and mildly misleading — it suggests async behavior where there is none.

**Fix:**
```typescript
const meta = getAppMeta(config);
```

---

### IN-02: Hardcoded 1-second delay before redirect in setup page

**File:** `src/app/setup/page.tsx:59`

**Issue:** `await new Promise((resolve) => setTimeout(resolve, 1000))` is a fixed 1-second wait added as a heuristic to allow the service to restart. On a loaded e2-micro, systemd restart can take longer. If the app is not yet ready when the browser navigates to `/`, the user sees an error page or is redirected back to `/setup`.

**Fix:** Replace the fixed sleep with a polling loop that checks a lightweight health endpoint (e.g., `GET /api/health`) before redirecting. If a health endpoint does not exist, at minimum increase the timeout to 3–5 seconds and document it as a known UX limitation.

---

### IN-03: `execFileNoThrow` type-casts caught error — `code` field is not standardized

**File:** `src/utils/execFileNoThrow.ts:24`

**Issue:** The catch block casts `err` to `{ code?: number; stdout?: string; stderr?: string }`. In Node.js, `child_process` errors use `code` for the **exit code** as a number — this is correct. However, the cast is not guarded; if a non-child_process error is thrown (e.g., a timeout error where `code` is a string like `'ETIMEDOUT'`), `typeof e.code === "number"` guards it correctly and falls back to `1`. This is safe as written. The only suggestion is to narrow the type annotation for clarity:

```typescript
const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
return {
  status: typeof e.code === "number" ? e.code : 1,
  stdout: e.stdout ?? "",
  stderr: e.stderr ?? String(err),
};
```

---

_Reviewed: 2026-04-27_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
