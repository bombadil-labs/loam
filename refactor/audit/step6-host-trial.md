# Step 6: the host-store trial (plan)

Status: plan, 2026-09-28. No code. It prepares the first consumer trial of rhizomatic's
single-peer admission API. Sol will publish that API as its own prerelease, with a "trial-ready"
notice. That notice is not the handoff-ready notice.

## The trial

- The HOST store is one peer. Its key is the receiving peer.
- The host's local append door and its federation receive admit through the substrate's planner.
  The substrate's durable image records admissions, refusals and arrivals.
- Pools, quarantine and every pool constructor do not change.
- The trial runs on an unmerged branch. The recordings under `refactor/recordings/` show what
  moved.
- The trial does not prove mergeability. The durable image rewrites the full admitted set on each
  commit. A write on a 4,000-delta store is about 10 ms today (#603, rhizomatic #46). A merge
  waits for an incremental image.

## What the prerelease provides (agreed with Sol, 2026-09-28)

- An atomic mode for local append (see "Settled with Sol").
- Barrel exports: the peer-state types, and the pure planners `planSignedLooseOrdinaryTransfer`,
  `planPermanentCommit` and `planArrivals`, with encode and decode.
- An empty-state constructor. Loam never builds an initial image by hand.
- A byte-image storage seam with compare-and-set. Loam implements it for sqlite and for
  `MemoryBackend`.
- Guard rejection reasons in the typed outcome.

## Today's host path

Main at `efacc63b`. Line numbers are for that commit.

### Local append

`Gateway.append` (gateway.ts:773) → `appendImpl` (ingest.ts:92) → `appendValidated` (:251) →
`admitting` (:270, a per-gateway promise chain) → `appendAdmitted` (:279) → `backend.append`
(:422) → ingest (:430).

Each check throws, so one failure refuses the whole batch. The checks, as candidate guards:

| Check | Where | Scope | Substrate outcome |
| --- | --- | --- | --- |
| protected ingress | ingest.ts:94 | batch (closure over the batch) | guard, run before the planner |
| write-failure latch | :283 | gateway state | stays Loam's |
| verified id and signature | :298 | per delta | `invalid` |
| erased, refused re-entry | :304 | per delta | `refused` |
| slate cite | :310 | per delta, reads the wall clock | guard |
| `authorize` (law defects, recovery pause, write standing) | :325, accounts.ts:739 | per delta; `eraseDefect` and `recoveryDefect` read the batch | guard |
| recovery barrier (cut manifest ahead) | :336-392 | batch, and reads pool reactors | guard, run before the planner |
| budget (per-author volume) | :398, budget.ts:192 | batch sum per author | Loam check, run before the planner |
| erasure of an erasure in the batch | :406 | batch | guard, run before the planner |
| erased by an erasure in the batch | :414 | batch | near `dependency-pruned`, but refuses the batch |

An ungoverned store skips `authorize`, the barrier and the budget.

### Federation receive

`Gateway.federate` (gateway.ts:1478) → `federateImpl` (ingest.ts:797) → `admitting` →
`federateAdmitted` (:839). This door filters per delta and drops instead of throwing.

- It runs the same lawful checks as append, then the trust-policy admit (`admitForImpl`, :458).
- It has no write-standing check and no budget.
- Batch passes follow: negation closure (:910), erasures of erasures (:917), erased in the batch
  (:919), and a fixpoint that removes orphans (:925-938).
- The report gives counts only, with no reason per delta, by design (:866).
- **No sending peer.** `federateImpl` takes no sender. Its callers know a URL and a token:
  `pullFrom` (federation/pull.ts:175), the CLI pull (cli.ts:2213), admin federation
  (server/admin-federation.ts:503), the erase fan-out (erase.ts:1513), and a scratch store
  (server/admin.ts:435).
- **No trusted receive time.** Author clocks are signed claim times.

## State that overlaps the substrate's

| Loam today | Where it lives | Substrate counterpart |
| --- | --- | --- |
| arrival order, `arrivalLog()` | in memory, rebuilt from backend order (sqlite `seq`) | arrival records with sequence, time and sender |
| refused ids, `refusedIds` | derived from erasures on every call (erase.ts:237) | persisted `refusedIds` and refusal events |
| erasure standings (`owed`, `unasked`) | computed on demand (erase.ts:1404) | persisted purge obligations |
| per-author budget | operator deltas; "used" counted over the reactor | `quotaUsed`, `capacity` |

During the trial both sides compute these. Any disagreement is a finding.

## Writes that do not pass the doors

- `Gateway.open` writes the incarnation marker to the backend directly (gateway.ts:600).
- Replay on open and on `reseat` ingests from the backend (gateway.ts:572, 1354).
- Derived emissions arrive through the raw stream with no door (`attachPersistence`,
  gateway.ts:543).
- `MirrorBackend.heal` and `repair` work on the backend before boot.
- Erase purges call `backend.purge` and then `reseat`.

The trial names each of these as outside admission, or routes it. It never lets one write the
image around the planner.

## Shared code with pools

A pool is a `Gateway.open` instance with `attachedTo` set (container.ts:1698). It runs the same
doors. So the trial gates on the host (`attachedTo === undefined`). The host's recovery barrier
and `erasureStandings` read pool state, and pool reseed calls `pool.federate`. Those stay as they
are.

## Settled with Sol (2026-09-28)

1. **Local append is atomic.** If any candidate fails, nothing commits: no image and no delta
   row. The unit gets one typed rejection with its reason. Guards stay per candidate. Loam runs
   its four batch checks once, under the same admission lock, before it calls the substrate.
2. **The budget stays Loam's.** The per-author volume budget is an application check. The
   substrate's `capacity` counts ordinary new ids, and is `Number.MAX_SAFE_INTEGER` for the
   trial.
3. **No invented sender keys.** The origin is typed: local, an authenticated PeerId, or
   explicitly unattributed. Unattributed gives an honest arrival marker, and it is never
   authenticated provenance. Federation receive is unattributed until a caller knows the sender's
   key.
4. **One transaction per commit.** The storage seam's adapter commits the image and the newly
   admitted delta rows together. For sqlite that is one transaction. For `MemoryBackend` it is one
   synchronous swap.

## Trial rails

- The recordings run against the trial branch and against main. Every move is explained.
- A two-sided refusal rail: an erased id is refused at both doors, and a live bystander is
  admitted.
- The substrate's refused set and Loam's `refusedIds` agree on a store with erasures.
- A pool append and a pool federate write no substrate image.
- An append refused by a batch-level check leaves the image byte-identical.
- An atomic append with one failing candidate commits no image and no delta row.
- A federation receive with no known sender records an unattributed arrival, never a PeerId.
