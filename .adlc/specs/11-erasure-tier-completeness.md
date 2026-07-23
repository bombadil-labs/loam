# T67 — Erasure completeness is a question about BYTES ON EVERY TIER, not about a purge count

**Ticket.** T67. **Amends** `spec/11-erasure.md` (the purge's "every tier" promise) and
`spec/08-persistence-federation.md` (the `StoreBackend` seam gains one member). This is a REPAIR of
behavior §11 already states — no new capability, no on-wire change, no §20 migration (the bytes and
roles of every delta are untouched; the change is one interface member and one verdict).

## The leak, stated at the level it actually lives

`eraseImpl` (`src/gateway/erase.ts`) decides §11 completeness like this:

```ts
const removed = await gw.backend.purge([id]);
...
if (removed === 0 && (await gw.backend.deltasSince(new Set())).some((d) => d.id === id)) throw ...
```

Under `MirrorBackend` that verdict is **tier-blind in both directions**, and each direction is a
separate false completion:

1. **The scan reads one tier.** `MirrorBackend.deltasSince` returns the PRIMARY's deltas only
   (`src/store/mirror.ts`). A byte at rest on the mirror tier is never in the set the verdict
   inspects, so a mirror that silently retained is invisible and `erase` returns `{ erased }`.
2. **The gate is an aggregate.** `MirrorBackend.purge` returns `Math.max(primary, mirror)`. A
   primary that silently retains (returns 0, keeps the row) beside a mirror that legitimately
   removed a straggler (returns 1) yields `removed === 1`, so the scan is **skipped entirely** —
   even though scanning the primary would have seen the retained byte.

Both are hazard **H7**: an operation reporting a success it never proved. The next boot's
`heal(exclude)` eventually sweeps the mirror, but the synchronous `erase` has already handed the
data subject — and the compliance record — a completion that was not true when it was made.

`deltasSince` is the wrong instrument on its own terms, too: it is *defined* to skip a
`<id>.json.<pid>.tmp` straggler, which is exactly the byte `purge` was taught to hunt (T40/T55).
Asking a READ whether bytes are gone conflates readability with byte-presence — the one conflation
§11 forbids.

## The fix — byte-presence becomes a first-class question the seam can answer

Add one member to `StoreBackend`:

```ts
// Does this backend still hold bytes filed under `id`, on ANY tier it owns — including bytes a
// read is defined to skip? The completeness question §11 actually asks, asked directly.
holds(id: string): Promise<boolean>;
```

and the verdict in `eraseImpl` collapses to `if (await gw.backend.holds(id)) throw ...`, with the
`removed === 0` gate **deleted**. Retry-safety survives unchanged: a completed earlier attempt makes
`holds` false, so the re-run succeeds without minting a second tombstone.

**The governing invariant, and the reason it is testable:** *`holds` sees at least everything
`purge` reaches.* Per driver, `holds` mirrors that driver's own purge reach — never `deltasSince`,
never a bookkeeping index:

| driver | `holds(id)` |
|---|---|
| memory | `set.has(id)` |
| sqlite | `SELECT 1 FROM deltas WHERE id = ?` — targeted, no scan |
| archive | every fan, filename-prefix match on `<id>.json` **and** `<id>.json.*.tmp` — purge's own prefix logic, and deliberately NOT `onDisk` (H8: index the work you COMPLETED, never the data you expect to find) |
| localStorage | `getItem(keyFor(id)) !== null` |
| mirror | both tiers probed, `primary || mirror`; a tier that rejects makes the whole probe reject |

### What this deliberately does not claim

Naming the bound is the point — an overclaiming probe is the same H7 wearing a fix's clothes.

- **sqlite freelist / WAL residue** is not `holds`'s question. It is `purge`'s, and `purge` already
  refuses loudly when it cannot truncate the WAL, with `secure_delete = ON` plus the inherited-
  freelist VACUUM covering the pages. `holds` answers about ROWS the driver owns.
- **A misfiled or quarantined row whose CLAIMS compute to an erased id** (a sqlite row filed under
  key X carrying B's claims; the localStorage equivalent) is retained content that neither `purge`
  nor `holds` reaches today. It is a real, separate §11 gap, out of T67's scope, and gets its own
  ticket rather than a silent expansion of this one.
- **The archive's own quarantine** does not exist — the vault refuses rather than sets aside — so
  there is nothing extra to probe there.

## Acceptance criteria

### Seam criteria

- Every `StoreBackend` driver answers `holds`: false for an id never appended, true after that id
  is appended, and false again after `purge([id])` — asserted once against all six contract
  harnesses (memory, sqlite, archive, mirror(memory), mirror(durable), localStorage).
  Verified by `test/store/contract.test.ts`.
- `holds` sees at least what `purge` reaches: for every harness, an id whose `purge` returns a
  positive count MUST read `holds === true` immediately before that purge.
  Verified by `test/store/contract.test.ts`.
- `holds` MUST NOT consult a driver's completed-work index (`onDisk`) — an archive straggler
  `<id>.json.<pid>.tmp` planted BEHIND the seam with a raw write, never appended through this
  handle, still reads `holds === true`. Planting it behind the seam is what makes the rail able to
  fail: a bookkeeping-based probe cannot see it. Verified by `test/store/archive.test.ts`.
- After `close()`, `holds` rejects like every other member of the seam.
  Verified by `test/store/contract.test.ts`.
- Every `StoreBackend` TEST DOUBLE tells the truth about what it holds, because a double that
  answers `holds: () => false` turns this fix into the bug it repairs (premortem C1): the
  `unreachable()` side REJECTS `holds`, `flaky()` delegates to its inner backend, and the silently
  retaining side reports `holds === true`. Verified by `test/store/mirror.test.ts`.

### Mirror criteria

- `MirrorBackend.holds` is true when ONLY the mirror tier holds the byte — the primary is clean and
  `deltasSince` therefore reports nothing. Verified by `test/store/mirror.test.ts`.
- `MirrorBackend.holds` is true when ONLY the primary holds it. Verified by `test/store/mirror.test.ts`.
- A tier whose `holds` rejects MUST make `MirrorBackend.holds` reject, never resolve false — a
  swallowed error here is the exact false completion this ticket exists to delete. Both tiers are
  probed before the rejection propagates, matching `purge`'s settle-then-report semantics.
  Verified by `test/store/mirror.test.ts`.
- An UNREACHABLE tier therefore makes `erase` reject rather than report a completion it cannot
  prove, and the message names which tier could not be proven clean (premortem C4 — an intended
  availability consequence, stated so it is never "fixed" by swallowing the error).
  Verified by `test/gateway/erase-tier-completeness.test.ts`.

### Verdict criteria — the ticket's two live leaks, at the tier level

- Given `MirrorBackend(primary, mirror)` where the MIRROR silently retains the target (its `purge`
  returns 0 and keeps the row) and the primary is clean, `gateway.erase(id)` MUST reject, and its
  message MUST name the erasure incomplete. Verified by `test/gateway/erase-tier-completeness.test.ts`.
- Given the inverse — the PRIMARY silently retains while the mirror removes a straggler, so
  `purge` reports an aggregate `1` — `gateway.erase(id)` MUST still reject. This is the criterion
  the deleted `removed === 0` gate makes unreachable. Verified by `test/gateway/erase-tier-completeness.test.ts`.
- An archive tier holding only a `<id>.json.<pid>.tmp` straggler for the target MUST make
  `erase(id)` reject, though no read on any tier can see that delta.
  Verified by `test/gateway/erase-tier-completeness.test.ts`.
- A refused erase leaves the tombstone RECORDED (the erasure log is append-only, the retry is
  safe), and the immediate re-run after the retention is cleared succeeds without minting a second
  tombstone. Verified by `test/gateway/erase-tier-completeness.test.ts`.
- The healthy path is unregressed at both levels: after `erase(id)` on a clean mirror pair, the
  reader resolves nothing for the id AND the marker bytes are absent from every file under both
  tier roots. Verified by `test/store/erasure-at-rest.test.ts`.

### Rail-adequacy criteria — no hollow rails

- Zero surviving mutants on the LINES THIS CHANGE TOUCHES in `src/gateway/erase.ts`. The full
  survivor list — including pre-existing survivors elsewhere in the file — goes in the PR body with
  a one-line disposition each, so the cap is never silent (premortem C2).
  verify: `adlc hollow-test --target src/gateway/erase.ts`
- Zero surviving mutants on the lines this change touches in `src/store/mirror.ts`; in particular a
  mutant that probes only `this.primary` MUST NOT be a survivor.
  verify: `adlc hollow-test --target src/store/mirror.ts`
- The verdict rails carry a POSITIVE CONTROL in the same file: the identical fixture with NO
  retention planted resolves `erase` normally. A rail that rejected regardless of what the tiers
  hold therefore fails its own control, which is what makes the three rejection criteria mean
  something. Verified by `test/gateway/erase-tier-completeness.test.ts`.

### Whole-bar criteria

- Format, lint, typecheck, and the full suite pass — read the counts, never a silent grep.
  verify: `npm run check`
- T67's `rails` name the four test files above and are enforced frozen. A glob matching no file
  passes vacuously, so the rails are declared at P3 once the tests exist, never in advance.
  verify: `adlc rails-guard --ticket T67`

## What P5 has to check (a review obligation, not a gateable criterion)

These are properties a test cannot assert about itself, so they are named here rather than smuggled
into the criteria list wearing a fake verification method.

- No rail asserts §11 completeness at the API level alone (`get(id) === undefined` stayed true
  through every leak this repo has paid for). Every verdict rail plants retention at a TIER and
  inspects it there; the byte rails read files.
- The `loam-erasure` and `loam-hollow-rail` lenses are routed by `npm run p5 -- --base main`, and
  the independent reviewer is `npx adversarial-review --base main --verify` — same model, fresh
  isolated context with no access to this document's reasoning.
- If the P5 triage routes ZERO lenses for this diff, that is a finding about the triage script, not
  a clean review (premortem C6). An empty result and a pass read identically; say which one it was.
- The two tier-blindness rails necessarily drive a FAKE retaining driver — no shipped driver
  silently retains (premortem C7). They prove the verdict logic. The archive `.tmp` criterion and
  the six-harness contract sweep are what prove the real drivers. Both, never either.

## Open questions for Myk

1. **`holds` as the seam's name and shape.** Recommendation: `holds(id: string): Promise<boolean>` —
   singular, because erasure is one id at a time and a batch form is speculation. The alternative
   the ticket lists (expose per-tier retention from `MirrorBackend` and have the verdict assert each
   tier) keeps the seam smaller but pushes tier-awareness up into the gateway, where every future
   combinator would have to be taught about it again. `holds` puts the question where the tiers are.
2. **Does the §24.8 pool fan-out get the same verdict?** `eraseReplicaImpl` purges an attached
   quarantine pool and asserts nothing about the bytes at all, so a pool that retains reports a
   completion exactly as the mirror does. Recommendation: **yes** — add `if (await gw.backend.holds(id)) throw`
   there too, in this PR. It is the same H7, one call away, and §11 reaches through the one-way glass
   unconditionally. Premortem C5 is the reason this cannot be answered "later": T67 would land, the
   mirror leak would close, and the identical false completion would survive one call away, under a
   spec section newly asserting that completeness is decided by byte-presence.
3. **New `spec/` section, or an amendment to §11 and §8?** Recommendation: **amendment** — CLAUDE.md
   reserves editing an existing section for "a bugfix or one-off correction," which is exactly this.
   §11 gains a sentence on how completeness is decided; §8 gains `holds` in the seam's member list.
4. **The named gap** (a misfiled/quarantined row whose claims compute to an erased id). Recommendation:
   a follow-on ticket authored in this PR, not scope creep here. It is a different mechanism
   (admission-time misfiling), needs its own rails, and T67 is a live leak that should not wait for it.
5. **`StoreBackend` gains a required member.** No on-wire bytes change, so no §20 migration; but any
   out-of-tree implementor of the interface breaks at compile time. The package is unpublished, so
   the blast radius is this repo. Flagging rather than deciding.

## Non-goals

- Changing `purge`, `heal`, or `deltasSince` semantics. `deltasSince` keeps skipping `.tmp`
  stragglers — that is correct for reads and is precisely why the verdict stops using it.
- Any change to who may order an erasure, to the tombstone's shape, or to admission.
- Making `holds` a general-purpose existence query for readers. It exists for the §11 verdict and
  for `heal`'s sweep to be checkable; a reader asking "is this delta here" already has `deltasSince`.
