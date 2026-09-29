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

## Which stores the trial opens

The trial starts from a fresh, empty store. Loam needs no legacy import (greenfield, Myk,
2026-09-25). The recordings and tests already build each store from a new `MemoryBackend` or a
new sqlite file in a temp dir.

- **The seam's read has three results.** `readImage` reports `empty`, `image` or
  `rows-without-image`. The last one fails closed.
- **A new store.** Loam creates the empty peer image first, by compare-and-set. The adapter
  checks, in the same transaction, that the store holds no rows. Then everything enters through the
  door with a local origin, the incarnation marker included.
- **A trial store with an image.** `openSinglePeer` decodes the image directly. The image holds
  the full admitted DeltaSet, all arrival records, the refusals, the counters and the active
  obligations. Nothing is replayed from raw rows as admission (`step6-staging-open.md`).
- **The image is the authority over the rows.** The sqlite adapter keeps delta rows for serving.
  Before it exposes them, it checks them against the image's admitted ids. A missing or corrupt
  admitted row fails closed. An extra raw row is not admitted.
- **A store with rows and no image.** The trial path refuses to open it, and names the reason.
  It never makes up arrival times or refusals from old rows. That store stays on today's path.

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

- It does NOT run the same checks as append. Its per-delta filter (:882-903) is: protected
  ingress, `verifiesAgainstHeld`, refused re-entry, `publicDefect`, `artifactDefect`,
  `eraseDefect` (reads the batch), `slateDefect`, `recoveryDefect` (reads the batch), a paused
  author, a cut for this store, a cut manifest, and the slate cite. Then the admit predicate:
  the caller's `admit`, or the trust policy (`admitForImpl`, :458).
- It never calls `authorize`. So it runs no constitutional, trust, binding-policy, envelope,
  container or budget check, and no write-standing check. A signed malformed grant that append
  refuses can cross this door under an explicit `admit`. The trial keeps each door's checks as
  they are, and does not widen or narrow either one.
- Batch passes follow: negation closure (:910), erasures of erasures (:917), erased in the batch
  (:919), and a fixpoint that removes orphans (:925-938).
- The report gives counts only, with no reason per delta, by design (:866).
- **No sending peer.** `federateImpl` takes no sender, and no caller knows a sender key.
  `pullFrom` (federation/pull.ts:175) knows a URL and a token. The CLI import (cli.ts:2217) has
  only a file or a URL. Admin federation (server/admin-federation.ts:503), the erase fan-out
  (erase.ts:1513) and the scratch store (server/admin.ts:435) have neither. So every federation
  arrival in the trial is unattributed, until a caller supplies an authenticated PeerId.
- **No trusted receive time.** Author clocks are signed claim times.

## State that overlaps the substrate's

| Loam today | Where it lives | Substrate counterpart |
| --- | --- | --- |
| arrival order, `arrivalLog()` | in memory, rebuilt from backend order (sqlite `seq`) | arrival records with sequence, time and sender |
| refused ids, `refusedIds` | derived from erasures on every call (erase.ts:246) | persisted `refusedIds` and refusal events |
| erasure standings (`owed`, `unasked`) | computed on demand (erase.ts:1404) | persisted purge obligations |
| per-author budget | operator deltas; "used" counted over the reactor | `quotaUsed`, `capacity` |

During the trial both sides compute these. Any disagreement is a finding.

## Writes that do not pass the doors

- `Gateway.open` writes the incarnation marker to the backend directly (gateway.ts:609-610). In the
  trial it enters through the door.
- Replay on open and on `reseat` ingests from the backend (gateway.ts:572, 1354).
- Derived emissions arrive through the raw stream with no door (`attachPersistence`,
  gateway.ts:543).
- `MirrorBackend.heal` and `repair` work on the backend before boot.
- Erase purges call `backend.purge` and then `reseat`.

The trial names each of these as outside admission, or routes it. It never lets one write the
image around the planner.

## Shared code with pools

A pool is a `Gateway.open` instance (container.ts:1698). It runs the same doors. Its
`attachedTo` is set only AFTER `Gateway.open` returns (:1702), and the admin scratch gateway
(server/admin.ts:410) never sets it. So `attachedTo === undefined` does not identify the host.

The trial uses an explicit opt-in instead. The caller passes the peer image store as an option
to `Gateway.open` and `Gateway.boot`. Only a gateway given that store takes the substrate path.
The container code, the channel code and the admin scratch store never pass it, so pools,
quarantine and scratch gateways stay on today's path from their first line. A rail pins this.

The host's recovery barrier and `erasureStandings` read pool state, and pool reseed calls
`pool.federate`. Those stay as they are.

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

## Results (2026-09-29)

The trial ran on rhizomatic `7e7f098`, on the unmerged branch `claude/step6-host-trial`. Its
`refactor/trial/RESULTS.md` holds the numbers. In short:

- On a 4,042-delta store, one append takes about 1.2 s on the image path, against 3.3 ms today.
  Each commit re-verifies every admitted signature and re-encodes the whole image. Sol accepts
  this as a merge blocker, and works on an incremental storage contract.
- The image records the arrivals of one transfer in id order. This broke the recovery barrier
  after a reopen (see below).
- Loam must serialize its own commits per peer: the door and the write-through both commit.

## The recovery barrier and transfers (settled with Sol, 2026-09-29)

SPEC-6 §3 orders the arrivals of one transfer by ascending id. They share one transfer ordinal
and are simultaneous. Today `loam user recover` writes the host's cut, the cut manifest and the
recovery record in ONE append, and the door requires the manifest AHEAD of the record in that
batch (`manifestAhead`, `manifestDefect`, recovery-cut.ts). On the image path that order is lost.

The change, before the host moves to the image path:

- `loam user recover` writes the cuts and the manifest in one transfer, the host's own cut
  included, and the record in a later transfer.
- The door admits a manifest only if every cut it names is already held, or is admitted in the
  manifest's own transfer. A manifest can never bind a cut that arrives after it.
- The door admits a retiring record only behind a manifest held from an EARLIER transfer, and
  only if that manifest passed the rule above. A manifest in the same transfer as its record no
  longer counts. The record's admission keeps that proof: the manifest id and its transfer.
- This rule lives at the door, because direct operator-signed appends do not pass through
  `loam user recover`. The recover journal only settles a failed CLI attempt (rerun or abort).
- Every "arrived before" question in the barrier compares transfer ordinals, never positions
  inside one transfer.

This change reopens a design that took four review rounds (#640), so it lands as its own design
note and PR, with the barrier's rails.

## Trial rails

- The recordings run against the trial branch and against main. Every move is explained.
- A two-sided refusal rail: an erased id is refused at both doors, and a live bystander is
  admitted.
- The substrate's refused set and Loam's `refusedIds` agree on a store with erasures.
- An append refused by a batch-level check leaves the image byte-identical.
- An atomic append with one failing candidate commits no image and no delta row.
- A federation receive with no known sender records an unattributed arrival, never a PeerId.
- A store with rows and no image is refused on the trial path, and its bytes do not change.
- Two concurrent empty-image creations: exactly one commits.
- Empty-image creation over a store that already holds a row refuses, and writes nothing.
- A reopen with an admitted row missing fails closed. An extra raw row is not served.
- A pool, a quarantine pool and the admin scratch gateway write no image, even when the host
  was opened with one.
