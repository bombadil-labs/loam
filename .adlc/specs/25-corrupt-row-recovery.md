# T66 — a corrupt row that SQUATS on its id is replaceable from a healthy copy

**Ticket.** T66 (split from T57, whose DISCLOSURE half landed). **Amends** `spec/24-quarantine.md`
(§25 row quarantine gains a fourth honest end for a row a healthy copy exists for) and
`spec/08-persistence-federation.md` (the `RepairableBackend` seam gains one OPTIONAL member).

This is a **REPAIR of stated §25 behavior**: §25 already promises that what the quarantine holds is
"surfaced and settled by `loam repair`", and T57 already tells the operator that a quarantined
negation has stranded a strike. What is missing is the settling. No new on-wire delta shape, no §20
migration — the bytes and roles of every delta are untouched.

## The bug, at the level it actually lives

A corrupt negation row **squats on its id**. Four independent facts compose into a durable revival:

1. `deltas` declares `id TEXT NOT NULL UNIQUE` and `append` prepares
   `INSERT OR IGNORE INTO deltas` (`src/store/sqlite.ts:139-153`). `LocalStorageBackend.append` has
   the same shape by a different route: it skips any id whose key already exists
   (`src/store/local-storage.ts:121`).
2. `MirrorBackend.heal` **already fetches the healthy copy**. `alive` is the primary's *admitted*
   deltas, a quarantined row is not admitted, so
   `fromMirror = mirror.deltasSince(new Set(alive.map(d => d.id)))` contains the archive's good copy
   of exactly the squatted id, and `replant` carries it into `primary.append(...)`
   (`src/store/mirror.ts:187-191`). The insert is then **silently ignored** — `changes === 0`,
   `toPrimary` reports 0, and heal returns a report indistinguishable from a healthy one.
3. `MirrorBackend.deltasSince` delegates to the primary alone (`src/store/mirror.ts:69-71`), so a
   normal boot never reads the archive's good copy either.
4. `repair re-admit` re-runs admission on the *same bad bytes* (`src/gateway/repair.ts:83-91`) and
   necessarily fails again.

So the revival is **durable**: the strike stays stranded across every reboot until a human runs
`repair discard` and re-federates. After T57 the operator is at least TOLD — but the tool the
warning tells them to reach for does not exist, and `heal`, which holds the healthy bytes in its
hand, drops them on the floor and reports success. That last part is hazard **H7** in its purest
form: an operation reporting an outcome it never achieved.

## The fix — the primary replaces its own corrupt row, against its own bytes

**Shape (b) from the ticket, not (a).** The recovery is folded into `heal`, which already runs on the
boot path (`src/cli/cli.ts:259`) and already holds the healthy copy. Shape (a) — a new
`repair re-admit --from-mirror <key>` verb — is **deliberately not built**: it would be a second door
onto the same repair, and `cmdRepair` today opens the sqlite store alone with no archive, so the verb
would have to grow archive/mirror construction to reach bytes `loam serve --archive` already reaches
on every boot. One door, on the path that already runs, is the smaller change. (Noted for Myk: if he
wants the operator to be able to trigger this without a restart, (a) is the follow-on ticket.)

`RepairableBackend` gains one **optional** member — optional for the same reason `heldAmong` is
optional on `StoreBackend`: a driver earns it when it can honour it, and `isRepairable`'s duck-type
stays unchanged so no existing implementor silently loses `quarantine`/`discardRow`.

```ts
// Replace each corrupt row that SQUATS on one of these deltas' ids with the delta's own bytes.
// Resolves to the ids actually replaced. The driver decides, from its OWN bytes, never from the
// caller's word: an incoming delta must ADMIT, and an existing row that already ADMITS is never
// touched.
restoreQuarantined?(deltas: Iterable<Delta>): Promise<readonly string[]>;
```

### The orchestration inside `heal` — the two paths COEXIST, in this order

`fromMirror` is a **MIXED** set: it holds both the archive's good copy of a squatted id *and*
genuinely-new deltas the primary never held. The two are repaired by different mechanisms and both
must run, in this order:

1. **`toPrimary = await this.primary.append(replant)` — UNCHANGED, and it still runs first.** It is
   what federates the genuinely-new deltas. `restoreQuarantined` does not and must not plant a
   missing delta (a row that is not there is not a squatter), so removing or replacing this call
   would silently stop the archive from replanting new facts.
2. **Candidate selection, which does NOT depend on the optional member.** Heal asks the repairable
   primary for its pen (`quarantine()`, recomputed by heal's own opening `deltasSince`) and keeps the
   mirror deltas whose id the pen names. This is heal's own detection, so `restoreRefused` has a source
   in **every** branch, including a driver that omits `restoreQuarantined` entirely.
   **One pass over the pen, then one over the candidates — never `replant × penned` (H8).** A pen key
   is a row id (sqlite) or `prefix + id` (localStorage), and a delta id is fixed-width
   (`DELTA_ID_LENGTH`), so a fixed-width suffix recovers the id from either key shape: build a `Set`
   once, then one `has` per candidate. The nested form is not a theoretical cliff — both axes grow, and
   they grow *together* in exactly this ticket's scenario (a pen accumulates corrupt rows until an
   operator settles them; `replant` becomes the whole store when a lost primary is replanted from the
   mirror), and the loop is on the ORDINARY path since any lagging catch-up has a non-empty `replant`.
   This is the same inversion H8 already credits for `ArchiveBackend.purge`.
3. **The attempt, then heal's OWN byte verdict — symmetric in both directions.** Heal calls
   `restoreQuarantined(candidates)`, then **re-reads** the primary (`deltasSince(new Set())`, which
   recomputes admission from the primary's own bytes) and derives both fields from that read, never
   from the driver's return value:
   - `restoredPrimary` = the ids the driver CLAIMED **and** which the re-read now admits.
   - `restoreRefused` = one line per candidate the re-read still does **not** admit.

   So an over-reporting driver ("replaced it", nothing changed) is dropped from `restoredPrimary` and
   named in `restoreRefused`; a driver that repairs some and mis-reports others is split correctly.
   A candidate that some *other* handle repaired between heal's two reads appears in neither — heal
   did not do it, and it is not broken.

### The safety invariant, and where it is enforced

A replace must never let a wrong or malicious delta overwrite a good one. Both halves are checked
**inside the driver, from the driver's own bytes, on every call** — never from a pen the last read
happened to leave behind (that would be a presence test over a derived index, H7/H8's stale-index
trap):

- **(i) the incoming delta ADMITS.** The driver runs `canonicalDelta` (the id must recompute from
  the claims) and then the very same `admit()` the read path runs, over **the bytes it is about to
  write** — the serialized claims JSON and the signature. A delta that would not survive the next
  boot's read is never written.
- **(ii) the existing row does NOT admit.** The driver reads the row currently filed under that id
  and runs `admit()` on it. If it admits, the call **skips that id entirely**. An admitted row is
  never replaced, for any reason, by any caller.

Both checks are fresh reads, so the invariant holds under a stale pen, an empty pen, a row some other
handle repaired a moment ago, and a caller that passed a set it had no business passing. **The
check and the write share ONE `BEGIN IMMEDIATE` transaction** in the sqlite driver — the same
write-lock discipline `append` and `purge` already take — so there is no window between reading the
existing row and overwriting it. **`localStorage` has no transactions**, and this is the honest
statement of its weaker guarantee: two tabs racing a restore on the same key can interleave between
check (ii) and `setItem`. That is not a new exposure — `append`'s own read-then-write on the same key
has always had it, and the origin is single-threaded per tab — but it is a real difference from the
durable driver and it is named here rather than glossed.

The load-bearing consequence, and the negative case the rails pin: an **unsigned** delta carrying the
same claims as a signed row *admits* (`verifyDelta` answers `"unsigned"`, not `"invalid"`). Without
check (ii), replanting it would strip a verified signature off a good row — a downgrade dressed as a
repair. Check (ii) refuses it.

**Replacement is an UPDATE, not a DELETE + INSERT** (sqlite). The `seq` is preserved, so read order
does not churn and no autoincrement is burned; and no id is ever removed, so the `truncationOwed` /
`holds` bookkeeping that §11 rides on is untouched. What this does **not** promise: the corrupt row's
old bytes are not scrubbed from the WAL or a freed page. That is deliberate parity with
`discardRow` — a quarantined row is not a lawful fact in the ground (§25), so removing it is
mechanical and carries no §11 completeness claim.

### What heal reports — both directions, on a SIBLING surface

The two signals do **not** go on `HealReport`. They ride a new `RestoreReport` behind
`MirrorBackend.lastRestore`, beside `lagging`:

- `restored: readonly string[]` — the ids whose corrupt primary row was replaced by the mirror's
  healthy copy.
- `refused: readonly string[]` — one line per candidate that could NOT be restored: a repairable
  primary that offers no `restoreQuarantined`, or a row **still set aside after the attempt**. The
  second is heal's own byte verdict, the same doctrine its purge sweep already runs (T70): the
  driver's return value is evidence, never proof, so heal re-reads and asks that read.
- `lastRestore` is **`undefined` until a heal has run** — "nobody asked" must never read as "nothing
  was corrupt" (H9). A field on `HealReport` cannot express that distinction; a sibling surface must,
  because it can be read before the operation.

**Why a sibling and not two more report fields.** Every existing `HealReport` member describes the two
tiers CONVERGING — how many deltas moved which way, which sweeps refused. A squatter is not a
convergence fact: it is one tier being INTERNALLY unreadable, which the mirror only *happens* to be
able to repair because it holds a second copy. `lagging` already lives off the report for the same
reason (an append-time condition that heal clears), so the class already draws this line.

The secondary reason is that `HealReport`'s shape is a frozen rail (T67 asserts it with an exact
`toEqual`), and growing it would put a **backstop ruling** in the path of a bugfix. Two candidate
folds were considered and rejected:

- **Fold `refused` into `purgeFailures`** — NO, and the test is precise: an honest fold requires the
  existing field's READER to act on the new entry without distinguishing it. `purgeFailures`' only
  reader prints *"bytes the operator ordered forgotten may still be at rest"*, which for a stranded
  strike is simply **false** — nothing was ordered forgotten; a strike that WAS ordered is not being
  honored. The remedy differs too. Making that reader string-match to tell them apart is not a report.
  (T70's fold was honest by this same test: a surviving byte after a purge genuinely IS a sweep that
  did not verifiably complete — same predicate, same reader, same operator action.)
- **Fold `restored` into `toPrimary`** — NO. It is a success, not a failure, so there is no failure
  field to join; `toPrimary` counts deltas *appended* and a restore is not an append; and folding
  discards WHICH id was restored, which is the entire operator-facing value.

`cmdServe` reads `mirror.lastRestore` — `restored` on stdout beside the existing `healed —` line,
`refused` on stderr beside the `purgeFailures` loop, since a refused restore means a strike may still
be stranded while the store serves. **That reader is the obligation the surface carries**: a signal
nobody reads is a swallowed error with extra steps (H9), and it is railed
(`test/cli/repair-recovery.test.ts`).

`repair re-admit`'s still-quarantined message gains one line naming the recovery that now exists, so
the operator following T57's warning is pointed at `loam serve --archive` rather than left with
"discard it as garbage" as the only end.

### What is deliberately NOT changed

- **`MirrorBackend.deltasSince` stays primary-only.** "The primary is authoritative; its rows answer
  every read" is the combinator's stated doctrine (`src/store/mirror.ts:8-10`). Unioning the archive
  into every read would make a cold vault a second live voice, and it is not needed: heal runs before
  boot, so by the time the gateway reads, the primary holds the healthy bytes.
- **A store with no mirror cannot be recovered this way**, because no healthy copy exists anywhere.
  `repair discard` + re-federate remains the only end for it, and that is an honest limit rather than
  a gap: recovery needs a second copy, and this is the mechanism that uses one when there is one.
- **A corrupt copy in the ARCHIVE** is already refused loudly: `ArchiveBackend.deltasSince` throws
  `archive corruption: …` on a file whose claims do not recompute (`src/store/archive.ts:154-190`),
  so heal rejects before any replant. Combined with (ii), damage cannot flow either way.
  **The cost, stated:** that throw is all-or-nothing, so ONE bad archive file blocks the recovery of
  every *other* squatted id in that boot — and, on the `serve` path, fails the boot outright
  (`cli.ts:260-263` rethrows). It is loud rather than silent, which is the right direction, but it is
  a real availability cost. **Pre-existing and deliberately out of scope**: it is the archive's
  refuse-loudly doctrine (`quarantine.ts:104-108`), not something this change introduces, and
  softening it to per-file skipping is a decision about the vault's contract that wants its own
  ticket. Named here so the next reader does not mistake the throw for a complete story.

## Erasure-direction statement (CLAUDE.md's standing rule)

**What can now be deleted that could not before:** the bytes of a **quarantined (failed-admission)
row in the primary**, and only where the mirror holds a copy of that id which admits — replaced
in-place by those admitting bytes. Nothing that admits can be removed, no lawful ground fact is
touched, and no id leaves the store (an UPDATE, not a DELETE), so the tombstone/`holds` reach of §11
is unchanged. Direction of the change: heal previously deleted only ids the operator had tombstoned;
it may now overwrite a corrupt row's bytes.

## Acceptance criteria (each names its verification)

1. **The corrupt negation is REPLACED by the archive's healthy copy, and the strike is restored — at
   BOTH levels.** Fixture: a claim, a retraction striking it, and a healthy bystander claim, all in
   a sqlite primary mirrored to an on-disk archive; then the retraction's `sig` is corrupted in the
   primary only. After `heal()`: (a) DELTA level — the primary's row for the retraction id holds the
   healthy `sig`/`claims` bytes, read back with a raw `better-sqlite3` SELECT, and `heal` names the
   id in `restoredPrimary`; (b) OBJECT level — a gateway booted over the healed primary ALONE
   resolves the struck claim as still struck, asserted through
   `test/gateway/narrowing.ts`'s `assertPreservesSuppression` against a healthy source gateway. —
   `test/store/corrupt-row-recovery.test.ts`
2. **The named live bystander survives untouched, at the bytes and through a reader.** The
   bystander's `claims` and `sig` columns are captured before the heal and compared byte-for-byte
   after it, and the bystander still resolves LIVE in a View through a Schema on the destination
   gateway. A rail that only proved the repair could not see this. —
   `test/store/corrupt-row-recovery.test.ts`
3. **An ADMITTED row is NEVER replaced — including by an unsigned delta carrying the same claims.**
   `restoreQuarantined` is handed an unsigned twin of a healthy signed row; it returns an empty list
   and the row's `sig` column is unchanged. This is the check that keeps a repair from being a
   signature downgrade. — `test/store/corrupt-row-recovery.test.ts`
4. **An incoming delta that does not itself ADMIT is never written over a quarantined row.** A
   corrupt row is left squatting and `restoreQuarantined` is handed (a) a delta whose id does not
   recompute from its claims and (b) a delta whose signature is invalid; both are refused, the
   returned list is empty, and the corrupt row's bytes are unchanged — damage is never laundered
   inward. — `test/store/corrupt-row-recovery.test.ts`
5. **`heal` reports a restore it could not make, rather than reporting success — in both driver
   shapes.** (a) A primary that OMITS `restoreQuarantined` entirely still yields a `restoreRefused`
   naming the id, which proves heal's candidate detection is its own and not the member's. (b) A
   primary whose `restoreQuarantined` CLAIMS the id and replaces nothing has it dropped from
   `restoredPrimary` and named in `restoreRefused` — heal's byte verdict over the driver's word (H7).
   (c) A driver that repairs one id and mis-reports a second is split correctly across the two
   fields, so neither field can be a pass-through of the return value. —
   `test/store/corrupt-row-recovery.test.ts`
6. **A healthy pair still heals to a silent report.** With nothing corrupt, `restoredPrimary` and
   `restoreRefused` are both empty and `heal` remains idempotent — the feature is invisible when it
   has nothing to do, so a test cannot pass by the mechanism always firing. —
   `test/store/corrupt-row-recovery.test.ts`
7. **The localStorage driver gets the same treatment, and its foreign/misfiled limit is stated.** A
   corrupt row at `loam:<store>:<id>` is replaced by an admitting delta of that id; an admitted row
   at that key is not; and a row misfiled under some OTHER key is NOT reached (the same limit
   `holds` already documents), asserted so the boundary is pinned rather than assumed. —
   `test/store/local-storage-restore.test.ts`
8. **The operator is told, on the boot path.** `loam serve --archive` over a corrupted primary
   prints the restored id on stdout; a refused restore reaches stderr. And `repair re-admit` on a
   still-failing row names the archive-heal recovery rather than offering discard as the only end. —
   `test/cli/repair-recovery.test.ts`
9. **The replant path still federates a genuinely-new delta in the SAME heal that repairs a corrupt
   row.** `fromMirror` is a mixed set; a delta held only by the archive lands in the primary
   (`toPrimary` counts it, and a gateway over the healed primary resolves it) while the squatted id is
   restored in the same call. This is the rail that fails if `restoreQuarantined` were wired in
   PLACE of `append(replant)` rather than beside it. — `test/store/corrupt-row-recovery.test.ts`
10. **Candidate selection is one pass per side, and the fixed-width id assumption it rests on is
    pinned.** `DELTA_ID_LENGTH` equals a real delta's id length and `DELTA_ID` accepts it, for a bare
    row id and an embedded `prefix + id` alike — so a substrate change that widened an id fails loudly
    rather than silently matching nothing and stranding every squatter. And a FOREIGN pen key too short
    to hold an id (a UI writer's key under the shared prefix) contributes no candidate and is left
    untouched by a heal that repairs a real one. — `test/store/corrupt-row-recovery.test.ts`,
    `test/store/local-storage-restore.test.ts`
11. **The existing row is judged from the TABLE, never from the pen — the stale-pen / TOCTOU rail.** A
    handle fills its pen on a corrupt row, then the row is repaired out of band (a second handle's
    write, simulated with a raw `UPDATE`). `restoreQuarantined` on the first handle must REFUSE, even
    though its own pen still names the row as quarantined. An implementation that consulted
    `lastQuarantine` instead of re-reading passes every other criterion and fails this one. —
    `test/store/corrupt-row-recovery.test.ts`

## P1 review record

**`adlc premortem` could NOT run** — it needs an API provider, and the only key on this box
(`GEMINI_API_KEY`) 404s on both `gemini-2.5-pro` and `gemini-2.5-flash` ("no longer available to new
users"). The `premortem` slot in the P1 manifest is therefore satisfied by the review below, which is
a *different and stronger* instrument (a full adversarial pass over the same artifact, in an isolated
context) — but it is **not** `adlc premortem`, and the manifest name should not be read as saying it
was. Stated here rather than left to the record's silence.

Reviewed by `adlc review --input` (local `claude` CLI, fresh isolated context, same model — no
provider key available, so this is not the cross-model tier). Verdict `needs-attention`, **five
findings, all accepted and folded in above**: the heal orchestration was unspecified (criterion 9 and
the new orchestration subsection); `restoreRefused`'s source when the optional member is absent was
undefined (criterion 5a, step 2); `restoredPrimary` was not byte-verified the way `restoreRefused`
was (criterion 5b/5c, step 3); the check-then-write atomicity was claimed but not specified
(the `BEGIN IMMEDIATE` statement, criterion 10, and the named localStorage gap); and the
partially-corrupt-archive abort was presented as purely protective (now stated with its cost and
scoped out).

Two of these — orchestration and the `restored` verdict — were the kind a rail written from the
un-reviewed spec would have gotten wrong while passing.

## P5 review record

**H8 (scan and scale), one confirmed finding, fixed:** candidate selection was
`replant.filter(d => penned.some(...))` — `replant × penned` string comparisons on the ORDINARY path
(any lagging catch-up has a non-empty `replant`), with both axes growing together in precisely this
ticket's own scenario. Inverted to one `Set` build plus one `has` per candidate, and the fixed-width
id assumption that inversion rests on is now pinned by a rail (criterion 10).

The same lens checked two things and called them clean, worth recording because both were load-bearing
claims rather than incidental: the third full-primary read is correctly gated behind
`squatting.length === 0`, so a store with no quarantined rows still makes exactly the two passes heal
made before this change; and `primary.quarantine()` is not a stale-index read — both drivers return the
pen the `deltasSince` earlier in the *same* heal invocation just recomputed, and the `admitted` set is a
live re-read that re-parses and re-verifies rather than trusting the driver's `claimed` return.

## Open questions for Myk

1. **Is shape (b) alone enough, or do you want the (a) verb too?** The recommendation above is (b)
   only, with (a) as a follow-on ticket if the restart is too coarse a trigger. (b) is strictly
   smaller and rides a path that already runs.
2. **Is the in-place UPDATE acceptable, or should a replace scrub the old bytes?** The
   recommendation is parity with `discardRow` (no scrub, no §11 claim), because a quarantined row is
   not a lawful fact. Scrubbing would drag WAL-truncation debt onto the boot heal path for bytes
   §11 never covered.
