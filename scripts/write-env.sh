#!/bin/bash
# write-env.sh — Privileged helper: copy staged env file to /etc/claude-sender.env
#
# Invoked via sudo from the Next.js API route (src/app/api/setup/apply/route.ts).
# Accepts NO arguments — all paths are hardcoded. This design prevents shell
# injection: the API cannot pass malicious input through this script.
#
# Sudoers entry (created by installer at /etc/sudoers.d/claude-tracker, mode 440):
#   claude-tracker ALL=(ALL) NOPASSWD: /opt/claude-usage-optimizer/scripts/write-env.sh
#
# Security design (D-07):
#   - No arguments accepted ([ $# -ne 0 ] guard at top)
#   - All paths are fixed/hardcoded (no user input in path construction)
#   - Staging file is read from fixed location; deleted after successful merge
#   - Target file written with mode 600, ownership root:root
#   - Error messages go to stderr (>&2) for journald/syslog capture

set -eu

# ── Argument guard ────────────────────────────────────────────────────────────
# Reject any invocation that passes arguments. This is the primary injection
# defence: even if the caller tries to pass malicious input, the script exits
# before doing anything.
if [ $# -ne 0 ]; then
  echo "Error: write-env.sh accepts no arguments" >&2
  exit 1
fi

# ── Fixed paths (hardcoded, no user input) ────────────────────────────────────
STAGING_FILE="/opt/claude-usage-optimizer/data/.env-staging"
TARGET_FILE="/etc/claude-sender.env"

# ── Validate staging file exists ──────────────────────────────────────────────
if [ ! -f "$STAGING_FILE" ]; then
  echo "Error: staging file not found at $STAGING_FILE" >&2
  exit 1
fi

# ── Copy staging file to target with restrictive permissions ──────────────────
cp "$STAGING_FILE" "$TARGET_FILE"
chmod 600 "$TARGET_FILE"
chown root:root "$TARGET_FILE"
echo "Env file written to $TARGET_FILE (mode 600, root:root)" >&2

# ── Restart service to pick up new env ───────────────────────────────────────
# A non-zero exit from systemctl is treated as a warning, not a hard failure:
# the env file has already been written, and the service may be temporarily
# unavailable for a transient reason. The caller can retry or check status.
if systemctl restart claude-tracker; then
  echo "Service restarted successfully" >&2
else
  echo "Warning: systemctl restart returned non-zero, but env file was written" >&2
fi

# ── Clean up staging file ─────────────────────────────────────────────────────
# Force-remove so the staging file (which contains plaintext secrets) does not
# linger on disk after a successful merge.
rm -f "$STAGING_FILE"

echo "Setup complete: env written and service restarted" >&2
exit 0
