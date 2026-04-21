# Phase 5: Dashboard Control Surface - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-21
**Phase:** 05-dashboard-control-surface
**Areas discussed:** API shape, Override form UX, Layout & placement, Action feedback, Timezone display

---

## API reads

| Option | Description | Selected |
|--------|-------------|----------|
| Extend /api/dashboard | Add scheduleData + sendHistory to existing GET response | ✓ |
| Separate /api/schedule | New endpoint for schedule data | |
| You decide | Claude picks | |

**User's choice:** Extend /api/dashboard
**Notes:** One fetch, one refresh cycle — matches existing pattern.

---

## API writes

| Option | Description | Selected |
|--------|-------------|----------|
| Generic PATCH /api/app-meta | { key, value } handles all override fields + pause toggle | ✓ |
| Typed endpoints per action | Separate POST /api/overrides and POST /api/pause | |
| You decide | Claude picks | |

**User's choice:** Generic PATCH /api/app-meta
**Notes:** Matches app_meta key-value structure directly.

---

## Layout & placement

| Option | Description | Selected |
|--------|-------------|----------|
| Full-width row at top | New section above Collector/Utilization | ✓ (Claude's discretion) |
| Squeezed into top row | Alongside Collector/Utilization | |

**User's choice:** You decide — Claude picked full-width row at top.

---

## Tomorrow's preview

| Option | Description | Selected |
|--------|-------------|----------|
| Tab within Schedule card | Today/Tomorrow tabs inside one card | ✓ (Claude's discretion) |
| Separate card | Own section below | |

**User's choice:** You decide — Claude picked tab within Schedule card.

---

## Send Now feedback

| Option | Description | Selected |
|--------|-------------|----------|
| Immediate re-fetch | Re-fetches dashboard on success, row appears instantly | ✓ |
| Wait for 15s auto-refresh | No special handling | |

**User's choice:** Immediate re-fetch

---

## Pause toggle

| Option | Description | Selected |
|--------|-------------|----------|
| Confirm before pause | Dialog before pausing; no confirm to un-pause | ✓ |
| Immediate flip | No confirmation | |

**User's choice:** Confirm before pausing

---

## Override save confirmation

| Option | Description | Selected |
|--------|-------------|----------|
| Toast/flash notification | Brief "Schedule updated" toast | ✓ |
| Silent update | Schedule re-renders, no explicit confirmation | |

**User's choice:** Toast/flash notification ("Saved ✓")

---

## Timezone display

| Option | Description | Selected |
|--------|-------------|----------|
| Browser timezone default + mismatch alert | Show browser time; persistent banner if UTC offset differs from stored | ✓ |
| Always use app_meta.user_timezone | Show in configured timezone regardless of browser | |
| Always use browser timezone | No mismatch detection | |

**User's choice:** Browser timezone default. If browser UTC offset ≠ stored UTC offset, show persistent non-blocking notification. User approves update or dismisses. Store as UTC offset integer (e.g. -5), not IANA name. Only compare browser vs. stored — not two stored values against each other.

---

## Claude's Discretion

- Exact tab component implementation
- Override field save trigger (blur vs. per-field save button)
- Toast implementation (simple CSS transition, no new library)
- Confirm-before-pause: native window.confirm or inline modal
- Responsive breakpoints for Send History table
