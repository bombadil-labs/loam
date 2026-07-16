## 2026-07-09 — Step 2: Persistence tier (PR #3)

The async `StoreBackend` seam — `append` (idempotent by id), `deltasSince` (order-free watermark
read), `close` — with two witnesses behind one parameterized contract suite: `MemoryBackend`
(a `DeltaSet` keeping its promises immediately) and `SqliteBackend` (better-sqlite3: `UNIQUE(id)`
as the CRDT dedup, WAL + busy-timeout, one `IMMEDIATE` transaction per batch, durable-after-
commit). Delta-level only — chorus's `refresh`/`persist` agent ergonomics were its shape, not
Loam's. 45/45 green.

Learnings worth keeping:

- **The async facade must be `async`.** Promise-returning methods wrapping sync internals leak
  synchronous throws (SQLITE_BUSY, closed handles) past every `.catch` unless the method itself
  is `async` — the keyword is load-bearing. The type-aware `require-await` lint fights this
  pattern; a file-scoped disable naming the reason is the honest resolution.
- **Stores canonicalize on the way in and fsck on the way out.** A delta whose id doesn't match
  its claims is refused (both drivers, one `canonicalDelta` gate); a stored row that no longer
  recomputes to
  its id is corruption and reads reject — never laundered into a differently-addressed delta.
  JSON cannot say `-0`, so the canonical form (which the id already agrees with — canonical CBOR
  collapses `-0`) is what every driver returns: driver substitution stays byte-identical.
- **Durable driver is better-sqlite3, not `node:sqlite`**: the local dev machine's node 22.0.0
  predates `node:sqlite` (22.5+). The seam keeps libSQL/node:sqlite additive for step 8. (An
  upgrade to node ≥22.13 would also quiet the engines warnings.)
- The review's single-agent format (per the new budget rule) caught seven real findings,
  including two the multi-agent panels' style of sweep might have — the leaner loop holds.
