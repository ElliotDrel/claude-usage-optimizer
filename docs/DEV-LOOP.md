# Dev Loop Verification

End-to-end smoke test against a synthetic 7-day fixture. Takes under 10 minutes.

## 1. Seed synthetic snapshots

Open an `sqlite3` shell against your dev database:

```bash
sqlite3 data/usage.db
```

Paste the block below. It inserts two snapshots per day for 7 days — a baseline at `:00` and a spike at `:30` — concentrated at hour 14 UTC, giving peak-detector a clean signal.

```sql
INSERT INTO usage_snapshots (timestamp, status, endpoint, response_status, raw_json) VALUES
  ('2026-01-01T14:00:00Z','ok','usage',200,'{"five_hour_utilization":0,"five_hour_resets_at":"2026-01-01T15:00:00Z"}'),
  ('2026-01-01T14:30:00Z','ok','usage',200,'{"five_hour_utilization":80,"five_hour_resets_at":"2026-01-01T15:00:00Z"}'),
  ('2026-01-02T14:00:00Z','ok','usage',200,'{"five_hour_utilization":0,"five_hour_resets_at":"2026-01-02T15:00:00Z"}'),
  ('2026-01-02T14:30:00Z','ok','usage',200,'{"five_hour_utilization":80,"five_hour_resets_at":"2026-01-02T15:00:00Z"}'),
  ('2026-01-03T14:00:00Z','ok','usage',200,'{"five_hour_utilization":0,"five_hour_resets_at":"2026-01-03T15:00:00Z"}'),
  ('2026-01-03T14:30:00Z','ok','usage',200,'{"five_hour_utilization":80,"five_hour_resets_at":"2026-01-03T15:00:00Z"}'),
  ('2026-01-04T14:00:00Z','ok','usage',200,'{"five_hour_utilization":0,"five_hour_resets_at":"2026-01-04T15:00:00Z"}'),
  ('2026-01-04T14:30:00Z','ok','usage',200,'{"five_hour_utilization":80,"five_hour_resets_at":"2026-01-04T15:00:00Z"}'),
  ('2026-01-05T14:00:00Z','ok','usage',200,'{"five_hour_utilization":0,"five_hour_resets_at":"2026-01-05T15:00:00Z"}'),
  ('2026-01-05T14:30:00Z','ok','usage',200,'{"five_hour_utilization":80,"five_hour_resets_at":"2026-01-05T15:00:00Z"}'),
  ('2026-01-06T14:00:00Z','ok','usage',200,'{"five_hour_utilization":0,"five_hour_resets_at":"2026-01-06T15:00:00Z"}'),
  ('2026-01-06T14:30:00Z','ok','usage',200,'{"five_hour_utilization":80,"five_hour_resets_at":"2026-01-06T15:00:00Z"}'),
  ('2026-01-07T14:00:00Z','ok','usage',200,'{"five_hour_utilization":0,"five_hour_resets_at":"2026-01-07T15:00:00Z"}'),
  ('2026-01-07T14:30:00Z','ok','usage',200,'{"five_hour_utilization":80,"five_hour_resets_at":"2026-01-07T15:00:00Z"}');
.quit
```

## 2. Start the dev server

```bash
npm run dev
```

Open http://localhost:3017 in your browser.

## 3. Observe the Optimal Schedule card

The dashboard should show:
- **Peak block:** 12:00–16:00 (midpoint 14:00 UTC)
- **Today's fires:** 5 times spaced 5 hours apart, anchor near 14:05

If the card is blank, the scheduler hasn't recomputed yet — click the dashboard's recompute trigger or wait for the 03:00 UTC nightly tick.

## 4. Pin override to fire in ~2 minutes

In the Overrides panel, set `Schedule Override Start Time` to 2 minutes from now (e.g. if it's 15:42, enter `15:44`). Click Save.

The schedule card should immediately update to show the new anchor time.

## 5. Verify the send_log row

Wait ~2 minutes, then check:

```bash
sqlite3 data/usage.db "SELECT fired_at, status, question FROM send_log ORDER BY id DESC LIMIT 3;"
```

You should see a row with `status = 'ok'` (or `'timeout'` if the claude CLI isn't authenticated — that's expected in pure dev environments). Either status confirms the scheduler ticked and the sender fired.

## 6. Clear override

Remove the override value in the Overrides panel and save to restore peak-detected scheduling.

---

**Test suite:** `npm test` — 128 tests, 0 failures across all modules.
