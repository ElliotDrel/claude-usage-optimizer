# Deployment Lessons — First Real-VM Rollout (2026-05-01)

This doc captures every issue hit during the first end-to-end deployment by a non-technical user, with diagnosis and fix. Each entry is structured so you can paste it into a future-user troubleshooting flow.

The user went from "I have a GCP account and an OAuth token" to "running app firing real sends" in roughly 90 minutes — most of which was issue-hunting, not actual install time. After the fixes captured here are merged, the same flow should take 30–45 minutes.

---

## Pre-deploy issues

### L01 — Repo private, installer URL returns 404

**Symptom:** `bash <(curl -fsSL https://raw.githubusercontent.com/.../install.sh)` returns `curl: (22) The requested URL returned error: 404`.

**Diagnosis:** GitHub returns 404 (not 403) for unauthenticated requests to private repos. Easy to misread as "wrong URL".

**Fix:** Make the repo public, or use a Personal Access Token in the URL: `https://PAT@raw.githubusercontent.com/...`.

**Doc impact:** HOSTING-STRATEGY.md Step 1 now starts with "Make sure the repo is reachable".

---

### L02 — Personal data in committed file

**Symptom:** Before going public, a security scan found a committed terminal session log containing the user's name and email (`2026-04-16-185348-okay-i-need-to-consolidate-the-two-different-fun.txt`).

**Diagnosis:** A Claude Code session log was accidentally committed during early development. It contained "Welcome back Elliot!" and the user's email.

**Fix:** `git rm` the file and commit. Note that the data still lives in git history; rewriting history would erase it but is destructive on a solo repo. The user accepted leaving the historical traces.

**Pattern to prevent recurrence:** Add `*.txt` patterns matching session-log filenames to `.gitignore`, or scan staged files in a pre-commit hook.

---

## GCP setup issues

### L03 — Billing must be enabled even for the free tier

**Symptom:** `Billing account for project '...' is not found. Billing must be enabled for activation of service(s) 'compute.googleapis.com' to proceed.`

**Diagnosis:** GCP requires a billing account linked to any project that activates Compute Engine, even if all resources are within Always Free limits.

**Fix:** Add a credit card to a billing account, link to the project. No charges occur as long as Always Free limits hold.

**Doc impact:** HOSTING-STRATEGY.md Step 3 now explicitly walks through this.

---

### L04 — GCP "Create Instance" defaults are wrong on three axes

**Symptom:** Default `gcloud compute instances create` from the GCP UI generates a command with `--machine-type=e2-medium`, Debian 12 image, 10 GB pd-balanced disk.

**Diagnosis:** Each default deviates from what the project needs:

| Default | Should be | Cost/breakage if used |
|---|---|---|
| `e2-medium` | `e2-micro` | $25/mo (e2-medium is not free-tier) |
| Debian 12 / Ubuntu 24.04 | Ubuntu 22.04 LTS | Installer is tested only on 22.04; 24.04 *might* work, Debian's apt sources differ |
| 10 GB pd-balanced | 30 GB pd-standard | 10 GB fills up after Node + build; pd-balanced costs ~$1/mo |
| Ubuntu 22.04 LTS Minimal | Ubuntu 22.04 LTS (full) | Minimal is missing packages the installer assumes |

**Fix:** HOSTING-STRATEGY.md Step 4 now has an explicit table showing the correct value for each setting and *why* the default is wrong.

---

### L05 — GCP cost estimator misleads on Always Free

**Symptom:** With e2-micro + 30 GB standard disk in us-central1, the GCP UI estimator showed "$7.31/month".

**Diagnosis:** The estimator does not subtract Always Free credits — those apply at billing time. The actual charge is $0 as long as the resources stay within Always Free limits.

**Fix:** Add a callout in HOSTING-STRATEGY.md telling users to ignore the estimator. Document the actual Always Free constraints (one e2-micro, us-central1, ≤30 GB standard disk, ≤1 GB egress/month).

---

## SSH and tunneling issues

### L06 — GCP browser SSH has no port forwarding option

**Symptom:** User wants to access `127.0.0.1:3018` from their laptop. The GCP browser SSH gear menu only has Theme/Font/Copy preference/Show Scrollbar — no port forward.

**Diagnosis:** GCP's browser SSH is a thin wrapper that doesn't expose the standard SSH `-L` flag.

**Fix:** Document that you must install the gcloud SDK locally (or use any SSH client with the gcloud-generated key).

**Doc impact:** HOSTING-STRATEGY.md Step 6 now has separate paths for gcloud SDK vs. native SSH.

---

### L07 — gcloud SDK on Windows uses PuTTY by default and breaks

**Symptom:** `gcloud compute ssh ... -- -NL 3018:127.0.0.1:3018` exits with `[putty.exe] exited with return code [1]`.

**Diagnosis:** On Windows, gcloud invokes its bundled `putty.exe` binary, which doesn't accept the `-NL` flag combination cleanly. Trying to override with `--ssh-key-file="$env:USERPROFILE\.ssh\..."` failed because the PowerShell variable wasn't being expanded by gcloud's argument parser, leading to a literal path containing `$env:USERPROFILE`.

**Fix:** Skip gcloud's SSH wrapper entirely. Use the native `ssh` command with the key file gcloud already generated at `~/.ssh/google_compute_engine`:

```powershell
ssh -i "$env:USERPROFILE\.ssh\google_compute_engine" -L 3018:127.0.0.1:3018 -N user@VM_IP
```

**Doc impact:** HOSTING-STRATEGY.md Step 6 → "Option B" documents this.

---

### L08 — Windows file permissions break SSH key/config

**Symptom:** `Bad permissions. Try removing permissions for user: UNKNOWN\\UNKNOWN` and `Bad owner or permissions on C:\\Users\\.../.ssh/config`.

**Diagnosis:** OpenSSH on Windows refuses to use keys/config files that grant access to multiple Windows accounts (inherited Windows ACLs from parent folders).

**Fix:**
```powershell
icacls "$env:USERPROFILE\.ssh\config" /inheritance:r /grant:r "${env:USERNAME}:F"
icacls "$env:USERPROFILE\.ssh\google_compute_engine" /inheritance:r /grant:r "${env:USERNAME}:F"
```

`/inheritance:r` strips the broad inherited ACLs; `/grant:r "${USERNAME}:F"` gives only the current user full access.

---

### L09 — `bash <(curl ...)` fails on Ubuntu 22.04 in `sudo` context

**Symptom:** `sudo bash <(curl -fsSL ...)` returns `bash: /dev/fd/63: No such file or directory`.

**Diagnosis:** Process substitution (`<(...)`) opens a file descriptor in the parent shell's `/dev/fd/`. When `sudo` switches user/security context, the FD is no longer accessible to the child.

**Fix:** Use the two-step form:
```bash
curl -fsSL URL -o /tmp/install.sh && sudo bash /tmp/install.sh
```

**Doc impact:** HOSTING-STRATEGY.md Step 5 uses the two-step form by default.

---

## Installer issues

### L10 — Swap allocation OOM-killed on 1 GB RAM VM

**Symptom:**
```
[3/14] Checking swap...
  Creating 2 GB swap file...
/tmp/install.sh: line 65: 3749 Killed                  dd if=/dev/zero of=/swapfile bs=1G count=2 status=none
ERROR: Installer failed at line 54.
```

**Diagnosis:** `dd bs=1G count=2` requests a 1 GB block read on a VM with 1 GB RAM and no swap yet. The kernel OOM-killer terminates `dd` before the swap file is even ready.

**Fix:** Allocate the file in smaller blocks:
```bash
dd if=/dev/zero of=/swapfile bs=128M count=16
```

This allocates the same 2 GB total but never tries to buffer more than 128 MB at once.

**Code impact:** Already fixed in `scripts/install.sh`.

---

### L11 — `npm ci` fails because `package-lock.json` was gitignored

**Symptom:**
```
[7/14] Installing npm dependencies...
npm error code EUSAGE
npm error The `npm ci` command can only install with an existing package-lock.json...
```

**Diagnosis:** Earlier `.gitignore` excluded `package-lock.json` (probably to "keep the repo clean"). But `npm ci` requires it for reproducible installs.

**Fix:** Remove `package-lock.json` from `.gitignore` and commit the lock file. `npm ci` now succeeds.

**Code impact:** Already fixed.

**Pattern to prevent recurrence:** Never gitignore `package-lock.json` in a project that runs `npm ci` anywhere (CI, installer, Dockerfile, etc.).

---

### L12 — `npm audit fix --force` is a trap

**Symptom:** Running `npm audit fix --force` on the user's local machine downgraded Next.js from v16 to v9 and broke the entire app.

**Diagnosis:** `--force` permits SemVer-major downgrades when one fix in the chain only exists in an older version. Next.js's huge transitive dep graph triggers this aggressively.

**Fix:** Restore via `git checkout package.json package-lock.json && npm install`. Never run `npm audit fix --force` on a project whose dependencies are pinned by lockfile.

**Pattern:** The vulnerabilities flagged are mostly in transitive deps that are not on the request path of a localhost-only app. They're noise here.

---

### L13 — `write-env.sh` had no execute bit in git

**Symptom:** Setup wizard returns 500. Server logs show:
```
sudo: /opt/claude-usage-optimizer/scripts/write-env.sh: command not found
```
But the file *exists* at that path.

**Diagnosis:** `command not found` from `sudo` means the file isn't executable. Git stored the file with mode `100644` even though local working copy was `100755`. Likely the script was created on Windows (where Git ignores execute bits unless `core.fileMode=true`).

**Fix:**
```bash
git update-index --chmod=+x scripts/write-env.sh
git commit -m "fix: set executable bit on write-env.sh"
```

**Code impact:** Already fixed.

---

### L14 — `start:prod` had Windows `set VAR=...` syntax

**Symptom:** systemd journal showed cluttered output:
```
> set APP_HOST=127.0.0.1&& set PORT=3018&& set AUTO_OPEN_BROWSER=false&& next start --hostname 127.0.0.1 --port 3018
```

**Diagnosis:** The `set` command is Windows cmd syntax. On Linux it's interpreted as `set` (display-shell-vars), which silently no-ops. The `&&` chain still ends in `next start`, so it works **by accident** — but env vars APP_HOST/PORT/AUTO_OPEN_BROWSER never actually got set.

**Fix:** Drop the `set` prefix. Pass binding directly via `--hostname` and `--port` flags. Defaults inside `config.ts` handle the rest.

**Code impact:** Already fixed in `package.json`.

---

## Application issues

### L15 — Setup wizard accepts non-IANA timezone

**Symptom:** User entered `New York` as the timezone (intuitive but wrong).

**Diagnosis:** The app expects IANA format like `America/New_York`. Bare city names break `Intl.DateTimeFormat` and quietly produce wrong scheduling.

**Fix (manual):** Edit `/etc/claude-sender.env` to use `user_timezone=America/New_York`.

**Future fix (UI):** Setup wizard should validate against the IANA timezone list and reject bare names. A datalist of common IANA values would help.

---

### L16 — Cookie has special characters; `sed` breaks updating it

**Symptom:**
```
sed: -e expression #1, char 3251: unterminated `s' command
```

**Diagnosis:** Claude.ai session cookies contain `;`, `=`, `/`, and sometimes characters `sed` interprets as delimiters/anchors. Even with delimiter swapping, the cookie's length and embedded special chars break `sed -i 's/.../X/'` patterns.

**Fix:** Encode the new value in base64, then decode on the VM:

```bash
# Local
echo -n 'COOKIE_VALUE' | base64

# VM
echo 'BASE64_BLOB' | base64 -d | sudo tee /etc/claude-sender.env > /dev/null
```

**Future fix (UI):** Add a "Refresh Auth" button on the dashboard that re-runs the setup wizard's auth fields without losing the rest of the config.

---

### L17 — claude CLI silently outputs nothing when HOME is `/nonexistent`

**Symptom:** Sends complete with status `ok`, duration ~30 sec, **but `response_excerpt` is null**. The Send History panel shows "(no response)".

**Diagnosis (took longest to find):** The `claude-tracker` system user is created with `useradd --system --home /nonexistent --shell /bin/false`. The Claude Code CLI tries to read/write its config in `$HOME/.claude/`, fails silently when the directory doesn't exist or isn't writable, and produces no output to stdout — but exits with code 0.

Validation: running `claude -p "hi"` as `claude-tracker` with `HOME=/tmp/claude-home` works fine. Running with default `HOME=/nonexistent` produces empty output.

**Fix:** When spawning the subprocess in `src/lib/sender.ts`, override `HOME`:
```ts
const claudeHome = path.join(os.tmpdir(), "claude-home");
const child = spawn("claude", [...], {
  env: { ...process.env, HOME: claudeHome },
});
```

**Code impact:** Already fixed.

**Pattern:** Any third-party CLI invoked from a system-user-owned process should be tested with `HOME=/nonexistent` to catch this class of bug.

---

### L18 — `npm prune --omit=dev` then `git pull` breaks rebuild

**Symptom:** After `git pull` + `npm run build` (skipping `npm ci`), service crashes:
```
Error: Could not find a production build in the '.next' directory.
```

**Diagnosis:** The installer runs `npm prune --omit=dev` after the initial build, which removes TypeScript, Tailwind, and the Next.js compiler — they're devDeps. Re-running `npm run build` later requires those back. Skipping `npm ci` leaves the prune-stripped state.

**Fix (operational):** Always run the full sequence on update:
```bash
sudo git pull && sudo npm ci && sudo npm run build && sudo npm prune --omit=dev && sudo systemctl restart claude-tracker
```

**Doc impact:** HOSTING-STRATEGY.md "Day-to-day operations" now lists the full update command.

---

### L19 — Send History shows newest at the bottom (UX confusion)

**Symptom:** User clicks "Send Now", waits 30 seconds, then thinks it failed because the history list "doesn't update". The new entry is actually appended to the **bottom** of the list (off-screen).

**Diagnosis:** `src/lib/analysis.ts:441-443` queries the 20 most recent rows with `ORDER BY fired_at DESC LIMIT 20`, then `.reverse()`s them before sending to the frontend.

The likely original intent was to render in chronological order (matching real-time logs). For a "history" panel, newest-first is more intuitive.

**Future fix (UX):** Either drop the `.reverse()` so the newest sits at the top, or scroll-anchor the panel to the latest entry on data update. Pinging `onRefetch` should also flash/highlight the new row.

---

### L20 — SSH tunnel drops on every service restart

**Symptom:** After running `sudo systemctl restart claude-tracker`, the browser shows `ERR_CONNECTION_REFUSED`. The user thinks the service is broken.

**Diagnosis:** The SSH tunnel multiplexes through the `127.0.0.1:3018` port on the VM. When systemd kills the Next.js process, the tunnel's open channels error out (`channel 2: open failed: connect failed: Connection refused`). Tunneled fetches fail until the service restarts AND a new TCP connection is initiated.

**Fix:** Re-run the `ssh -L` tunnel command. Optionally use `-o ServerAliveInterval=60` to keep the SSH session healthier.

**Doc impact:** HOSTING-STRATEGY.md troubleshooting section calls this out.

---

## Build performance

### L21 — `next build` takes 5–8 minutes on e2-micro

**Symptom:** During install, the build step appears to hang. CPU is pinned at ~85%, but no progress messages for several minutes.

**Diagnosis:** e2-micro has 0.25 vCPU baseline (bursts to 2 with credits) and 1 GB RAM. Next.js + Turbopack build legitimately requires 5–8 minutes of wall time on this hardware. There are no progress bars between major build phases.

**Fix:** Wait. Set expectations in docs: "build takes 5–8 minutes — be patient!".

**Doc impact:** HOSTING-STRATEGY.md Step 5 sets this expectation.

---

## Aggregate impact on next user

After committing the L02 / L11 / L13 / L14 fixes (already done), and after publishing the new HOSTING-STRATEGY.md (this PR), a future user should hit **none** of L01–L14 except L01 (which is binary: repo is public or it isn't).

Remaining manual gotchas, in order of likely user impact:

1. **L05** — $7 estimator (must read doc to understand it's free)
2. **L06–L08** — SSH tunnel via gcloud (5–10 minutes of setup once)
3. **L15** — IANA timezone format (avoidable with a UI dropdown)
4. **L16** — cookie refresh procedure (every few weeks, ongoing)
5. **L19** — send history sort order (UX papercut)
6. **L21** — slow build (just expectations)

Future code work that would close most of the remaining gaps:

- Setup wizard: IANA timezone picker + a "test cookie" button that pings the usage endpoint live
- Dashboard: "Refresh Auth" button (re-uses setup wizard, doesn't lose other config)
- Send History panel: newest-first ordering, auto-scroll/highlight on new entries
- Installer: detect if `git pull` would lose `.next` and auto-`npm ci && build`

---

## What worked well

Worth preserving:

- **Idempotent installer.** Re-running was safe at every failure point. Saved hours of debugging.
- **Single env file.** All secrets in one place, with a privileged helper that the web process can call but never read directly. Setting up notifications/backups later is just appending lines.
- **systemd unit + journalctl.** Standard tooling. `journalctl -u claude-tracker -n 50` pulled up exactly the diagnostic info we needed every time.
- **SQLite on disk.** Inspecting `send_log` directly with `sqlite3 ... "SELECT ..."` confirmed the backend was working when the UI was confusing.
- **127.0.0.1 binding.** Even with the SSH key dance, never having a public listener removes a whole class of security risk.

The architecture survived contact with reality. The bugs were all peripheral.
