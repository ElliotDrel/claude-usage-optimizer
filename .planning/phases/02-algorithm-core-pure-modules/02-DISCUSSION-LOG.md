# Phase 2: Algorithm Core (Pure Modules) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-20
**Phase:** 02-algorithm-core-pure-modules
**Areas discussed:** Input type, Jitter testability, Fallback ownership, Delta computation

---

## Input type

| Option | Description | Selected |
|--------|-------------|----------|
| ParsedSnapshot[] | Phase 1 canonical type from queries.ts. Caller parses before handing off. | ✓ (Claude's Discretion) |
| SnapshotRow[] | Raw DB rows — peak-detector does its own JSON.parse internally. | |

**User's choice:** User deferred ("idk what this is im not a dev") — Claude chose `ParsedSnapshot[]`.
**Notes:** Obvious right call given Phase 1 landed `queries.ts` specifically to be the read-side abstraction.

---

## Jitter testability

| Option | Description | Selected |
|--------|-------------|----------|
| Range assertion only | Test checks each non-anchor fire lands within 0–5 min of its slot. | ✓ |
| Injectable randomizer | Tests pass a fake random() function to get deterministic boundary values. | |
| Seeded RNG | Seedable RNG alongside schedule.ts; tests pass fixed seed. | |

**User's choice:** Range assertion only (recommended)
**Notes:** After plain-language explanation of what jitter testing means, user selected the simplest option.

---

## Fallback ownership

| Option | Description | Selected |
|--------|-------------|----------|
| peak-detector returns null, schedule.ts handles fallback | schedule.ts accepts defaultSeedTime option. | ✓ |
| Caller handles it (Phase 4) | Both modules strictly pure; scheduler decides what to pass. | |

**User's choice:** peak-detector returns null, schedule.ts handles fallback (recommended)

---

## Delta computation

| Option | Description | Selected |
|--------|-------------|----------|
| Reimplement independently | peak-detector computes its own hourly buckets. No shared dep. | ✓ |
| Extract & share from analysis.ts | Pull bucketing logic into shared helper, import in both. | |

**User's choice:** Reimplement independently (recommended)

---

## Claude's Discretion

- Input type selection (user deferred — not a developer)
- TypeScript interface names for return types
- Timezone conversion implementation detail

## Deferred Ideas

- Shared hourly-bucketing helper — explicitly decided against
- Injectable randomizer for jitter — not needed
