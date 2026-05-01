# HOSTING-STRATEGY.md — Deploy Claude Usage Optimizer to GCP

> **For non-technical users:** This guide walks you through deploying the Claude Usage Optimizer to a free Google Cloud VM in about 30–45 minutes (most of that is a single `npm` build that runs unattended).

---

## What you'll get

- One systemd service (`claude-tracker.service`) that runs automatically and recovers from crashes
- A dashboard at `http://127.0.0.1:3018` (accessible via SSH tunnel from your laptop)
- Optional nightly backups of your data to Google Cloud Storage
- Optional Discord notifications for send failures

**Cost:** $0/month forever, as long as you stay within the GCP **Always Free** tier (one e2-micro VM in us-central1, 30 GB standard disk).

---

## Prerequisites

Before you start, make sure you have:

1. **Google Cloud account** with **billing enabled** (you won't be charged — but a billing account must be linked even for free-tier resources)
2. **Claude Code OAuth token** from running `claude setup-token` on your laptop
3. **claude.ai session cookie** (you'll grab this from your browser DevTools in Step 6)
4. **Comfort with copy-pasting commands** (no deep CLI knowledge required)

---

## Step 1: Make sure the repo is reachable

The installer fetches itself from GitHub. The repo at `github.com/ElliotDrel/claude-usage-optimizer` must be **public** for the one-line installer to work, or you must use a Personal Access Token in the curl URL.

If you forked it: make your fork public via GitHub → Settings → Danger Zone → Change visibility → Public.

---

## Step 2: Get your OAuth Token (on your laptop)

Run this on your local machine:

```bash
claude setup-token
```

This opens your browser, completes OAuth, and prints a token like:

```
sk-ant-oat01-xxxxxxxxxxxxxx...
```

**Copy this — you'll paste it into the setup wizard in Step 7.**

---

## Step 3: Enable billing on your GCP project

Go to [console.cloud.google.com/billing](https://console.cloud.google.com/billing).

- If you have no billing account: click **"Manage billing accounts"** → **"Create account"** → add a credit card.
- Link the billing account to your project.

You will not be charged — Always Free covers everything in this guide.

---

## Step 4: Create the GCP VM

Go to **Compute Engine → Create Instance**. Use these exact settings — defaults will cost you money or break the installer:

| Setting | Value | Why this exact value |
|---|---|---|
| Name | `claude-optimizer` | Anything works, this is just the label |
| Region | `us-central1` (Iowa) | Always Free is region-locked |
| Zone | `us-central1-a` (or any us-central1) | |
| Machine type | **e2-micro** (not e2-medium!) | Default is e2-medium ($25/mo). e2-micro is $0/mo |
| Boot disk OS | **Ubuntu 22.04 LTS** (x86/64, **not Minimal, not Arm64**) | Installer is tested on 22.04. The Minimal variant is missing packages |
| Boot disk size | **30 GB** | Default is 10 GB which fills up after the build |
| Boot disk type | **Standard persistent disk** (not Balanced!) | Standard is free; Balanced costs ~$1/mo |

> **Estimator confusion:** GCP's monthly estimate will show ~$7. **Ignore it** — Always Free credits are applied at billing time, not in the estimator. Your actual charge will be $0 as long as you stay on e2-micro + standard disk in us-central1.

Click **Create** and wait ~30 seconds.

---

## Step 5: SSH to the VM and run the installer

Click the **SSH** button next to your VM in the GCP console (opens a browser terminal).

The simple `bash <(curl ...)` form fails on Ubuntu 22.04's default shell. Use this instead:

```bash
curl -fsSL https://raw.githubusercontent.com/ElliotDrel/claude-usage-optimizer/main/scripts/install.sh -o /tmp/install.sh && sudo bash /tmp/install.sh
```

The installer is idempotent — safe to re-run on failure.

What happens:

- Updates package lists, installs `git`, `curl`, `sqlite3`
- Provisions 2 GB swap file (chunked allocation; takes ~20 sec)
- Installs Node.js 20 from NodeSource
- Installs the Claude Code CLI globally (`npm i -g @anthropic-ai/claude-code`)
- Creates the `claude-tracker` service user
- Clones the repo to `/opt/claude-usage-optimizer`
- Runs `npm ci` (~1 min) and `npm run build` (~5–8 min on e2-micro — be patient!)
- Prunes devDependencies
- Installs systemd unit, sudoers entry, env file template
- Initializes the SQLite database with `setup_complete='false'`
- Enables and starts the service

Total time: **~10 minutes**. The build is the slowest step.

When it finishes you'll see:

```
=== Installation Complete ===
The service is starting. Access the setup wizard at:
  http://127.0.0.1:3018
```

---

## Step 6: Set up SSH port forwarding

You can't access `127.0.0.1:3018` from your laptop directly — the dashboard is bound to localhost on the VM only. You need an SSH tunnel.

GCP's browser SSH does **not** support port forwarding (no menu option for it). You need the **gcloud SDK installed locally**, or the native `ssh` client with the right key.

### Option A (recommended): Install gcloud SDK on your laptop

1. Download from [cloud.google.com/sdk/docs/install-sdk#windows](https://cloud.google.com/sdk/docs/install-sdk#windows) (or your OS)
2. Run the installer (defaults are fine, check "Run gcloud init" at the end)
3. Sign in with your Google account when prompted, select your project
4. The first time you SSH, gcloud generates an SSH key in `~/.ssh/google_compute_engine`

### Option B: Native SSH with the gcloud-generated key

If you've installed gcloud but it tries to use PuTTY (Windows default), bypass it with the native `ssh` command:

```powershell
# Windows PowerShell — fix key permissions first if needed
icacls "$env:USERPROFILE\.ssh\google_compute_engine" /inheritance:r /grant:r "${env:USERNAME}:F"

# Then open the tunnel (replace IP with your VM's external IP)
ssh -i "$env:USERPROFILE\.ssh\google_compute_engine" -L 3018:127.0.0.1:3018 -N elliotdrel@YOUR_VM_EXTERNAL_IP
```

```bash
# macOS / Linux
ssh -i ~/.ssh/google_compute_engine -L 3018:127.0.0.1:3018 -N USER@YOUR_VM_EXTERNAL_IP
```

Leave the terminal open. Then open **http://127.0.0.1:3018** in your browser.

> **If you see "Bad permissions on .ssh/config"**: run `icacls "$env:USERPROFILE\.ssh\config" /inheritance:r /grant:r "${env:USERNAME}:F"` (Windows) before retrying SSH.

---

## Step 7: Complete setup in the wizard

The first browser visit redirects you to a setup form with four fields:

| Field | What to enter |
|---|---|
| **Claude Code OAuth Token** | The `sk-ant-oat01-...` from Step 2 |
| **Usage Auth Type** | Choose **Session Cookie** (Bearer Token requires extra setup) |
| **Session Cookie value** | The full cookie header from claude.ai (see below) |
| **Timezone** | An IANA timezone like `America/New_York` (NOT just "New York" — must be in `Region/City` format) |
| **GCS Backup Bucket** | Optional — leave blank to skip backups |

### How to grab the session cookie

1. Open **claude.ai** in Chrome (make sure you're logged in)
2. Press **F12** to open DevTools
3. Go to the **Network** tab
4. Refresh the page
5. Click any request to `claude.ai` in the request list
6. Scroll the right pane down to **Request Headers** → find `cookie:` → copy the entire value (it's a long string with semicolons)

Paste this into the **Session Cookie** field.

Click **Complete Setup**. The wizard writes secrets to `/etc/claude-usage-optimizer.env` and restarts the service. You'll be redirected to the dashboard.

---

## Step 8: Verify everything works

On the dashboard, you should see:

- **Storage** card: shows snapshot count climbing
- **Optimal Schedule** card: shows today's 5 fire times
- **Send History**: starts empty; the next scheduled fire will populate it
- **No "Collector Error" red banner**

If you see `HTTP 403 / account_session_invalid`, your cookie is bad — go back to claude.ai DevTools and grab a fresh one (see "Refresh the cookie" in Troubleshooting).

To test sending immediately, click **Send Now**. The send takes ~30 seconds (real Claude API call). Watch the **bottom** of the Send History panel — entries are sorted oldest-first, so the new one appears at the bottom with a **Manual** badge.

---

## Step 9 (optional): Set up GCS backups

Backups run automatically every night at 04:15 UTC if you provide a bucket name.

1. Go to GCS console → **Buckets** → **Create**
2. Name: `claude-optimizer-backups-YOURINITIALS` (must be globally unique)
3. Location: `us-central1`
4. Storage class: `Standard`

Then set the env var on the VM:

```bash
sudo sed -i 's|^GCS_BACKUP_BUCKET=.*|GCS_BACKUP_BUCKET=YOUR_BUCKET_NAME|' /etc/claude-usage-optimizer.env
sudo systemctl restart claude-tracker
```

To auto-delete backups older than 30 days:

```bash
cat > /tmp/lifecycle.json << 'EOF'
{"rule":[{"action":{"type":"Delete"},"condition":{"age":30}}]}
EOF
gcloud storage buckets update gs://YOUR_BUCKET_NAME --lifecycle-file=/tmp/lifecycle.json
```

---

## Step 10 (optional): Discord failure notifications

Get a Discord webhook URL: server → channel → Edit Channel → Integrations → Webhooks → New Webhook → copy URL.

```bash
sudo sh -c 'echo "DISCORD_WEBHOOK_URL=YOUR_WEBHOOK_URL" >> /etc/claude-usage-optimizer.env'
sudo systemctl restart claude-tracker
```

---

## Refreshing the session cookie (every few weeks)

Claude.ai session cookies expire periodically. When the dashboard shows a 403 collector error:

1. Open claude.ai → DevTools → Network → click any request → copy the `cookie:` header value
2. Update on the VM (the cookie has special characters that break `sed`, so use base64):

```bash
# On your laptop, encode the cookie:
echo -n 'YOUR_COOKIE_VALUE_HERE' | base64

# Then on the VM:
sudo bash -c 'COOKIE_B64="PASTE_BASE64_HERE"; \
  COOKIE=$(echo "$COOKIE_B64" | base64 -d); \
  sed -i "/^CLAUDE_SESSION_COOKIE=/d" /etc/claude-usage-optimizer.env; \
  echo "CLAUDE_SESSION_COOKIE=$COOKIE" >> /etc/claude-usage-optimizer.env; \
  systemctl restart claude-tracker'
```

---

## Troubleshooting

### Installer 404 on `curl`
The repo is private. Make it public, or replace the URL with a Personal Access Token form:
`https://YOUR_PAT@raw.githubusercontent.com/...`

### `bash: /dev/fd/63: No such file or directory`
You ran `sudo bash <(curl ...)`. Use the two-step form: `curl ... -o /tmp/install.sh && sudo bash /tmp/install.sh`.

### Swap creation killed
Already fixed in the current installer — chunked allocation (16×128M). If you cloned an old version, manually create swap first:
```bash
sudo dd if=/dev/zero of=/swapfile bs=128M count=16 && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
```

### `npm ci` fails with EUSAGE / no `package-lock.json`
The `package-lock.json` was previously gitignored — it's now committed. Pull latest and re-run.

### Setup wizard returns 500
The privileged helper `write-env.sh` was missing the execute bit. Already fixed in current installer. If you're on an old install:
```bash
sudo chmod +x /opt/claude-usage-optimizer/scripts/write-env.sh
```

### Send history shows status `ok` but `response_excerpt` is null
The claude CLI silently fails when `HOME` points to a non-writable directory. The service user has `HOME=/nonexistent` by default. Already fixed in `src/lib/sender.ts` — pass `HOME=/tmp/claude-home` to the spawned subprocess.

### Service crashes with `Could not find a production build in the '.next' directory`
You ran `npm prune --omit=dev` (or `git pull`) without re-running `npm ci && npm run build` afterwards. Fix:
```bash
cd /opt/claude-usage-optimizer && sudo npm ci && sudo npm run build && sudo npm prune --omit=dev && sudo systemctl restart claude-tracker
```

### SSH tunnel drops mid-session
Service restarts kill the tunnel. Just re-run the `ssh -L` command from Step 6.

### Browser shows "Connection refused" / "site is down"
Your tunnel is closed, OR the service crashed. Run `sudo systemctl status claude-tracker` on the VM. If inactive, check `sudo journalctl -u claude-tracker -n 50`.

### Build never finishes
e2-micro build legitimately takes 5–8 minutes for `next build`. Confirm progress with:
```bash
ps aux | grep node | grep -v grep
```
If you see `node ... next build` consuming high CPU, it's working. If not, check the install output.

---

## Day-to-day operations

```bash
# Live log tail
sudo journalctl -u claude-tracker -f

# Service status
sudo systemctl status claude-tracker

# Restart after env changes
sudo systemctl restart claude-tracker

# Deploy code updates
cd /opt/claude-usage-optimizer
sudo git pull origin main
sudo npm ci
sudo npm run build
sudo npm prune --omit=dev
sudo systemctl restart claude-tracker

# Inspect database
sudo sqlite3 /opt/claude-usage-optimizer/data/usage.db "SELECT * FROM send_log ORDER BY fired_at DESC LIMIT 10;"
```

---

## What's next

- **Adjust schedule:** Dashboard → Schedule Overrides
- **Pause/resume:** Dashboard → Pause toggle
- **Manual send:** Dashboard → Send Now (response shows up at the bottom of Send History)
- **See what's coming:** Dashboard → Tomorrow tab on the schedule card

You're done.
