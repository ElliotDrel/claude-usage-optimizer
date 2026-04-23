---
phase: 6
phase_name: "VM Deployment & Hardening"
project: "Claude Usage Optimizer"
generated: "2026-04-23T00:00:00.000Z"
counts:
  decisions: 6
  lessons: 5
  patterns: 5
  surprises: 3
missing_artifacts:
  - "06-UAT.md"
---

# Phase 6 Learnings: VM Deployment & Hardening

## Decisions

### better-sqlite3.backup() over subprocess VACUUM
Use `better-sqlite3`'s native `.backup()` method for online atomic SQLite backup, not `VACUUM INTO` or a `sqlite3` CLI subprocess.

**Rationale:** `.backup()` is atomic at the C level, safe under concurrent writes, requires no external binary, and returns a Promise that completes when backup finishes. Subprocess approaches require spawning an external process and risk file locking issues under concurrent writes.
**Source:** 06-01-PLAN.md (Task 1), 06-01-SUMMARY.md (deviations)

---

### All infrastructure failures are non-fatal (D-02)
Backup failures, Discord webhook failures, and GCS credential errors all log and continue — none crash the process.

**Rationale:** These are operational convenience features. The scheduler's core function (sending messages to reset the 5-hour window) must never be blocked by backup or notification infrastructure outages. Treating them as non-fatal matches the "best-effort" contract documented in CONTEXT.md.
**Source:** 06-CONTEXT.md (D-02), 06-01-SUMMARY.md, 06-02-SUMMARY.md

---

### Discord webhook is opt-in via app_meta (D-07)
Webhook URL stored in `app_meta.notification_webhook_url`. If absent or empty, all webhook calls are silently skipped — no error, no warning.

**Rationale:** Non-technical users should not be required to configure Discord to run the app. The app must work without notifications configured; they are an operational enhancement, not a requirement.
**Source:** 06-CONTEXT.md (D-07), 06-02-PLAN.md, 06-02-SUMMARY.md

---

### Systemd service artifacts live in repo root for deployer to copy
`claude-tracker.service` and `claude-sender.env.example` are committed to the repo root rather than `/etc/systemd/system/` and `/etc/`.

**Rationale:** Development happens on Windows where `/etc/systemd/system/` does not exist. Ops artifacts that would normally live at Linux system paths must be created in the repo and copied by the deployer (`sudo cp`). The HOSTING-STRATEGY.md documents this explicitly.
**Source:** 06-03-PLAN.md (deployment_context), 06-03-SUMMARY.md

---

### HOSTING-STRATEGY.md as a complete rewrite, not incremental update (D-12)
The entire file was discarded and rewritten from scratch with a user-journey structure.

**Rationale:** Incremental updates accumulate stale content (Python sender references, two-service architecture). A full rewrite ensures a single coherent document with no contradictions. Git history preserves the old content for reference.
**Source:** 06-CONTEXT.md (D-12, D-13), 06-04-PLAN.md

---

### Stall detection timestamp write must precede the pause check
`writeMeta(db, "last_tick_at", nowFn().toISOString())` is placed at the very start of `runTick()`, before the `if (paused === "true") return` guard.

**Rationale:** If the timestamp write happened after the pause check, a paused scheduler would stop writing heartbeats and the stall detector would fire false alerts on every tick after a pause. Writing unconditionally lets the stall detector distinguish "paused" (ticks keep arriving) from "hung" (ticks stop).
**Source:** 06-02-PLAN.md (Task 2), 06-02-SUMMARY.md

---

## Lessons

### better-sqlite3.backup() is async (Promise), not sync
The initial plan described calling `.step(-1)` and `.finish()` methods on the backup object. The actual API returns a `Promise<void>` directly.

**Context:** The plan was written referencing older documentation. At implementation time, the executor found the actual API signature and auto-corrected. This required an extra fix commit (`b7dab86`). Always verify `better-sqlite3` API signatures against the live npm package — the API has changed across major versions.
**Source:** 06-01-SUMMARY.md (deviations section)

---

### Ops artifacts for Linux deployments need a repo home on Windows dev machines
Plan 03 specified file paths `/etc/systemd/system/claude-tracker.service` and `/etc/claude-sender.env.example`. These paths don't exist on Windows.

**Context:** The orchestrator recognized this during plan review and added a `deployment_context` note to the executor prompt. Ops artifacts committed to the repo root work correctly — HOSTING-STRATEGY.md documents `sudo cp` to install them to the system paths. Future plans with Linux-specific paths should always include a "where this lives in the repo" clarification.
**Source:** 06-03-PLAN.md (executor deployment_context), 06-03-SUMMARY.md

---

### Fire-and-forget async with void suppression is the correct pattern for non-blocking notifications
Calling `postDiscordNotification()` without `await` and with `void` suppresses TypeScript's unhandled-promise warning while making the intent explicit.

**Context:** Using `await` would block the tick/send completion on webhook latency. Returning a plain Promise without `void` triggers TypeScript warnings. The `void` pattern communicates "intentionally fire-and-forget" to readers and tooling.
**Source:** 06-02-PLAN.md (Task 2, Task 3), 06-02-SUMMARY.md

---

### The existing scheduler test suite exercises new notification paths automatically
Adding `postDiscordNotification` calls to `runTick()` and `send()` caused existing scheduler and sender tests to exercise the notifier code path on every run — without any test changes.

**Context:** The tests ran with no webhook URL configured, so the notifier's early-return path was exercised on every test run. This gave free regression coverage for the "skip silently when no URL" path. The test output confirmed correct behavior with `[notifier] webhook URL not configured, skipping notification` log lines.
**Source:** post-merge test output (128/128 passed)

---

### Post-deploy verification checklist belongs inline in HOSTING-STRATEGY.md, not as a separate file (D-15)
QUAL-03 required a verification checklist. It was placed as a dedicated section inside HOSTING-STRATEGY.md rather than a separate document.

**Context:** A separate checklist file creates navigation friction for non-technical users following a deployment guide. Inline placement ensures the user sees the verification steps immediately after setup without switching documents. This also keeps the deployment guide self-contained.
**Source:** 06-CONTEXT.md (D-15), 06-04-PLAN.md (Task 1)

---

## Patterns

### In-process scheduled job registration via instrumentation.ts
Register time-triggered background jobs using the same `shouldStartScheduler` guard and `{ stop: () => void }` return pattern as the existing scheduler.

```typescript
let jobStop = () => {};
if (shouldStartScheduler) {
  const job = startJobName(db);
  jobStop = job.stop;
  console.log("[instrumentation] Job started");
}
const shutdown = () => {
  collector.stop();
  schedulerStop();
  jobStop();  // add each job here
  process.exit(0);
};
```

**When to use:** Any periodic background operation (backup, cleanup, heartbeat, metrics flush) that should run in the same process as the scheduler, share its lifecycle, and be suppressed in demo mode.
**Source:** 06-01-PLAN.md (Task 3), 06-01-SUMMARY.md, 06-PATTERNS.md

---

### Non-fatal error handling: try/catch, log, return (never rethrow)
```typescript
try {
  await someAsyncOperation();
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[module] operation failed: ${msg}`);
  // Do NOT rethrow — caller continues normally
}
```

**When to use:** All infrastructure operations that are "best-effort" and must not crash the core application: GCS uploads, Discord webhook POSTs, backup compression, any optional I/O.
**Source:** 06-01-SUMMARY.md, 06-02-SUMMARY.md, 06-PATTERNS.md (error handling section)

---

### Opt-in feature via app_meta key
Store optional feature configuration (webhook URLs, external service credentials) in `app_meta`. Check for empty/absent key at call time and return early if unset.

```typescript
const webhookUrl = db.prepare("SELECT value FROM app_meta WHERE key = ?").get("notification_webhook_url") as { value: string } | undefined;
if (!webhookUrl?.value) {
  console.log("[module] feature not configured, skipping");
  return;
}
```

**When to use:** Features that require external configuration (webhook URLs, API keys, bucket names) and should work in a degraded but non-failing state when unconfigured.
**Source:** 06-02-PLAN.md (Task 1), 06-02-SUMMARY.md

---

### Env file template with security callout committed to repo
Create a `.example` env file committed to the repo root with placeholder values, inline documentation for each variable, and a prominent `chmod 600` security warning.

**When to use:** Any project that needs to distribute an env file structure to deployers. The `.example` suffix prevents accidental real-token commits while the file documents all required configuration in one place.
**Source:** 06-03-PLAN.md (Task 2), 06-03-SUMMARY.md

---

### User-journey documentation structure for non-technical deployers
Structure deployment guides as numbered steps in user-journey order (Prerequisites → Provision → Deploy → Configure → Start → Verify → Configure features), with copy-pasteable `bash` code blocks and expected output documentation for each step.

**When to use:** Any ops documentation written for non-technical audiences. Avoid prose explanations of architecture — every sentence should answer "what do I do next?" Include a verification section so users can confirm each step worked before proceeding.
**Source:** 06-04-PLAN.md (Task 1), 06-CONTEXT.md (D-14)

---

## Surprises

### better-sqlite3.backup() API change between plan and implementation
The plan documented a synchronous backup API (`.step(-1)`, `.finish()`). The actual installed version uses a Promise-based API (`await db.backup(outputPath)`).

**Impact:** Required an additional fix commit during Wave 1 execution. The bug was caught during TypeScript compilation — the type signatures were incompatible. No user-visible behavior change. The executor auto-corrected under Rule 1 (bug fix). Future plans referencing `better-sqlite3` methods should verify API signatures against the installed version before specifying implementation details.
**Source:** 06-01-SUMMARY.md (deviations section, commits b7dab86)

---

### All 128 pre-existing tests passed with zero changes after Wave 1 merge
Adding `postDiscordNotification()` calls to scheduler and sender did not break any existing test, despite the new code paths being exercised.

**Impact:** Confirmed that the non-fatal, opt-in notification pattern composes cleanly with the existing test suite. The graceful early-return when no webhook URL is configured is the correct default behavior in test environments. This gives confidence that future infrastructure additions using the same pattern will also compose cleanly.
**Source:** Post-merge test gate output (128/128 passed, `[notifier] webhook URL not configured` visible in test output)

---

### Wave 1 parallel worktrees committed directly to main (no merge commits visible)
The three Wave 1 agents ran in isolated worktrees and their commits landed sequentially on main without explicit merge commits from the orchestrator.

**Impact:** The `isolation="worktree"` parameter in the Agent tool handled worktree lifecycle automatically — commits were applied to main before the orchestrator's worktree cleanup step. The orchestrator's manual worktree merge script found no worktrees to process. This is a positive surprise: less orchestrator overhead than expected, but the pattern may differ from the documented workflow's explicit merge step.
**Source:** Post-wave `git worktree list` showing only main worktree; `git log --oneline -20` showing interleaved Wave 1 commits on main
