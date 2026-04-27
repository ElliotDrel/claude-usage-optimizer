---
status: partial
phase: 07-installer-onboarding
source: [07-VERIFICATION.md]
started: 2026-04-27T19:20:15Z
updated: 2026-04-27T19:20:15Z
---

## Current Test

[awaiting human testing on real Ubuntu 22.04 VM]

## Tests

### 1. Timed dry-run — installer completes under 30 minutes

expected: Provision a fresh GCP e2-micro Ubuntu 22.04 VM, run `bash <(curl -fsSL https://raw.githubusercontent.com/elliotdrel/claude-usage-optimizer/main/scripts/install.sh)`, and measure wall-clock time from command entry to "Installation complete" message. Should be under 30 minutes end-to-end.
result: [pending]

### 2. Wizard end-to-end — credentials written and service restarts

expected: After installer completes, open SSH tunnel (`ssh -L 3018:127.0.0.1:3018 ...`), visit http://127.0.0.1:3018 in browser, get redirected to /setup, fill in OAuth token + usage auth + timezone, click Complete Setup. Verify: `/etc/claude-sender.env` has mode 600 with real credentials, `systemctl status claude-tracker` shows active/running, browser lands on dashboard (no further /setup redirect), and `sqlite3 /opt/claude-usage-optimizer/data/usage.db "SELECT value FROM app_meta WHERE key='setup_complete';"` returns `true`.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
