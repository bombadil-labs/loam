# T31 — Trust on load: the smallest safe blessing is ONE EXPORT, and it costs one gesture

**Ticket.** T31. **Amends** `spec/27-containers.md` (closes §27.6's question 3). Design-stage: this
spec answers the question and carries the recommendation; **the decision is Myk's at the PR**. It
lands on the capability surface, so the PR is his merge regardless of its cleanliness. T33 builds
what this decides.

## The question, and the reframe that dissolves most of it

§27.8 fixed the domain: a manifest's law rows — hyperschema, schema, resolver binding, renderer
binding — are what a blessing ranges over (entities and byte-blobs are facts and bind nothing).
The question as inherited: when a module is installed, is its law blessed **whole-module or
per-export**?

The 2026-07-24 design conversation (Myk + Claude, in chat) reframed the ground under the question:

> **Install is containment. Blessing is adoption.**

A loaded module RUNS, fully, inside its container: its law binds there (effectiveness attenuates —
§28.1 — which bounds force, never function), its doors serve from its mount, its facts cross by
promote-outputs as they earn it. The common gesture — *use this app* — needs **no blessing at
all**. Blessing is the separate, deliberate act of taking a module's law into your OWN trust
domain: adopting its schema so your root reads resolve through it, or serving its renderer as
yours. So the granularity question is not about installation friction; it is about what the
adoption gesture names.

## How it is actually used — the stories the recommendation must survive

**1. The app, used behind glass.** You load a stranger's movie-night module. It serves at
`/movie-night/*`, writes into its container, its facts cross by adoption. Zero law blessed. If
blessing were the install step, this — the overwhelmingly common case — would be paying trust it
never needed.

**2. The hub adoption (Myk, 2026-07-24: this is FREQUENT, not rare).** Discovery is export-first:
nobody browses a hub for "a module," they browse for **the best `Post` schema** — rated, mirrored,
named by content address. The gesture that has to be cheap is *adopt this one schema into my
root*: one line, `(source, alias, version) → blessed`. The manifest's mirroring claim ("my `Post`
IS `post-schema@1e20…`") is verifiable by address equality BEFORE adopting — compatibility as
arithmetic, not marketing. A whole-module blessing here is a footgun: it would drag a
renderer-with-a-pen into the root because the user wanted one schema for interop.

**3. The vendor suite.** An operator who trusts an author wholesale installs their module and
wants everything bound at once. Legitimate — and expressible as SUGAR: "bless all" enumerates the
manifest's law rows and performs N ordinary adoptions, each with its own provenance record. The
audit trail stays per-row; the gesture stays one line.

**4. The version bump.** `social@1` was blessed; `social@7` arrives with two law rows `@1` never
had. Per-export blessing makes the upgrade question EXACTLY the right size: the rows whose
identities are unchanged (same §21 schema identity, same content-addressed bundle) are already
blessed — the same law is the same law — and only the NEW rows ask. Whole-module blessing forces
either re-asking everything or silently extending trust to rows nobody saw.

**5. The bridge.** A `PostA↔PostB` adapter module (vocabulary lens, semantic derivation, or
identity mapping — 2026-07-24 riff) is LAW, and adopting it is the same per-export gesture. One
verb covers schemas, bridges, resolvers, renderers: `adopt <thing>@<address>`.

## The recommendation

**Per-export is the primitive. Whole-module is sugar that expands to it.**

- **The blessing unit is one manifest law row**, named as the consumer names it:
  `(module version, alias)` — resolved through the manifest to the export's stable identity, then
  blessed by that kind's ORDINARY publish path (§24.4's decision: promotion-of-law reuses
  `publishRegistration` for a schema, the §22 binding publish for a resolver, `publishRenderer`
  for a renderer), stamped with a `loam.adoption` record naming the source module version. No new
  trust machinery: the blessing IS the publish the operator could already perform, plus
  provenance — with ONE guard the ordinary path lacks, below, because adoption is exactly where a
  module-local alias meets the root's LIVING registry.
- **The root-name guard (premortem finding 1 — the headline).** The gesture names the module's
  ALIAS, but a schema blessing lands on the schema's own SEMANTIC name, which §21 gives
  latest-wins living semantics — so an unguarded adoption would silently capture an existing root
  `Post`, re-pointing every subsequent root read (and the hub world guarantees the collision
  arrives, benignly at first, then as a one-line confused-deputy attack). Therefore: **adoption
  REFUSES when the target's semantic name's CURRENTLY-WINNING root registration has different
  content** (the winning one, explicitly — a superseded historical registration neither blocks
  nor no-ops an adoption), and proceeds only with an explicit `supersede` or `as <name>` (bless
  under a different root name). Same-content-as-the-winner is the idempotent no-op. Two
  semantics the review demanded be stated rather than assumed (adversarial review, 2026-07-24):
  - **The guard is ATOMIC, and the mechanism is NAMED: the single-writer gateway** (round-2
    review, 2026-07-24 — a CAS with no mechanism is a wish). The store doctrine already holds
    that one writing gateway fronts a store, and lawfulness is authorship: a registration BINDS
    only when operator-signed, and the only mint path for operator-signed law is this gateway's
    own doors — a registration arriving by federation lands as data and binds nothing. So
    serializing the adoption door serializes everything the guard defends: the door holds the
    name-check and the append in ONE critical section per semantic name (an in-process queue —
    door logic like every other refusal, not a substrate primitive; rhizomatic needs nothing).
    The adoption CARRIES the winner it observed; if the winner moved by its turn in the queue,
    it refuses naming the mover. Concurrent different-content adoptions resolve to exactly one
    success and one refusal, never two publishes.
  - **The guard covers every law kind's living surface, not schemas alone.** Each kind has a
    latest-wins name a stranger's row could capture: a schema its semantic name, a renderer its
    ROUTE (§23.5 is latest-per-route — the same shape), a resolver its binding name. One rule,
    three surfaces: adoption refuses when the kind's currently-winning holder differs in content,
    with the same `supersede`/`as` outs. "Different content" is STRUCTURAL identity — the same
    content-address arithmetic as everything else — so two semantically-equivalent but
    differently-written programs refuse as different. Deliberate and fail-safe: semantic
    equivalence is not decidable, and the false positive costs one explicit `supersede`/`as`
    gesture, while a false negative would silently swap law.
  - **`supersede` OUTRANKS; it never negates.** It is the ordinary §21 latest-wins publish, eyes
    open: the prior registration remains on the ground, negatable separately, and if the
    superseding registration is itself later negated the prior one RESURFACES as the winner —
    which is §21's living semantics, stated here so no implementation invents a destructive
    variant.
- **Idempotent by CONTENT ADDRESS** (never the living name — implementing identity as the living
  name would hand findings 1 and 3 a bypass). Adopting a row whose target content address is
  already blessed is a no-op — recorded as a DISTINGUISHABLE record kind, **witnessed** rather
  than **adopted-from**, so a module exporting a row matching law you already trust can never
  claim origination credit in your ledger (premortem finding 5), and no future revoke-by-module
  tool mistakes a redundant witness for a source. **A witness of an identical (source version,
  alias, content address) tuple is minted ONCE** — re-running the same adoption is wholly silent
  (round-2 review: an hourly scheduled `blessAll` must not append narrative forever), which also
  makes re-running the natural RECOVERY for a partially-failed `blessAll`: landed rows witness
  silently, remaining rows adopt.
- **"Bless all" is enumeration**, not a distinct mechanism: N rows, N adoptions, N provenance
  records, one gesture. Partial failure refuses the remainder loudly rather than half-installing
  silently. Two disclosure rules keep the sugar from quietly becoming the primitive (premortem
  finding 2): it MUST enumerate what it is about to bless BY LAW KIND, and a **pen-holding
  renderer (§23.3) never rides the sugar** — blessing one requires its own distinct flag, refused
  otherwise. And on a version bump the enumeration is a THREE-way diff (finding 3): unchanged /
  added / **RE-POINTED** — an alias whose target content address changed. A re-point is the
  supply-chain move (the alias carries the reputation; the swap inherits it), so it never rides
  `blessAll` silently: it requires its own explicit confirmation, checked against the prior
  adoption record's alias→address binding — pure address arithmetic over records that already
  exist. **And the classification the guards run on has ONE source of truth: the verified,
  content-addressed export itself — never a manifest field** (adversarial review, 2026-07-24).
  The module is a stranger's; its manifest's kind labels are display copy. A row IS a renderer
  because the bytes at its address are a renderer binding; it HOLDS a pen because that binding
  names one — both read from the export the address resolves to, so a manifest that misdeclares
  a pen-holding renderer as a schema changes nothing: the pen guard classifies from the bytes
  and still refuses. A manifest row whose address resolves to NOTHING, or to bytes that classify
  as no law kind, refuses the whole call naming that row — a stranger's manifest gets no silent
  skips (a skip is how a crafted manifest hides a row); an empty manifest refuses as "exports no
  law", same as the facts-only module.
- **Adoption records are NARRATIVE, never a revocation index** (premortem finding 4). Twelve
  months in they overcount (records outlive negated bindings; witnesses accumulate) and undercount
  (directly-published law has none). The authoritative "what law of module M binds in my root?"
  query is **content-address intersection** between currently-bound law and M's manifest —
  arithmetic, always current — and it ships as a first-class query (`lawFrom`) so the right tool
  exists before anyone writes the wrong one against the records. Its semantics are stated
  precisely because shared law would otherwise over-attribute (adversarial review, 2026-07-24):
  `lawFrom(M)` answers **"law this root currently binds that ANY manifest version of M this
  store holds also lists" — the UNION across versions, set membership, NOT provenance** (round-3
  review: intersecting only the latest manifest would report "no exposure" for a row adopted
  from `@1` that `@7` later dropped — the exact miss the query exists to prevent; a version
  argument NARROWS from the union, never replaces it). A common `Post` bound at this root reports under `lawFrom(M)`
  AND `lawFrom(N)` when both manifests list it, and that is the correct answer to the incident
  question ("am I exposed through M?"). What no tool may do is treat it as origination: a
  revoke-by-module tool acts on exposure only with the operator confirming each shared row —
  the witnessed-vs-adopted-from records (above) exist precisely so origination, where it is
  wanted, is asked of the ledger and never inferred from arithmetic.
- **Version skew gets eyes** (premortem finding 6). The honest answer to "these travel together"
  is the version identity as a social contract — but honoring a contract requires seeing when you
  are outside it. Adopting a row while a SIBLING row of the same module is bound from a different
  version reports the skew (the manifests carry both frozen sets; this is address comparison, not
  machinery). A note, not a refusal: mixed versions are lawful, silently mixed versions are how
  wrong-winner resolutions get blamed on authors who never shipped that combination. Scope,
  stated honestly: a sibling's bound version is determined from its ADOPTION RECORDS (the
  narrative is good enough for a courtesy note, unlike revocation), so skew detection covers
  adopted rows only — a sibling the operator directly published carries no version attribution
  and is invisible to the note. The blind spot is named rather than papered: `lawFrom` still
  reports such a row's exposure; only the which-version courtesy is unavailable for it.
- **The counterargument, answered rather than omitted.** Per-export means a module can run with
  its schema blessed and its resolver still on probation — a configuration its author never
  tested. True, and already true of any store: law is independently negatable after any blessing,
  so "whole-module" could never actually promise co-installation over time. The honest tool for
  "these travel together" is the module's VERSION IDENTITY (the author ships them as one frozen
  set), a fact the manifest states and a consumer can honor — a social contract enforced by
  address, not a store-enforced bundle.

## What this does NOT decide

Ratings/discovery conventions (the hub ticket), the Merkle-set rung, dynamic mounts, and the
`adopt` CLI's exact flag surface are adjacent tickets. This spec fixes only the blessing's UNIT,
its MECHANISM (ordinary publish + adoption provenance), and its IDEMPOTENCE rule.

## Acceptance criteria (T33 transcribes these; each names its verification)

1. **Adopting one schema export blesses that schema and nothing else.** After `adoptLaw(version,
   "Post")` against a module also exporting a renderer: the schema binds in the root (a root read
   resolves through it) AND the renderer still serves 404 from the root while serving 200 from the
   module's own container. — `test/gateway/adopt-law.test.ts` (object level: what the root's door
   answers, not what a registry lists).
2. **The blessing is the ordinary publish path.** The deltas landed by an adoption are
   shape-identical to a direct operator `publishRegistration` of the same schema, plus exactly one
   `loam.adoption` record naming the source module version. — `test/gateway/adopt-law.test.ts`,
   asserted by diffing the two grounds delta-for-delta.
3. **Facts never need it.** Against a module exporting only entities/byte-blobs, with ZERO
   adoptions performed: the byte door serves the exported blob (200, correct bytes) and a read
   resolves the exported entity — while `adoptLaw` against the same module refuses with "exports
   no law". — `test/gateway/adopt-law.test.ts`.
4. **Idempotence by identity.** Re-adopting an already-blessed row is a no-op plus provenance (no
   second binding, no rebind churn: `materializationFor` returns the same materialization). —
   `test/gateway/adopt-law.test.ts`.
5. **Version-bump delta.** After blessing `social@1` wholesale, `blessAll(social@7)` (two new law
   rows) performs exactly two new bindings; the five unchanged rows are recorded as already-blessed
   provenance, not re-published. — `test/gateway/adopt-law.test.ts`.
6. **"Bless all" is enumeration.** Its ground after success is delta-identical to N sequential
   single adoptions; on a row that fails validation it refuses the REMAINDER loudly and reports
   which rows landed. — `test/gateway/adopt-law.test.ts`.
7. **A blessing crosses a wall only by re-signing.** Adopting from a wall-posture container mints
   root-signed deltas (adoption-merge, §27.3); the module's own deltas are untouched and the
   module's container still resolves through its ORIGINAL law. — `test/gateway/adopt-law.test.ts`.

8. **The root-name guard.** Against a root already registering `Post`, adopting a module's
   different-content `Post` REFUSES (the pre-existing root read still resolves through the
   original law — object level, at the door); with `supersede` it takes over the living name;
   with `as "TheirPost"` both readings serve side by side. — `test/gateway/adopt-law.test.ts`.
9. **A pen never rides the sugar.** `blessAll` over a manifest containing a pen-holding renderer
   refuses without the distinct pen flag, and its refusal names the renderer; with the flag it
   proceeds. — `test/gateway/adopt-law.test.ts`.
10. **A re-point never rides silently.** After blessing `social@7`, `blessAll(social@8)` where an
    alias's target address CHANGED refuses that row without explicit confirmation (naming old and
    new addresses), while genuinely new rows in the same call proceed. — `test/gateway/adopt-law.test.ts`.
11. **The witness record is not an adoption record.** Adopting a row whose content address is
    already bound mints a `witnessed` record, distinguishable by shape from `adopted-from`; a
    provenance walk finds no origination claim by the second module. — `test/gateway/adopt-law.test.ts`.
12. **`lawFrom` answers by address intersection.** After adopting two of a module's rows, negating
    one binding, and directly publishing a third row's identical content: `lawFrom(module)` reports
    exactly the surviving bound intersection — the negated row absent, the directly-published row
    present. — `test/gateway/adopt-law.test.ts`.
13. **Skew is reported.** Adopting one row of `social@7` while a sibling row is bound from
    `social@1` returns a coherence note naming both versions; adopting when all siblings match is
    silent. — `test/gateway/adopt-law.test.ts`.

14. **The guard is atomic, and the rail FORCES the race.** Using the adoption door's test seam
    (a post-check hold — the same injected-barrier idiom the store suites already use for WAL
    races), adoption A is held between its name-check and its append while adoption B of
    different-content same-name law runs to completion; releasing A yields exactly one bound
    registration and one refusal naming the mover. A sequential pass of the same pair proves
    nothing and the rail must not be satisfiable that way. — `test/gateway/adopt-law.test.ts`.
15. **A lying manifest cannot smuggle a pen.** Against a module whose manifest declares its
    pen-holding renderer as a schema row: `blessAll` without the pen flag STILL refuses, naming
    the renderer — classification read from the export bytes, not the manifest. —
    `test/gateway/adopt-law.test.ts`.
16. **`supersede` outranks and is reversible.** After `supersede`-adopting a module's `Post` over
    the root's original: root reads resolve through the module's law; negating the superseding
    registration resurfaces the ORIGINAL as the winner (object level, at the door). —
    `test/gateway/adopt-law.test.ts`.
17. **`lawFrom` is exposure, not origination.** With a common schema listed by two modules'
    manifests and bound once: it reports under BOTH `lawFrom` calls, and the witnessed/adopted
    record kinds still distinguish the originating module. — `test/gateway/adopt-law.test.ts`.

18. **A witness never accumulates.** Running the identical adoption three times leaves exactly
    one witness record for that (source, alias, address) tuple; the ground's delta count is
    unchanged between run two and run three. — `test/gateway/adopt-law.test.ts`.
19. **A dangling manifest row refuses the call.** A manifest listing a row whose address resolves
    to nothing (and a second whose bytes classify as no law kind) refuses `blessAll` naming the
    offending row; no partial adoption lands. — `test/gateway/adopt-law.test.ts`.
20. **The route is a living name too.** Adopting a module renderer whose ROUTE is already served
    by different-content root law refuses without `supersede` — the §23.5 latest-per-route
    surface gets the same guard as the schema name. — `test/gateway/adopt-law.test.ts`.

21. **`lawFrom` unions across manifest versions.** A row adopted from `social@1`, still bound,
    dropped from `social@7`'s manifest: `lawFrom(social)` still reports it; `lawFrom(social@7)`
    (the narrowing form) does not. — `test/gateway/adopt-law.test.ts`.

## Open for Myk (the decision itself)

Accept per-export-as-primitive + bless-all-as-sugar? The 2026-07-24 conversation leaned yes after
the install-vs-adopt reframe and the hub stories; recorded here as a RECOMMENDATION awaiting his
word at this PR.
