# Claude API Endpoint Research

Investigation of how to access Claude usage and billing data without scraping the Claude.ai website.

**Date:** 2026-05-01
**Status:** Investigation complete; rate limit test pending

---

## TL;DR

- **Claude Code (CC)** = `api.anthropic.com` → rate limit / quota data → **Bearer token** auth
- **Claude.ai (.ai)** = `claude.ai/api` → billing / account data → **session cookie** auth
- The two domains are not interchangeable. Bearer token gets 403 on claude.ai. Cookie gets nothing extra on api.anthropic.com.
- **`/api/oauth/usage` is aggressively rate-limited.** Hitting it ~10 times in quick succession produces a 429 with `retry-after: 3600` (1 hour).
- For a **standalone server** (this project's deployment model), Bearer token + aggressive caching is the only viable path. Statusline hooks and message-response-header tricks don't apply.

---

## 1. OAuth Bearer Token Endpoint (CC)

### `GET https://api.anthropic.com/api/oauth/usage`

**Auth:**
```
Authorization: Bearer <CLAUDE_CODE_OAUTH_TOKEN>
anthropic-beta: oauth-2025-04-20
```

Token is auto-stored by Claude Code at `~/.claude/.credentials.json` under `claudeAiOauth.accessToken`.

**Full response shape (all 11 fields):**
```json
{
  "five_hour":            { "utilization": <int 0-100>, "resets_at": "<ISO timestamp>" },
  "seven_day":            { "utilization": <int 0-100>, "resets_at": "<ISO timestamp>" },
  "seven_day_sonnet":     { "utilization": <int 0-100>, "resets_at": "<ISO timestamp>" },
  "seven_day_opus":       null,
  "seven_day_oauth_apps": null,
  "seven_day_cowork":     null,
  "seven_day_omelette":   { "utilization": <int 0-100>, "resets_at": <ISO timestamp|null> },
  "tangelo":              null,
  "iguana_necktie":       null,
  "omelette_promotional": null,
  "extra_usage": {
    "is_enabled":    <bool>,
    "monthly_limit": <int cents|null>,
    "used_credits":  <int cents|null>,
    "utilization":   <int 0-100|null>,
    "currency":      "<ISO 4217 code|null>"
  }
}
```

`null` fields appear to indicate inactive/unconfigured features (e.g. no Opus access on subscription tier, no promotional credits granted).

### Rate Limiting (CRITICAL)

- No public limit documented.
- Observed: hammering the endpoint ~10 times rapidly returns `HTTP 429` with `retry-after: 3600`.
- Once locked out, **stays locked for the full hour** — no early recovery, even with backoff.
- Community consensus: **5-minute minimum polling interval** is safe.
- Anthropic GitHub issues acknowledging this:
  - [#31637](https://github.com/anthropics/claude-code/issues/31637) — "aggressively rate limits"
  - [#31021](https://github.com/anthropics/claude-code/issues/31021) — "persistent 429"
  - [#32503](https://github.com/anthropics/claude-code/issues/32503) — "/usage command fails"
- **Anthropic has not fixed this.** Issues marked "invalid".

### Exact rate limit (TODO)

A precise burst test is pending — currently in cooldown. Plan: fire requests back-to-back counting successes until first 429, log retry-after.

---

## 2. Claude.ai Cookie Endpoints (.ai)

All under `https://claude.ai/api/organizations/{orgId}/...` with `Cookie: <full session cookie>` and browser-like headers (`User-Agent`, `Referer`, `Origin`, `Sec-Fetch-*`, `anthropic-client-platform: web_claude_ai`).

`{orgId}` is in the cookie as `lastActiveOrg=...`.

### `/usage`

Same fields as the OAuth endpoint above. Redundant if you have Bearer token access.

### `/overage_spend_limit` ✅

```json
{
  "organization_uuid":      "<uuid>",
  "limit_type":             "<organization|seat|...>",
  "is_enabled":             <bool>,
  "monthly_credit_limit":   <int cents>,
  "currency":               "<ISO 4217>",
  "used_credits":           <int cents>,
  "disabled_reason":        "<string|null>",
  "disabled_until":         "<ISO timestamp|null>",
  "out_of_credits":         <bool>,
  "discount_percent":       <number|null>,
  "discount_ends_at":       "<ISO timestamp|null>",
  "settings":               <object|null>,
  "created_at":             "<ISO timestamp>",
  "updated_at":             "<ISO timestamp>"
}
```

### `/prepaid/credits` ✅

```json
{
  "amount":                       <int cents>,
  "currency":                     "<ISO 4217>",
  "auto_reload_settings":         <object|null>,
  "pending_invoice_amount_cents": <int|null>,
  "last_paid_purchase_cents":     <int|null>
}
```

### `/prepaid/bundles` ✅

```json
{
  "bundles": [
    { "id": "<bundle_id>", "credit_minor_units": <int>, "price_minor_units": <int>, "discount_minor_units": <int> }
  ],
  "bundle_paid_this_month_minor_units": <int>,
  "bundle_monthly_cap_minor_units":     <int>,
  "purchases_reset_at":                 "<ISO timestamp>",
  "currency":                           "<ISO 4217>",
  "stripe_product_id":                  "<prod_xxx>",
  "custom_discount_tiers": [
    { "min_credit_minor_units": <int>, "max_credit_minor_units": <int|null>, "discount_pct": <int> }
  ]
}
```

### `/overage_credit_grant` ✅

```json
{
  "available":          <bool>,
  "eligible":           <bool>,
  "granted":            <bool>,
  "amount_minor_units": <int|null>,
  "currency":           "<ISO 4217|null>"
}
```

### `/payment_method` ✅

```json
{
  "brand":   "<card brand>",
  "country": "<ISO country code>",
  "last4":   "<4 digits>",
  "type":    "<card|...>"
}
```

### Cloudflare gotcha

- Bearer token does **not** work against `claude.ai` endpoints — returns 403 HTML challenge.
- Cookie + browser-like headers is the only working combination.
- Cookie expires periodically and requires manual refresh from browser DevTools — **breaks the "non-technical user, zero-config install" constraint.**

---

## 3. Message Response Headers (zero extra calls)

Every regular `POST /v1/messages` response includes rate limit info as headers:

```
anthropic-ratelimit-unified-5h-utilization:        <0.0–1.0>     // fraction
anthropic-ratelimit-unified-5h-reset:              <unix ts>
anthropic-ratelimit-unified-5h-status:             allowed|blocked
anthropic-ratelimit-unified-7d-utilization:        <0.0–1.0>
anthropic-ratelimit-unified-7d-reset:              <unix ts>
anthropic-ratelimit-unified-7d-status:             allowed|blocked
anthropic-ratelimit-unified-overage-utilization:   <0.0–1.0>
anthropic-ratelimit-unified-overage-reset:         <unix ts>
anthropic-ratelimit-unified-overage-status:        allowed|blocked
anthropic-ratelimit-unified-representative-claim:  five_hour|seven_day|overage
anthropic-ratelimit-unified-reset:                 <unix ts>
anthropic-ratelimit-unified-status:                allowed|blocked
anthropic-ratelimit-unified-fallback-percentage:   <0.0–1.0>
```

**Why this doesn't help us:** This project is a standalone polling server, not a Claude Code client. We are not making message calls; the user's local Claude Code is. We have no way to intercept those headers.

(For Claude Code statusline tools, this is the holy grail — zero extra API calls. Just not applicable here.)

---

## 4. How Claude Code Itself Reads Usage

- Claude Code calls `/api/oauth/usage` infrequently (likely on startup + periodically) and **caches in process memory.**
- `/usage` slash command and the statusline both read from this cache, not live API.
- **We cannot use any of this on a standalone server** — there's no Claude Code process running.

### Statusline stdin payload

On every prompt Claude Code invokes the statusline script and passes a JSON object via stdin. The relevant shape:

```json
{
  "model": { "display_name": "<model name>" },
  "session_id": "<uuid>",
  "workspace": { "current_dir": "<path>" },
  "context_window": {
    "total_tokens": <int>,
    "remaining_percentage": <0-100>
  },
  "rate_limits": {
    "five_hour": { "used_percentage": <0-100> },
    "seven_day": { "used_percentage": <0-100> }
  }
}
```

The statusline reads `data.rate_limits.five_hour.used_percentage` and `data.rate_limits.seven_day.used_percentage` directly — no API call needed.

### Context bridge file (existing pattern)

Claude Code already writes a bridge file to disk on every prompt for the context monitor hook:

```
$TEMP/claude-ctx-{session_id}.json
```

Contents:
```json
{
  "session_id": "<uuid>",
  "remaining_percentage": <0-100>,
  "used_pct": <0-100>,
  "timestamp": <unix seconds>
}
```

We considered extending this pattern to also write rate limit data to a `claude-usage-{session}.json` bridge file, so a local server could read it with zero API calls. **Not viable for this project** — the server runs on GCP, not the user's local machine.

### Community workaround: `~/.claude/usage-exact.json`

Some open-source statusline tools (e.g. `claude-code-statusline`) use a shared cache file at `~/.claude/usage-exact.json`. Multiple Claude Code windows on the same machine share it — only the first window past the timeout actually calls the API; the rest read from cache. Recommended polling interval: 300s minimum.

This file does **not** exist by default; it's written by third-party statusline scripts. Not useful for a remote server deployment.

---

## 5. Undocumented Paths Discovered

From grepping the Claude Code CLI binary and GitHub issue search.

### `api.anthropic.com`

**Confirmed working with Bearer token:**
- `/api/oauth/usage` — quota data (rate limited)
- `/v1/messages` — sending messages (returns rate headers)

**Found in CLI binary, not tested:**
- `/api/oauth/claude_cli/client_data` — CLI OAuth client metadata
- `/api/oauth/claude_cli/create_api_key` — create API keys
- `/api/oauth/claude_cli/roles` — user roles/permissions
- `/api/claude_cli_feedback`
- `/api/claude_code/metrics`
- `/api/claude_code/organizations/metrics_enabled`
- `/api/claude_code_shared_session_transcripts`
- `/api/directory/servers`
- `/api/web/domain_info?domain=`
- `/v1/agents`, `/v1/agents/{id}`, `/v1/agents/{id}/archive`, `/v1/agents/{id}/versions`
- `/v1/code/sessions`, `/v1/code/sessions/{id}`, plus archive/bridge/events/teleport variants
- `/v1/code/github/`, `/v1/code/github/{pr}`, `/v1/code/github/import-token`
- `/v1/code/slack/`, `/v1/code/slack/{thread}`
- `/v1/code/triggers`, `/v1/code/triggers/{id}`, `/v1/code/triggers/{id}/run`
- `/v1/code/egress/gateway`, `/v1/code/upstreamproxy`
- `/v1/environments`, `/v1/environments/{id}`, plus archive/bridge/reconnect
- `/v1/files`, `/v1/files/{id}`, `/v1/files/{id}/content`
- `/v1/logs`, `/v1/traces`
- `/v1/memory_stores`, `/v1/memory_stores/{id}`, plus archive/memories/versions/redact
- `/v1/messages/batches`, `/v1/messages/batches/{id}`, `/v1/messages/batches/{id}/cancel`
- `/v1/messages/count_tokens`
- `/v1/models`, `/v1/models/{id}`, `/v1/models?limit=1000`
- `/v1/oauth/token`, `/v1/oauth/hello`
- `/v1/sessions`, `/v1/sessions/{id}`, plus archive/events/events/stream
- `/v1/skills`, `/v1/skills/{id}`, `/v1/skills/{id}/versions`, `/v1/skills/{id}/versions/{version}`
- `/v1/complete`
- `/mcp-registry/v0/servers`

**Tried with Bearer token (all 404 or 403):**
- `/api/oauth/overage_spend_limit`, `/api/oauth/prepaid/credits`, `/api/oauth/billing`, etc. — guesses for billing paths. None exist on api.anthropic.com.
- `/api/organizations/{orgId}/...` — exists but rejects Bearer token (403).

### `claude.ai`

- `/api/desktop/darwin/universal/dmg/latest/redirect`
- `/api/desktop/win32/x64/exe/latest/redirect`
- `/api/organizations/{orgId}/usage`
- `/api/organizations/{orgId}/overage_spend_limit`
- `/api/organizations/{orgId}/prepaid/credits`
- `/api/organizations/{orgId}/prepaid/bundles`
- `/api/organizations/{orgId}/overage_credit_grant`
- `/api/organizations/{orgId}/payment_method`

---

## 6. Decision Matrix for This Project

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| **Bearer token + 5-min cache** | Zero-config, self-renewing token | Rate limit cooldown if abused, no billing data | ✅ Use this |
| **Cookie scraping** | Full billing data | Cookie expires, manual refresh, breaks UX constraint | ❌ Drop |
| **Message-header piggyback** | Zero extra API calls | Server doesn't make message calls; not applicable | ❌ Not viable for our deployment |
| **Statusline bridge file** | Free fresh data | Server doesn't run Claude Code locally | ❌ Not viable |

**Recommendation:** drop cookie auth entirely. Use Bearer token with 5-minute minimum poll interval. Accept that billing/credits/payment data is not available.

### What we lose by dropping cookie

The five `claude.ai` billing endpoints (overage_spend_limit, prepaid/credits, prepaid/bundles, overage_credit_grant, payment_method).

Currently these are collected and stored as raw JSON but **not parsed or displayed anywhere in the dashboard**. So no immediate functional loss. The user noted these were collected "for use later" — losing the option to build features around them is the real cost.

---

## 7. Open Questions

- [ ] Exact rate limit ceiling on `/api/oauth/usage` (burst test pending, currently in cooldown)
- [ ] Whether `/api/oauth/claude_cli/client_data` and similar CLI-specific paths return anything useful for a polling server
- [ ] Whether Anthropic plans to expose a properly rate-limited public usage endpoint

---

## 8. Reproduction

These findings can be reproduced with simple `fetch` calls — see the curl/JS snippets implied by the request shapes in sections 1 and 2. Test scripts used during the original investigation were not committed (they contained hardcoded credentials).
