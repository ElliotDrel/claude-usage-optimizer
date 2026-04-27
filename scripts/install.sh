#!/bin/bash
# Claude Usage Optimizer — One-command installer for Ubuntu 22.04 e2-micro
#
# Usage:
#   bash <(curl -sL https://raw.githubusercontent.com/elliotdrel/claude-usage-optimizer/main/scripts/install.sh)
#   — or locally: sudo bash ./scripts/install.sh
#
# Requirements: Ubuntu 22.04 LTS, run as root or via sudo.
# Idempotent: safe to re-run on an already-provisioned VM.
#
# Sources:
#   NodeSource Node.js 20 repo: https://deb.nodesource.com/setup_20.x
#   Sudoers patterns: https://www.cyberciti.biz/faq/linux-unix-running-sudo-command-without-a-password/

set -e
set -u

# ── Error trap ──────────────────────────────────────────────────────────────
trap 'echo ""; echo "ERROR: Installer failed at line $LINENO. Review the output above." >&2; exit 1' ERR

# ── Constants ────────────────────────────────────────────────────────────────
REPO_URL="https://github.com/elliotdrel/claude-usage-optimizer.git"
REPO_DIR="/opt/claude-usage-optimizer"
SERVICE_USER="claude-tracker"
ENV_FILE="/etc/claude-sender.env"
SYSTEMD_UNIT="/etc/systemd/system/claude-tracker.service"
SUDOERS_FILE="/etc/sudoers.d/claude-tracker"
DB_PATH="${REPO_DIR}/data/usage.db"

echo ""
echo "=== Claude Usage Optimizer Installer ==="
echo "Target: ${REPO_DIR}"
echo ""

# ── Step 1: Verify running as root ──────────────────────────────────────────
if [ "$(id -u)" -ne 0 ]; then
  echo "Error: Installer must be run as root or via sudo." >&2
  echo "  Run:  sudo bash ./scripts/install.sh" >&2
  exit 1
fi

# ── Step 2: Update package lists ─────────────────────────────────────────────
echo "[1/14] Updating package lists..."
apt-get update -qq

# ── Step 3: Install system packages ──────────────────────────────────────────
echo "[2/14] Installing system packages (git, curl, sqlite3)..."
apt-get install -y git curl sqlite3

# ── Step 4: Provision 2 GB swap (idempotent) ─────────────────────────────────
echo "[3/14] Checking swap..."
if [ ! -f /swapfile ]; then
  echo "  Creating 2 GB swap file..."
  dd if=/dev/zero of=/swapfile bs=1G count=2 status=none
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  # Append only if not already present in fstab
  if ! grep -q '/swapfile' /etc/fstab; then
    echo "/swapfile none swap sw 0 0" >> /etc/fstab
  fi
  echo "  Swap created and activated (2 GB)."
else
  echo "  Swap file already exists, skipping."
fi

# ── Step 5: Install Node.js 20 via NodeSource (idempotent) ──────────────────
echo "[4/14] Checking Node.js..."
NODE_OK=false
if command -v node > /dev/null 2>&1; then
  NODE_VER="$(node --version)"
  if echo "${NODE_VER}" | grep -q '^v20\.'; then
    NODE_OK=true
    echo "  Node.js 20 already installed: ${NODE_VER}"
  else
    echo "  Node.js found but wrong version (${NODE_VER}), upgrading to 20..."
  fi
fi

if [ "${NODE_OK}" = "false" ]; then
  echo "  Installing Node.js 20 from NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
  echo "  Node.js installed: $(node --version)"
fi

# ── Step 5b: Install Claude Code CLI (idempotent) ─────────────────────────────
echo "[4b/14] Checking Claude Code CLI..."
if ! command -v claude > /dev/null 2>&1; then
  echo "  Installing Claude Code CLI..."
  npm install -g @anthropic-ai/claude-code
  echo "  Claude Code CLI installed: $(claude --version 2>/dev/null || echo 'ok')"
else
  echo "  Claude Code CLI already installed: $(claude --version 2>/dev/null || echo 'ok')"
fi

# ── Step 6: Create service user (idempotent) ──────────────────────────────────
echo "[5/14] Checking service user..."
if ! id -u "${SERVICE_USER}" > /dev/null 2>&1; then
  echo "  Creating system user ${SERVICE_USER}..."
  useradd --system --home /nonexistent --shell /bin/false "${SERVICE_USER}"
  echo "  User created."
else
  echo "  Service user ${SERVICE_USER} already exists."
fi

# ── Step 7: Clone or update repository ────────────────────────────────────────
echo "[6/14] Setting up repository at ${REPO_DIR}..."
if [ ! -d "${REPO_DIR}/.git" ]; then
  echo "  Cloning repository..."
  git clone "${REPO_URL}" "${REPO_DIR}"
else
  echo "  Repository already exists, pulling latest..."
  git -C "${REPO_DIR}" pull origin main
fi

# ── Step 8: Install dependencies and build ────────────────────────────────────
# Install ALL deps first (build tools like TypeScript/Tailwind are devDeps),
# build, then prune to production-only. Running --omit=dev before build fails.
echo "[7/14] Installing npm dependencies..."
cd "${REPO_DIR}"
npm ci

echo "[8/14] Building Next.js app..."
npm run build

echo "  Pruning dev dependencies after build..."
npm prune --omit=dev

# ── Step 9: Set up data directory (owned by service user) ────────────────────
echo "[9/14] Setting up data directory..."
mkdir -p "${REPO_DIR}/data"
chown "${SERVICE_USER}:${SERVICE_USER}" "${REPO_DIR}/data"
chmod 750 "${REPO_DIR}/data"

# ── Step 10: Pre-create env file with placeholder values ──────────────────────
echo "[10/14] Creating ${ENV_FILE} with placeholder values..."
# Always write placeholders so wizard has a clean file to replace.
# Secrets are never written here — wizard fills them post-install.
cat > "${ENV_FILE}" << 'ENVEOF'
CLAUDE_CODE_OAUTH_TOKEN=
CLAUDE_SESSION_COOKIE=
CLAUDE_BEARER_TOKEN=
user_timezone=America/Los_Angeles
GCS_BACKUP_BUCKET=
ENVEOF
chmod 600 "${ENV_FILE}"
chown root:root "${ENV_FILE}"
echo "  ${ENV_FILE} created (mode 600, root-owned)."

# ── Step 11: Initialize SQLite database with setup_complete='false' (D-03) ────
# The app_meta table must exist before the app runs so the proxy can read it.
# We create the schema here (identical to src/lib/db.ts SCHEMA) and insert the
# setup_complete flag. INSERT OR REPLACE is idempotent on re-run.
echo "[11/14] Initializing SQLite database (setup_complete='false')..."
sqlite3 "${DB_PATH}" << 'SQLEOF'
CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR REPLACE INTO app_meta (key, value) VALUES ('setup_complete', 'false');
SQLEOF
# Transfer ownership to service user so the app can read/write the DB at runtime
chown "${SERVICE_USER}:${SERVICE_USER}" "${DB_PATH}"
chmod 640 "${DB_PATH}"
echo "  Database initialized. setup_complete='false' written."

# Verify the row was written correctly
if ! sqlite3 "${DB_PATH}" "SELECT value FROM app_meta WHERE key='setup_complete';" | grep -q '^false$'; then
  echo "ERROR: setup_complete verification failed — DB row not written correctly." >&2
  exit 1
fi
echo "  Verified: setup_complete='false' confirmed in database."

# ── Step 12: Install sudoers entry for write-env.sh ───────────────────────────
echo "[12/14] Installing sudoers entry..."
# Narrowly scoped: only write-env.sh, no wildcards, no ALL
cat > "${SUDOERS_FILE}" << 'SUDOEOF'
# Claude Usage Optimizer: allow service user to write /etc/claude-sender.env via helper
claude-tracker ALL=(ALL) NOPASSWD: /opt/claude-usage-optimizer/scripts/write-env.sh
SUDOEOF
chmod 440 "${SUDOERS_FILE}"
echo "  Sudoers entry installed at ${SUDOERS_FILE} (mode 440)."

# Validate sudoers file syntax
if command -v visudo > /dev/null 2>&1; then
  if ! visudo -c -f "${SUDOERS_FILE}" > /dev/null 2>&1; then
    echo "ERROR: sudoers file syntax check failed." >&2
    exit 1
  fi
  echo "  Sudoers syntax validated."
fi

# ── Step 13: Copy systemd unit file and enable service ───────────────────────
echo "[13/14] Installing and enabling systemd service..."
cp "${REPO_DIR}/claude-tracker.service" "${SYSTEMD_UNIT}"
chmod 644 "${SYSTEMD_UNIT}"
systemctl daemon-reload
systemctl enable claude-tracker.service
echo "  Service enabled (will start on boot)."

# ── Step 14: Start the service ────────────────────────────────────────────────
echo "[14/14] Starting claude-tracker service..."
systemctl start claude-tracker.service
# Give the service a moment to start
sleep 2
if systemctl is-active --quiet claude-tracker.service; then
  echo "  Service is active and running."
else
  echo ""
  echo "WARNING: Service did not start within 2 seconds." >&2
  echo "  Check status: systemctl status claude-tracker" >&2
  echo "  Check logs:   journalctl -u claude-tracker -n 50" >&2
  echo ""
  echo "This may be expected if the system is slow to initialize." >&2
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "=== Installation Complete ==="
echo ""
echo "The service is starting. Access the setup wizard at:"
echo ""
echo "  http://127.0.0.1:3018"
echo ""
echo "If accessing from your local machine via SSH, open a tunnel:"
echo ""
echo "  ssh -L 3018:127.0.0.1:3018 <user>@<vm-ip>"
echo ""
echo "Then visit http://127.0.0.1:3018 in your browser to complete setup."
echo ""
echo "To verify service status: systemctl status claude-tracker"
echo "To view logs:             journalctl -u claude-tracker -f"
echo ""
exit 0
