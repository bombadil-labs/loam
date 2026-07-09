# Current work — Step 2: Persistence tier

_The live checklist for the step in progress: its success criteria, the sub-tasks (checked as they complete), and a "left off here" note so any model can resume mid-step. Replaced at the start of each step; cleared when a step merges._

**Success criteria (the gate):**

- An **async** `StoreBackend` seam: `append(deltas) → count`, `deltasSince(knownIds) → Delta[]`,
  `close()`. Delta-level only — no agent coupling (that was Chorus's shape, not Loam's).
- An in-memory driver and a durable sqlite driver (better-sqlite3 behind the async seam — local
  node 22.0.0 predates `node:sqlite`; the driver seam keeps libSQL/node:sqlite additive later).
- `append` is idempotent by id; `deltasSince(known)` returns exactly the complement; signed and
  unsigned deltas rehydrate identically (signatures still verify).
- Durable state survives close/reopen; a second handle on the same file sees the union.
- One **contract test suite parameterized over both drivers** — the interface is the asset.
- `npm run check` green.

**Sub-tasks:**

- [ ] `test/store/contract.test.ts` — the parameterized contract (tests first)
- [ ] `src/store/backend.ts` — the `StoreBackend` interface
- [ ] `src/store/memory.ts` — in-memory driver
- [ ] `src/store/sqlite.ts` — durable driver (WAL, one txn per batch, mark-durable-after-commit)
- [ ] `src/index.ts` — export the seam + drivers
- [ ] Gate green → branch → PR → **one** review agent → resolve → merge → journal

**Left off here:** plan written; next is the contract test.
