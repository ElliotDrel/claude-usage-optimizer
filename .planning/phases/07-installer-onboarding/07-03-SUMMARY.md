---
phase: 07-installer-onboarding
plan: "03"
subsystem: security/installer
tags: [bash, sudo, privilege-escalation, env-file, security]
dependency_graph:
  requires: [07-01, 07-02]
  provides: [write-env-helper]
  affects: [setup-apply-api-route, installer]
tech_stack:
  added: []
  patterns: [no-argument-sudo-helper, hardcoded-paths, staging-file-pattern]
key_files:
  created:
    - scripts/write-env.sh
  modified: []
decisions:
  - "write-env.sh accepts zero arguments — all paths hardcoded to prevent injection"
  - "Restart failure is a warning, not a fatal error — env file write is the primary goal"
  - "Staging file deleted after successful merge to prevent plaintext secrets lingering on disk"
metrics:
  duration: ~5 min
  completed: "2026-04-27T18:56:23Z"
  tasks_completed: 2
  files_created: 1
  files_modified: 0
---

# Phase 7 Plan 03: Privileged write-env.sh Helper — Summary

**One-liner:** Bash helper (mode 755) that reads staged env from fixed path, writes to /etc/claude-sender.env (mode 600 root:root), restarts service, then deletes staging file — invokable only via narrow sudoers entry, accepts zero arguments.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create scripts/write-env.sh | 2da8776 | scripts/write-env.sh |
| 2 | Verify sudoers entry in install.sh | (no change) | scripts/install.sh verified |

## What Was Built

`scripts/write-env.sh` is the privileged helper that bridges the unprivileged Next.js API process and the root-owned `/etc/claude-sender.env` file. The script:

1. Rejects any invocation with arguments (`[ $# -ne 0 ] → exit 1`) — primary injection defence
2. Reads from the fixed staging path `/opt/claude-usage-optimizer/data/.env-staging`
3. Copies to `/etc/claude-sender.env` with `chmod 600 / chown root:root`
4. Restarts `claude-tracker` service (treats restart failure as warning — env file already written)
5. Deletes the staging file to prevent plaintext secrets lingering on disk
6. All error output goes to stderr for journald capture

The sudoers entry in `scripts/install.sh` step 12 was verified correct:
```
claude-tracker ALL=(ALL) NOPASSWD: /opt/claude-usage-optimizer/scripts/write-env.sh
```
Mode 440 set by installer. Narrowly scoped: exactly one script, no wildcards, no ALL commands.

## Threat Model Mitigations Applied

| Threat | Mitigation |
|--------|-----------|
| T-07-01: Shell injection via args | `[ $# -ne 0 ]` guard — exits before any action |
| T-07-02: Staging file tampering | Fixed path, validates file exists before copy |
| T-07-03: Env file world-readable | `chmod 600` + `chown root:root` applied immediately after copy |
| T-07-04: Sudoers entry too broad | Verified exact-script scope in install.sh (line 165) |
| T-07-05: API passes malicious arg | Helper rejects all args; sudoers won't exec with unexpected args |
| T-07-06: Service restart failure | Warning only — env write is atomic, restart can be retried |

## Deviations from Plan

None — plan executed exactly as written. Task 2 was informational (verify sudoers entry); install.sh already had the correct entry at line 165.

## Known Stubs

None.

## Self-Check: PASSED

- [x] `scripts/write-env.sh` exists and is executable (mode 755)
- [x] Commit 2da8776 verified in git log
- [x] `bash -n scripts/write-env.sh` passes (no syntax errors)
- [x] `grep "NOPASSWD.*write-env.sh" scripts/install.sh` → line 165 confirmed
- [x] `grep "chmod 440" scripts/install.sh` → line 167 confirmed
