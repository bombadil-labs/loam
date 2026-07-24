# T32 — The Container lifting: quarantine becomes one preset, and the vector gets its at-rest name

**Ticket.** T32. **Amends** `spec/27-containers.md` (§27.1 gains the minted vocabulary; §27.7 closes).
Build ticket on a store-boundary/erasure/federation surface, so the PR is **Myk's merge (P6)**. It
must ship **no behavior change to the quarantine** — a change is a finding, not a feature — and
**no §20 migration** (the mint is new vocabulary only; no delta any store holds changes bytes or
meaning, and this spec says so explicitly so the claim is checkable).

## What lifts

`quarantine-pool.ts` generalizes into a named `Container` carrying §27.1's knob vector —
`{membership, seeding, trust, boundary, identity}` — with the quarantine re-expressed as ONE
PRESET (UNTRUSTED · one-way-seeded · live · droppable). `openQuarantine` keeps its signature and
its behavior, implemented over the primitive. `Container` and `ModuleVersion` are the only type
names; "module" and "quarantine" remain prose postures (the "lens" discipline).

**Bytes follow the POSTURE; law follows the TRUST — the four outcomes, enumerated** (round-1
review reconciled the two knobs' division of labor): a PROPERTY container is a query over shared
ground — pointer arrangement, zero copies; a WALL is a separate arena — real bytes, because
discard-with-zero-trace is the one thing sharing cannot provide (Myk's copy-knob framing,
2026-07-20). Trust decides which postures are LAWFUL; posture decides where bytes are paid:

| trust | posture | outcome |
|---|---|---|
| curated | property | the zero-copy scope — shared ground, flippable exclusion |
| curated | wall | lawful and deliberate: your OWN separate store (tenant isolation's default shape, §28.4) — copies paid on purpose |
| untrusted | wall | the quarantine — copies paid of necessity |
| untrusted | property | **REFUSED** (§28.3: delegated admission over shared ground) |

The Container pays bytes exactly where a wall stands and nowhere else. Both directions railed
(criteria 5–6): a property container that copies is a bug; an untrusted container that merely
filters is a hole.

## The vocabulary mint (the permanent part)

Following the `loam:trust`/`loam:budget` precedent — declarations re-resolved from live deltas, a
knob change is a delta and never a restart — and the §20 corollary (shapes unambiguously distinct
from all prior vocabulary; nothing existing collides with the `loam.container` prefix, asserted by
criterion 2):

- **The container is an entity** the operator names (`container:<name>` by convention, not
  enforced), **declared** by an operator-signed claim at context **`loam.container`**: role
  `container` → the entity; role `trust` → `"curated"` | `"untrusted"`; role `posture` → `"wall"`
  | `"property"` (§28.7's mint — absent reads as the §28.4 default, a wall); role `parent` → the
  containing container's entity, absent for a root-attached container. The declaration is the
  at-rest form of the knob vector; a knob change is a fresh declaration (latest-wins, like every
  living declaration), and §28.3's derivation is ENFORCED at the door: declaring
  `trust: "untrusted"` with `posture: "property"` refuses — a container that admits what its
  parent does not trust must be a wall. **The trust knob and posture are IMMUTABLE per container
  entity** (premortem, 2026-07-24): §28.4 proved neither transition is a flag flip —
  property→wall is unachievable in place, wall→property is the escalation that must pass the
  root's admission — so a re-declaration changing `trust` or `posture` REFUSES at the door
  naming §28.4, and a different trust posture is a NEW container. A `parent` re-declaration
  that would move a container under a parent of different trust refuses the same way (the same
  transition wearing a tree edit). Every OTHER knob stays latest-wins. **And immutability is
  enforced at the READER too, exactly like the tree rule** (round-2 review: the same two arrival
  paths exist — a flip can sit in a replayed ground or federate from the operator's own other
  device, and no local door sees either): a container's trust and posture are fixed by its
  EARLIEST surviving declaration (by (timestamp, id)); a later declaration differing in either
  resolves as not-binding for those roles and surfaces as a named defect. Latest-wins never
  applies to the two knobs §28.4 proved are not flags. Criterion 21 drives the federated shape.
  **The trust role is REQUIRED** — a declaration without it refuses at the door (explicitness
  over defaults on the permanent surface); only posture carries a default (wall, §28.4).
- **Membership** is the built #132 surface (a Term); the declaration references it under TWO
  DISTINCT ROLES so the shapes can never blur (the §20 corollary, applied here too): role
  `membership` → primitive, the Term's canonical JSON inline; role `membershipAt` → primitive,
  the content address of a published Term. One or the other, never both. LIVE evaluation stays
  exactly `select`/`watch`; identity stays T29's ladder (`freeze` → `ModuleVersion`) — and the
  declaration may cite a frozen version under role `version` → primitive, the ModuleVersion
  address: the citation vocabulary §27.2's provenance forwarded to this ticket, minted here so
  T76/T77 inherit its shape instead of guessing one. (T34's budget rides the §28.6 subject
  mechanism like trust — no room needed here.) The malformation rules are the door's, stated
  (round-2 review): BOTH roles on one declaration refuses naming the conflict; NEITHER is lawful
  for a WALL (a seeded arena needs no scope Term — the quarantine's own shape) and refuses for a
  PROPERTY container, which IS its membership and without one would be the silent-empty H9 shape
  through a different door.
- **Exclusion is a claim, and re-inclusion is its lawful negation**: context
  **`loam.container.excluded`**, operator-signed, naming the container entity. No member delta is
  ever re-signed by either direction — only the exclusion claim itself moves, which is why the
  property model costs nothing (criterion 4 pins member ids across the round-trip).
- **The detach record** (T72's named deferral, fulfilled here): `detach()` on a NAMED container
  lands an operator-signed claim at context **`loam.container.detached`** naming the container
  entity and a caller-supplied note (where the store lives is knowledge only the caller holds).
  Re-attach negates **every surviving** detach record for that entity (H4: two detaches mint two
  records; one negation must not leave the container half-listed). An anonymous pool — today's
  nameless `openQuarantine` — has no entity to cite and detaches recordless, stated here rather
  than discovered. The note is validated like a name (no NUL, bounded at 256 bytes) — it is
  permanent metadata and must not become a dumping surface. The record is an ORDINARY claim,
  reachable by §24.8 erasure like anything else — but **forgetting a container is a two-part
  act, ordered** (round-2 review caught the contradiction): the record covers an unreachable
  wall in the completeness guard, so erasing the record while the DECLARATION still stands
  would flip every future erase into refusing over a container the operator was told they
  forgot. The honest forget strikes the declaration (removing the container from the resolved
  table) and then erases or negates the record; erasing the record of a still-declared
  unreachable wall is itself the named fault the guard reports. A store permanently LOST is
  written off the same way — strike the declaration, negate the record; a detached record
  never dangles beyond the operator's own say-so. A reader — `loam repair`, a future health extension — can thereafter
  LIST detached stores instead of forgetting them.
- **Only lawful claims bind, at every `loam.container*` context** (premortem, 2026-07-24):
  the reader filters through the operator-rooted lawful read, so a federated stranger's
  declaration, exclusion, or detach record lands as data and moves NOTHING — a stranger must not
  hold a denial-of-visibility primitive over the operator's own scoped reads, nor pollute the
  repair listing. Railed at both levels (the delta is in the ground; the table and scope are
  unmoved) by criterion 17. The §28.6 grant-rooted widening (admin standing IN the container,
  recursing to the root) is the NAMED extension point — later work widens who counts as lawful;
  it never reinterprets the context.
- **Trust AT a container needs no new vocabulary**: §28.6 (DECIDED) already gave the existing
  `loam:trust` declaration shape a subject — filed at the container's entity. This ticket only
  ensures the declaration and admission plumbing accept a container entity as that subject.

**Two knobs stay OFF the at-rest mint, deliberately** (round-1 review asked): `seeding` remains
an open-time behavior of the preset (its at-rest descriptor — module import sources — arrives
with T33's promote-law/import work), and `boundary` names OPERATIONS (reference / the two
merges), not state. Neither gets a role until a consumer fixes its shape; minting placeholders
now is how vocabularies grow barnacles.

## Erasure reach must match the table's width (premortem, 2026-07-24)

The mint makes containers enumerable AT REST, and `erase` fans out over the ATTACHED set — after
a restart those can differ, and §24.8's own premortem named the hole. T32 ships the honest rule
rather than the full locator machinery (which rides T78's mounts): **`erase` refuses to report
completeness while the resolved container table names a WALL-posture container — untrusted OR
curated, since bytes follow posture — that is neither currently attached nor covered by a
surviving `loam.container.detached` record.** An unreachable wall is a named fault, never a
silent gap in the sweep. (Criteria 14–15 drive it, including the restart shape.)

## The tree rule, enforced (§28.8's demand on this ticket)

`parent` claims form the containment tree — and enforcement lives at BOTH levels, because a
cycle has two arrival paths and only one passes a door (premortem, 2026-07-24). The DOOR refuses
a declaration that would close a cycle, naming it — and that check runs on EVERY declaration
carrying `parent`, re-declarations included (round-1 review: latest-wins means the likely cycle
arrives by re-pointing an EXISTING container's parent, not by the initial build). The READER is cycle-guarded independently: a
cycle that arrives by federation (two devices, each locally acyclic, unioned) or sits in a
replayed ground resolves DETERMINISTICALLY and loudly — the cycle-closing edge (latest by
(timestamp, id)) is treated as not-binding and surfaced as a defect; a boot never refuses, a
parent-chain walk never hangs. Railed by criteria 8 and 16.

## Scope-merge (the new operation)

A read scope is `union(active containers) MINUS excluded`, composable and nestable on the 0.6.0
set algebra (`difference`/`intersect` as first-class Term ops). Pinned per §27.4's decided
formalism — **scope is chosen at query time**: exclusion changes what a scope-bearing read
(`select`/`watch`/`freeze`, and the offered lens when the operator configures one) resolves; it
does not silently rewrite the default door reads. Scope-merge = negating the exclusion claim —
authorship never changed, so nothing re-signs.

**"Active" is defined, not implied** (round-1 review): a container is ACTIVE iff its
declaration survives (unstruck) AND no surviving `loam.container.detached` record covers it.
The `parent` edge is a containment/trust relation and NEVER an auto-inclusion — a child
participates in a scope by its own membership, not by riding its parent. Exclusion operates on
the ACTIVE union (active is pre-exclusion; excluded-but-declared is in the union and then
subtracted — that is what makes re-inclusion a pure negation). Criterion 18 pins the union side.

**An unresolvable membership fails the read CLOSED** (round-1 review): a `membershipAt` address
that resolves to nothing — partial federation, a missing publish, a degraded backend — REFUSES
the scoped read naming the address. An empty-set fallback would silently shrink a scoped result
into something indistinguishable from a legitimately empty container: partial data with no
error, the H9 shape on the read side. Criterion 19 pins it.

**And the scoped read carries the forward negation closure of what it admits — H1, named at its
fourth site before it ships rather than after (premortem, 2026-07-24).** `negated(d, D)` ranges
over the OPERAND set: excluding container C drops C's members, and among them may be negations
whose targets live in the surviving scope — drop the strike and the target reads LIVE, a
well-formed wrong view. This repo has paid for exactly this three times (T38 twice, T39 kin).
The rule is the seeding edge's, applied to the read: **exclusion may narrow what a scope sees,
never revive what was struck** — every container-scoped read composes through the same closure
the membership edge uses, and criterion 13 drives it through `assertPreservesSuppression`
(`test/gateway/narrowing.ts`), the shared rail every narrowing operation must pass.

## Preserved seams (the refactor's stated invariants, not moods)

Three places "no behavior change" actually lives (premortem, 2026-07-24): (1) **refusal-message
prefixes are part of the preserved surface** — `drop refused:` and its kin are matched by code
and rails; the lifting keeps them byte-stable. (2) **T72's settle-before-boot ordering is an
invariant**: erasure debt is swept before any reader over the container's store exists; the
existing rail re-points at the lifted path unmodified. (3) **ONE registry is canonical for
erasure reach**: the container table; `gw.quarantinePools` becomes a view of it (the attached
subset), so `eraseReplica`'s walk, drop/detach, and reseed can never diverge on membership.

## Explicitly out of this ticket (stated so the deferrals are on the record)

Promote-LAW (T33), the resource envelope knob (T34), the frame (T35), dynamic mounts (T78), the
nested-trust BINDING walk beyond what admission already does (§28.6's flatten exists for the
depth-1 case; deeper walks arrive with the tenancy work). The §28 obligation this ticket carries
is exactly: vocabulary ROOM for per-container trust + posture, and the enforced tree rule.

## Acceptance criteria

1. **The quarantine preset is behaviorally identical.** `test/gateway/quarantine.test.ts`,
   `test/gateway/erasure-fanout.test.ts`, `test/gateway/membership.test.ts`, and
   `test/gateway/pool-drop-detach.test.ts` run over the lifted implementation and stay green with
   **no assertion softened** (the diff to those files is empty or teardown-only) — §24.8's
   erasure law included. — existing suites, diff-audited.
2. **The mint collides with nothing, and malformations refuse.** A vocabulary rail asserts
   every new context begins `loam.container` and no pre-existing reserved context or role
   shares the prefix; the door refuses a NUL in a container name, a declaration missing `trust`,
   a declaration carrying BOTH membership roles, and a PROPERTY declaration carrying neither. —
   `test/gateway/container-vocab.test.ts`.
3. **A knob change is a delta, not a restart — for the MUTABLE knobs.** Re-declaring a
   container with a changed membership updates the RUNNING gateway's table (latest-wins) with no
   reopen; a reopened store resolves the same table from the ground; and a re-declaration
   changing `trust`, `posture`, or a cross-trust `parent` REFUSES naming §28.4. —
   `test/gateway/container-declare.test.ts`.
4. **Property = flippable exclusion at zero churn.** Excluding a curated/property container
   removes its members from a container-scoped read; negating the exclusion returns them; the
   member delta ids before and after are IDENTICAL (no re-sign), and the ground never moved
   beyond the exclusion claims themselves. — `test/gateway/container-curated.test.ts`.
5. **Untrusted must be a wall, and a wall is real bytes.** Declaring `trust: "untrusted"` with
   `posture: "property"` refuses at the door naming §28.3; a wall container's members live in a
   genuinely separate store (its backend holds byte copies; the primary's ground is unchanged by
   its existence) — asserted for BOTH the untrusted wall and the curated wall (the lawful
   tenant-isolation shape). — `test/gateway/container-wall.test.ts`.
6. **A property container never copies.** Opening and reading a property-posture container adds
   ZERO deltas to any backend (primary count unchanged; no second backend exists for it) — the
   dual of 5. — `test/gateway/container-curated.test.ts`.
7. **Nested exclusion composes.** A scope built as difference-against-difference (a container
   defined relative to another, both with exclusions) resolves the correct member set — the
   pre-0.6.0-impossible case. — `test/gateway/container-scope.test.ts`.
8. **A containment cycle refuses at attach.** Declaring `parent` edges A→B→C→A refuses on the
   closing edge, naming the cycle; the refusal arrives at declaration time, never as a hang at
   read time (the rail drives a read after the refusal to prove the tree stayed sound). —
   `test/gateway/container-tree.test.ts`.
9. **The detach record lands, lists, and never half-clears (H4).** `detach()` on a named
   container lands the `loam.container.detached` claim (note included); TWO detaches accrue two
   records and ONE reattach negates BOTH (ground level: both negations present; listing level:
   the container absent); a reader lists currently-detached containers from the ground alone. —
   `test/gateway/container-detach-record.test.ts` (new file — the T72 rail is frozen).
10. **Trust files at a container entity.** A `loam:trust` declaration whose subject is a declared
    container entity is accepted and resolvable per §28.6's shape; admission plumbing reads it
    for that container without disturbing the root's declaration. — `test/gateway/container-trust-subject.test.ts`.
11. **No §20 step needed, proven.** A store written entirely by the PREVIOUS release (a fixture
    from the current test corpus, byte-for-byte) opens under the lifted code with identical
    resolved views and identical delta ids — nothing at rest changed meaning. — `test/gateway/container-compat.test.ts`.
12. **`openQuarantine` call sites are untouched.** The lifting changes no public signature:
    `git diff` over `src/` shows no call-site edits outside `quarantine-pool.ts`/`container.ts`
    and the gateway wiring; the preset's options type is assignment-compatible with today's
    `QuarantineOptions`. — asserted in review + the type-level rail in
    `test/gateway/container-declare.test.ts`.

13. **Exclusion never revives a strike (H1).** A claim retracted in the primary scope, whose
    negation is a MEMBER of an excluded container, still resolves as retracted in the
    container-scoped read — asserted at both levels through `assertPreservesSuppression`
    (`test/gateway/narrowing.ts`). — `test/gateway/container-scope.test.ts`.
14. **Erasure reaches the generalized wall.** An `untrusted` container opened through the
    Container surface (not the quarantine preset) receives the tombstone + purge fan-out, byte
    verified (`holds` false on its backend). — `test/gateway/container-wall.test.ts`.
15. **An unreachable wall is a named fault.** Declare a wall container, reopen the store WITHOUT
    re-attaching it: `erase` refuses completeness naming the unreachable container; after a
    detach record covers it, the same erase completes with the container listed as deliberately
    kept. — `test/gateway/container-compat.test.ts`.
16. **A federated or replayed cycle cannot hang a read.** Union two locally-acyclic grounds whose
    parent edges close a cycle: the table resolves with the cycle-closing edge not-binding and a
    named defect; a reopened store holding the same ground boots and answers reads. —
    `test/gateway/container-tree.test.ts`.
17. **A stranger's container claims are inert.** Federate a non-operator declaration, exclusion,
    and detach record: all three land in the ground; the container table, scoped reads, and the
    detached listing are unmoved — both levels asserted. — `test/gateway/container-vocab.test.ts`.

18. **The union side of the formula is pinned.** Two active property containers scope-read as
    the union of their members; a container covered by a surviving detach record contributes
    NOTHING even without any exclusion; a child's members do not ride its parent's activation. —
    `test/gateway/container-scope.test.ts`.
19. **An unresolvable membership refuses, never shrinks.** A container whose `membershipAt`
    address resolves to nothing fails the scoped read loudly, naming the address — the read is
    never silently evaluated as if that container were empty. — `test/gateway/container-scope.test.ts`.
20. **A re-declared parent cannot close a cycle.** With A→B→C standing, re-declaring A's parent
    to C refuses at the door naming the cycle (the latest-wins path, distinct from criterion 8's
    initial build). — `test/gateway/container-tree.test.ts`.

21. **A federated trust flip is not-binding.** Union a ground holding a later declaration that
    flips a container's `trust` (no door involved): the reader resolves the ORIGINAL trust, the
    flip surfaces as a named defect, and a reopened store resolves the same — the criterion-16
    shape, applied to immutability. — `test/gateway/container-tree.test.ts`.
22. **The completeness guard covers every wall.** An unreachable CURATED wall (the tenant shape)
    triggers the same erase refusal as an untrusted one — bytes follow posture, so the guard
    does too. — `test/gateway/container-compat.test.ts`.
23. **Forgetting is two-part, in order.** Erasing a detach record while the declaration stands is
    reported as the named fault on the next erase; striking the declaration THEN clearing the
    record leaves the table clean and completeness unimpeded. — `test/gateway/container-detach-record.test.ts`.

## Open for Myk (at the PR, none blocking the build)

The vocabulary names themselves (`loam.container`, `.excluded`, `.detached`) — deliberate,
precedent-following, and stated here so the P6 review is a yes/no on names rather than a
discovery.
