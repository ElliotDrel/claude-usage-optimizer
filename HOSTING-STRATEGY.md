# HOSTING-STRATEGY.md — Deploy Claude Usage Optimizer to GCP

> **For non-technical users:** This guide walks you through deploying the Claude Usage Optimizer to a free Google Cloud VM in under 30 minutes.

---

## Overview

You will set up a single Google Cloud VM running the Claude Usage Optimizer — a Next.js app that observes your Claude.ai usage and schedules messages to optimize your 5-hour window.

**What you'll get:**
- One systemd service (`claude-tracker.service`) that runs automatically and recovers from crashes
- A dashboard at `http://127.0.0.1:3018` (accessible via SSH tunnel)
- Nightly backups of your data to Google Cloud Storage
- Optional Discord notifications for send failures

**Time estimate:** 25–30 minutes for someone who has never deployed a Node.js app before.

---

## Prerequisites

Before you start, make sure you have:

1. **Google Cloud account** with billing enabled (you won't be charged — everything runs on the Always Free tier)
2. **Claude Code OAuth token** from `claude setup-token` (run on your laptop, not the VM)
3. **SSH client** or ability to use GCP's browser-based SSH
4. **Comfort with copy-pasting commands** (no deep CLI knowledge required)

---

## Step 1: Get Your OAuth Token (On Your Laptop)

This is a one-time setup step. Run this on your local machine (not the VM):

```bash
# macOS / Linux
claude setup-token

# Windows (PowerShell)
claude setup-token
```

This opens your browser, completes OAuth, and prints a token that looks like:
```
sk-ant-oat-xxxxxxxxxxxxxx...
```

**Copy this token — you'll paste it into the VM in Step 5.**

---

## Step 2: Create the Google Cloud VM

Go to [Google Cloud Console](https://console.cloud.google.com).

1. In the search bar, type **"Compute Engine"** and click **"Create Instance"**
2. Fill in:
   - **Name:** `claude-optimizer`
   - **Region:** `us-central1` (closest to US, always free)
   - **Zone:** `us-central1-a` (any zone in us-central1)
   - **Machine type:** `e2-micro` (under "General purpose")
   - **Boot disk:** Ubuntu 22.04 LTS, Standard persistent disk, 30 GB
3. Click **"Create"** and wait ~30 seconds for the VM to start

Once it's running, you'll see it listed with a green checkmark.

---

## Step 3: Connect to the VM

Click the **SSH** button next to your VM name (opens a browser terminal). You now have a command line on the VM.

---

## Step 4: Prepare the VM (Copy-Paste This Entire Block)

Copy the entire block below and paste it into the SSH terminal:

```bash
# Update system packages
sudo apt-get update
sudo apt-get install -y git sqlite3 curl

# Add 2 GB swap (your VM has 1 GB RAM; swap helps during Node.js startup)
if [ ! -f /swapfile ]; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Google Cloud CLI (for backup uploads)
curl https://sdk.cloud.google.com | bash
exec -l $SHELL

# Create the directory where we'll install the app
sudo mkdir -p /opt/claude-usage-optimizer
sudo chown "$USER" /opt/claude-usage-optimizer

# Clone the repository
cd /opt/claude-usage-optimizer
git clone https://github.com/elliotdrel/claude-usage-optimizer.git .

# Install Node dependencies and build
npm install
npm run build
```

This takes about 2–3 minutes. When it finishes, you should see no errors.

---

## Step 5: Configure Secrets (OAuth Token & Environment)

Replace `YOUR_OAUTH_TOKEN` below with the token you copied in Step 1, then paste the entire block:

```bash
# Create the environment file (holds your OAuth token and configuration)
sudo tee /etc/claude-sender.env > /dev/null <<'EOF'
# Security: This file contains your OAuth token. It must have mode 600 (readable by service only).

# OAuth Authentication
CLAUDE_CODE_OAUTH_TOKEN=YOUR_OAUTH_TOKEN

# Server Binding (never change these)
HOSTNAME=127.0.0.1
PORT=3018
NODE_ENV=production

# GCS Backup Bucket (you'll fill this in after creating the bucket)
GCS_BACKUP_BUCKET=claude-optimizer-backups

# Optional: Discord webhook for failure notifications (add later if you want)
# DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
EOF

# Secure the file: readable by root and the service user only
sudo chmod 600 /etc/claude-sender.env

# Verify correct permissions (should show: -rw-------)
ls -l /etc/claude-sender.env
```

**Important:** The output of `ls -l` should show `-rw-------` (6 dashes at the end). If it shows `-rw-r--r--`, the file is world-readable and anyone on the VM could see your OAuth token. Fix it with: `sudo chmod 600 /etc/claude-sender.env`

---

## Step 6: Create the Non-Root Service User

```bash
# Create a dedicated user for the service (doesn't need a login shell)
sudo useradd -r -s /bin/bash -d /opt/claude-usage-optimizer claude-tracker
```

---

## Step 7: Install the Systemd Service

Copy the service unit file from the repo to the systemd directory:

```bash
sudo cp /opt/claude-usage-optimizer/claude-tracker.service /etc/systemd/system/

# Reload systemd to recognize the new unit file
sudo systemctl daemon-reload

# Enable the service so it starts automatically on reboot
sudo systemctl enable claude-tracker

# Start the service now
sudo systemctl start claude-tracker

# Check that it's running (you should see "active (running)" in green)
sudo systemctl status claude-tracker
```

If you see `active (running)`, congratulations — the app is now running!

---

## Step 8: Post-Deploy Verification Checklist

Run these commands one by one to verify everything is working:

### Check 1: Service Health
```bash
sudo systemctl status claude-tracker
```
**Expected:** Shows `active (running)` in green and no errors.

### Check 2: Scheduler is Ticking
```bash
sudo journalctl -u claude-tracker -n 20
```
**Expected:** Recent logs show messages like `[scheduler] Scheduler started` or `[instrumentation] Collector started`.

### Check 3: Database Tick Timestamp
```bash
sudo sqlite3 /opt/claude-usage-optimizer/data/usage.db "SELECT value FROM app_meta WHERE key='last_tick_at';"
```
**Expected:** Shows a timestamp like `2026-04-23T12:34:56Z`. If empty, wait 1 minute and try again.

### Check 4: First Send Logged
```bash
sudo sqlite3 /opt/claude-usage-optimizer/data/usage.db "SELECT status FROM send_log ORDER BY fired_at DESC LIMIT 1;"
```
**Expected:** Shows `ok`, `error`, or `timeout`. If empty, wait a few minutes and try again (the scheduler fires on a schedule, not immediately).

### Check 5: Service Can Access Claude CLI
```bash
sudo -u claude-tracker bash -c "source /etc/claude-sender.env && claude --version"
```
**Expected:** Prints the Claude CLI version (e.g., `1.2.3`). If it hangs or says "not authenticated", the OAuth token is wrong or the CLI is not installed correctly.

If all five checks pass, your deployment is complete and working!

---

## Step 9: Set Up Backups

Backups run automatically every night at 04:15 UTC. First, create a Google Cloud Storage bucket.

### Create a GCS Bucket

Go to [Google Cloud Console](https://console.cloud.google.com), click **"Cloud Storage"** → **"Buckets"** → **"Create Bucket"**.

Fill in:
- **Name:** Something unique, like `claude-optimizer-backups-YOUR_INITIALS` (must be globally unique)
- **Location:** `us-central1`
- **Storage class:** `Standard`

Click **"Create"**.

Note the bucket name (e.g., `claude-optimizer-backups-ED`).

### Update Your Environment File

Edit `/etc/claude-sender.env` and replace `claude-optimizer-backups` with your actual bucket name:

```bash
sudo nano /etc/claude-sender.env
```

Find the line:
```
GCS_BACKUP_BUCKET=claude-optimizer-backups
```

Change it to:
```
GCS_BACKUP_BUCKET=claude-optimizer-backups-YOUR_INITIALS
```

Save (Ctrl+X, then Y, then Enter).

Restart the service:
```bash
sudo systemctl restart claude-tracker
```

### Set Backup Retention Policy

Backups older than 30 days are automatically deleted. Configure this with:

```bash
cat > /tmp/lifecycle.json << 'EOF'
{
  "rule": [
    {
      "action": {"type": "Delete"},
      "condition": {"age": 30}
    }
  ]
}
EOF

gcloud storage buckets update gs://YOUR_BUCKET_NAME --lifecycle-file=/tmp/lifecycle.json
```

Replace `YOUR_BUCKET_NAME` with your actual bucket name from the step above.

**Verify:**
```bash
gcloud storage ls gs://YOUR_BUCKET_NAME/backups/daily/ 2>/dev/null | head -1
```

After 04:15 UTC tonight, this should show at least one `.db.gz` file.

---

## Step 10: Set Up Notifications (Optional)

If you want Discord notifications when a send fails, follow these steps.

### Create a Discord Webhook

1. Go to your Discord server
2. Right-click the channel where you want notifications → **Edit Channel**
3. Click **Integrations** → **Webhooks** → **New Webhook**
4. Copy the webhook URL (looks like `https://discord.com/api/webhooks/123456/abcdef`)

### Add the Webhook to Your Config

```bash
# Edit the environment file
sudo nano /etc/claude-sender.env

# Uncomment and fill in the DISCORD_WEBHOOK_URL line:
# DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_WEBHOOK_HERE

# Save and exit (Ctrl+X, Y, Enter)

# Restart the service
sudo systemctl restart claude-tracker
```

Now, if any send fails, you'll get a Discord message. You can add or remove the webhook at any time — just edit the file and restart.

---

## Access Your Dashboard

To view the dashboard, you need an SSH tunnel from your laptop to the VM:

```bash
# macOS / Linux / Windows PowerShell
gcloud compute ssh claude-optimizer --zone=us-central1-a -- -NL 3018:127.0.0.1:3018
```

Leave this command running. Then open your browser to:
```
http://127.0.0.1:3018
```

You should see the Claude Usage Optimizer dashboard with your schedule and send history.

---

## Troubleshooting

### Service won't start
```bash
sudo journalctl -u claude-tracker -n 50 -e
```
Check for errors. Common issues:
- `CLAUDE_CODE_OAUTH_TOKEN` not set or invalid
- OAuth token expired (run `claude setup-token` again on your laptop)
- Node.js not installed

### Can't access dashboard
- Check the SSH tunnel is running (the command from Step "Access Your Dashboard")
- Try `curl http://127.0.0.1:3018` from the VM to test locally
- Check firewall rules (VM should listen on 127.0.0.1 only)

### No backups appearing
- Wait until 04:15 UTC (nightly backup time)
- Check GCS_BACKUP_BUCKET is set correctly: `grep GCS_BACKUP_BUCKET /etc/claude-sender.env`
- Check the bucket exists: `gcloud storage ls gs://YOUR_BUCKET_NAME`

### Scheduler not ticking
```bash
sudo sqlite3 /opt/claude-usage-optimizer/data/usage.db "SELECT value FROM app_meta WHERE key='last_tick_at';"
```
If the timestamp is more than a few minutes old, the scheduler may be stuck. Restart the service:
```bash
sudo systemctl restart claude-tracker
```

---

## Next Steps

- **Monitor logs:** `journalctl -u claude-tracker -f` (live tail)
- **View send history:** Dashboard → Send History panel
- **Adjust schedule:** Dashboard → Schedule Overrides panel
- **Pause/resume:** Dashboard → Pause toggle

You're done! The app will now observe your Claude.ai usage and schedule sends automatically to optimize your 5-hour window.
