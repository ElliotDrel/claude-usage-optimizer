# Phase 7: Installer & Onboarding - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-27
**Phase:** 07-installer-onboarding
**Areas discussed:** Installer scope, Wizard write permissions, First-run trigger, claude.ai auth field

---

## Installer Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Full automation | Script handles all of Step 4: apt packages, 2 GB swap, Node 20, gcloud CLI, git clone, npm build, systemd install + enable | ✓ |
| Partial — infra only | Script handles packages, swap, Node, and clone/build, but stops before systemd | |
| Minimal — bootstrap only | Script only installs Node + clones + runs a setup wizard server on port 3019 | |

**User's choice:** Full automation
**Notes:** User chose the option that most aggressively reduces manual steps — consistent with the non-technical-user deployability hard requirement.

---

## GCS Setup

| Option | Description | Selected |
|--------|-------------|----------|
| Leave GCS manual | Documented steps in HOSTING-STRATEGY.md; installer focuses on VM side | ✓ |
| Automate GCS setup too | Installer also creates GCS bucket and sets lifecycle rule via gcloud | |

**User's choice:** Leave GCS manual
**Notes:** GCS bucket creation requires project-level GCP config that's harder to automate safely in a generic script.

---

## Wizard Write Permissions

| Option | Description | Selected |
|--------|-------------|----------|
| Installer pre-creates file + sudo helper | Installer creates /etc/claude-sender.env with placeholders (600, root-owned). Wizard writes staging file, sudo helper merges it. | ✓ |
| Wizard displays copy-paste output | Wizard generates env file content, user pastes manually into SSH | |
| Installer creates writable env path | App uses /opt/claude-usage-optimizer/.env.local instead of /etc/claude-sender.env | |

**User's choice:** Installer pre-creates file (Recommended)
**Notes:** Keeps the "zero manual steps beyond curl" goal intact. The sudo helper is tightly scoped to prevent injection.

---

## First-Run Trigger

| Option | Description | Selected |
|--------|-------------|----------|
| app_meta flag | Installer writes setup_complete='false'; middleware redirects until wizard marks it true | ✓ |
| Env var presence check | Middleware checks whether CLAUDE_CODE_OAUTH_TOKEN is set | |
| Dedicated setup file | Installer writes a sentinel file; Next.js checks on startup | |

**User's choice:** app_meta flag (Recommended)
**Notes:** Cleanest separation between install state and env var presence. Consistent with the existing app_meta pattern.

---

## claude.ai Auth Field

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-detect bearer from credentials file | Wizard only asks for OAuth token; collector auto-reads ~/.claude/.credentials.json | |
| Wizard always asks for both | Two explicit fields: OAuth token + session cookie/bearer token | ✓ |

**User's choice:** Both (user clarified "nvm just use both")
**Notes:** The collector supports both cookie and bearer modes (see src/lib/config.ts). Wizard exposes a toggle between the two and always collects both auth values explicitly.

---

## Claude's Discretion

- Exact sudoers entry format
- Single-page vs multi-step wizard UI
- OAuth token validation before form submit
- Inline help text for credential collection

## Deferred Ideas

- GCS bucket creation automation (v2)
- Wizard token validation (stretch goal)
- ntfy.sh / Slack webhook support (v2, deferred from Phase 6)
