# Substrate hazards — rhizomatic semantics that bite host code

A distilled defense (ADLC P7). Most entries here are properties of **rhizomatic** that are correct in
the substrate and dangerous in Loam if you forget them. Each one cost us a real bug; each is written
as a question to ask, not a fact to admire.

**Read this before writing code that FILTERS, NARROWS, SUBSETS, or COPIES a delta-set.** That is the
operation these hazards live under. The list is short on purpose — it is a checklist, and a checklist
nobody finishes is worse than none.

One entry (**H10**) is not a substrate property at all: it is a way of writing a TEST that measures
nothing while looking rigorous. It lives here rather than in the process doc because it is recognised
the same way the others are — by reading a diff and asking a question — and because the hazards above
it are what its victims were trying to guard against. A rail that cannot fail is how every one of them
ships.

Why this file exists rather than a section of the spec: SPEC.md records what Loam **is**, grown only
by landings. This records what will **hurt you** while building it. Different genre, different
lifetime — an entry retires when the substrate changes or the hazard becomes impossible by
construction, not when a PR merges.

---

## H1. `negated` ranges over the OPERAND SET, not over the delta

**The property.** rhizomatic's `negated(d, D)` (SPEC-2 §4.3) asks whether `d` is struck *within the
set `D` being evaluated*. Suppression is a property of the **set**, not an attribute carried by the
delta. Pinned substrate-side as the `select-then-mask-scopes-to-operand` conformance vector.

**The hazard.** Filter a delta-set, keep a claim, drop the negation that struck it — and the claim
comes back **LIVE** in the filtered set. Nothing errors. The result is well-formed and wrong.

**Ask.** *Does this operation narrow a delta-set? Then: does it carry the negation closure of what it
admits?* The closure runs **forward only** — from an admitted delta to the negations **of** it,
transitively (a struck strike revives, so one link is not enough). Following it backward would drag
in targets the filter deliberately excluded, turning a scope into a leak.

**Cost so far.** SEVEN sites, and the count is the argument: this hazard is not a bug that was fixed,
it is a shape that recurs at every narrowing edge, so the question to ask of any new one is *where does
this drop a strike?* — never *has this been handled?*

The first three (T38): the quarantine's membership seeding edge; the offered lens, federation-facing,
so peers were receiving claims without their retractions; and `Gateway.freeze`, latent until something
shipped a version. A fourth of the family with a different remedy — promotion checked PRESENCE rather
than SURVIVAL, so a retracted pool output could be adopted into canonical history in the operator's own
voice (T39, refused at the door: survival is knowable before anything is signed).

Then three more in one night, 2026-07-25, each at an edge nobody had asked the question of:

- **The translates edge** (T58). A rendering is a COPY into a fresh id, so no negation of the source can
  ever reach it — survival was checked once, at emit time, and a strike landing afterwards left the copy
  live forever with no later pass able to repair it. The narrowing was a RE-ASSERTION rather than a
  filter, which is this hazard's most durable form. Remedied by carrying, not refusing: the pass signs a
  negation of its own rendering, because a peer runs none of Loam's reader rules and only deltas
  federate. (Contrast T39: `promote` is a door, `translate` is a standing pass — that, not law-vs-fact,
  is what decides refuse against carry.)
- **The live membership watch** (T45). `watchImpl` was the only narrowing door with no closure at all,
  and because a retraction carries only a `negates` pointer, an entity- or context-scoped Term
  *structurally cannot* select it — so a retracted claim was served with no strike beside it.
- **The two inbound doors** (T43). A separate container seeded by an `admit` PREDICATE rather than a Term took the
  caller's raw filter unwrapped; and a rostered pull admitted a post while rejecting its off-roster
  retraction, leaving the claim live in the puller's store with the peer unable to tell.

What the last three have in common is worth more than their count: none was found by a gate. Each was
found by asking one question of one edge, and each edge had looked finished.

**The helper.** `test/gateway/narrowing.ts` — `assertPreservesSuppression`. Any new narrowing
operation should be run through it. Making the next one safe by construction is cheaper than
remembering.

---

## H2. `inView` is stratified at depth 1, permanently

**The property.** No `inView` inside `inView.term` — enforced at PARSE time (`term-json.js`), and
**permanent by design** rather than a gap awaiting a fix (rhizomatic#27). Nesting is *syntactic*
while the things you want to recurse over (container trees, grant chains) have *dynamic* depth, so a
bound would only ever express the case you do not have.

**The hazard.** A trusted set resolved live inside a lens reaches exactly ONE link. Write a recursive
authority chain expecting the lens to walk it and you get a silently shallow answer.

**Ask.** *Does this need to walk a chain?* Then pick a route by **freshness requirement**:

- **Host-flatten to `inSet`** — zero lag, re-resolved per request, no provenance. Use where a change
  must bind on the very **next read**. Revocation is the motivating case: §7 promises "revoking a
  grant un-binds its author's strikes on the very next read."
- **Derived author (L7), then a depth-1 `inView` over its emissions** — any depth, cycles handled
  once, real provenance (`derived.from`, `explain`, replay-verifiable). Costs **one derivation hop of
  lag**.

They **compose** — the same system may run the first on the binding path and the second alongside as
an audit artifact. They answer different questions ("does this bind now?" vs "why did it bind, and
can a third party check?"), so this is not a choice.

**And if you flatten: do not cache the result.** A stored trusted set goes stale silently into a
well-formed wrong answer. Compute per request; the guard is the absence of a cache, not a detector
(SPEC §28.6).

---

## H3. A gather body's `reading` is part of the body, not of the lens

**The property.** `expand.reading` lives in the **gather body** (SPEC-2 §4.5), and a HyperSchema body
is content-addressed data, publishable as deltas (SPEC-3 §5) — **portable by design**.

**The hazard.** Sibling lenses over one HyperSchema necessarily share the child's reading. Two
parties that adopt the same published body share its readings **even in different stores**. "Separate
stores separate readings" is false, and it is the kind of false that reads as obviously true.

**Ask.** *Do these two readers need to read embedded children differently?* Then they need different
**bodies**, not different lenses and not different stores. (Two bodies differing only in `reading` are
different programs with different `termHash`es, so a store may hold both without collision.) The
escape — `reading: {hole: …}` bound at `fix` time — is **unbuilt**, pending a real consumer.

---

## H4. A delta's content address includes its author and timestamp

**The property.** `claimsToCbor` commits to `{author, pointers, timestamp}`. The id is a hash over
all three.

**The hazard.** Two parties asserting the same fact mint **different** deltas. Any scheme that
assumes "same claim → same id" across authors is broken: existence-by-construction checks, dedup
across parties, "did someone already say this."

**Ask.** *Am I relying on two parties producing an identical delta?* They cannot, unless they share a
key. This is also why promotion must **inherit the source timestamp** to be idempotent (§24.3) — the
same operator re-signing the same content at a different moment would otherwise mint a new id every
time.

---

## H5. 0.9.0 parses fail-closed on unknown KEYS, not just unknown tags

**The property.** From 0.9.0, a misspelled or leftover key that used to be dropped silently throws by
name. Correctly-authored terms are unaffected and no canonical bytes move.

**The hazard.** Loam generates terms in at least four places — the governed gather body, the
lawful-strikers predicate, the trust roster predicate, and container membership terms. A stale key in
any generated term becomes a hard failure at upgrade.

**Ask.** *(At the 0.9.0 upgrade.)* Do a deliberate pass over every generated term. Do not trust the
suite to surface it; a term that is only built on an uncommon path will not be exercised.

---

## H6. A PROGRAM name is not a LENS name (`hyperschema.name` ≠ `lensOf(r)`)

**The property.** Since §21.7 coexistence, one HyperSchema may carry several readings. A registration
therefore has **two** names: the program it is over (`r.hyperschema.name`) and the reading it *is*
(`lensOf(r)`). Before coexistence they coincided, so the codebase is full of places where either
would have worked — and a few where the wrong one was chosen.

**The hazard.** Gate on the program name and you authorize **every reading over that program**,
including ones the operator never declared. The failure is silent and it favors the attacker: the
check passes, and resolution then proceeds by lens name against the *full* registered set.

**Ask.** *Is this comparing a name to decide what a door may serve, or which version is meant?* Then
it must be `lensOf(r)`. `hyperschema.name` answers "what program is this over," which is almost never
the authorization question.

**Cost so far.** Six sites — four doors, plus the mint side and the 410 side found 2026-07-21.
`assembleGenesis` stamps every genesis lens with the PROGRAM name (`genesis.ts`, T56), and
`readWithdrawnRegistrations` records a struck registration under the program name while the §17 door
compares it to a LENS name from the URL (`registration.ts:835`, T59) — so a withdrawn sibling reading
answers 404 where the spec promises 410, and a request naming the program can draw a 410 that
confirms a hash was lawful for a different reading. Two further plausible sites are recorded in the
ledger (`gateway.ts:717`, `lifecycle.ts:153`). The four doors, one of them an anonymous-door bypass:
the byte-door gate
(`renderers.ts`, T42), `servesLive` in `surface/rest.ts` (T42), `Name@vN` public-pin resolution
(`public.ts`, T47), and the route door authorizing the pair `(lens, versionId)` then resolving by
`versionId` alone (`renderers.ts:413`, T47 — the pair is the key, and half of it was discarded before
use). Every *other* door check in `renderers.ts` uses `lensOf` — so the tell is a
`hyperschema.name ===` sitting among siblings that don't.

**Why it hides, and why a rail against it is easy to get wrong** (learned T42, 2026-07-21).
`lensOf(r)` is `r.lensName ?? r.hyperschema.name`, so for the ordinary single-reading case the two
names **coincide** and the wrong comparison computes the identical boolean. The bug is invisible
until a coexisting sibling exists — which means:

- A fixture whose lens name equals its program name **cannot see this hazard at all**, and will pass
  identically with the fix present or reverted. The first T42 rail was written that way.
- **Genesis currently DISCARDS the declared lens name** — `assembleGenesis` passes the hyperschema's
  name into the lens slot and drops `Registration.lensName`, alone among the three mint paths. That
  is a **defect (T56), not a law**: two genesis readings over one hyperschema collapse silently and
  array order decides which one serves. Rails route their readings through `publishRegistration`
  today because of the bug, not because genesis is inherently single-lens. When T56 lands, revisit.
- Two coexisting readings **always carry the same field set**: `resolveView` covers every HView
  property and falls back to `schema.default`, so a Schema cannot omit a field. A "redacted sibling"
  is not expressible. Readings differ in *how* they resolve — the §21.7 fixture differs by `asc` vs
  `desc`, and two values at different timestamps is the cheapest way to make two readings genuinely
  diverge so that a 200 and a 404 mean different things.

---

## H7. An idempotence short-circuit must prove it actually landed something

**The property.** Loam is full of operations that are idempotent by content address — publish,
promote, migrate. It is tempting to short-circuit them: *"the output already exists, return
success."*

**The hazard.** The check is usually a **presence** test over a **derived index**. If either is
stale, the operation returns success and lands nothing, and the caller has no way to tell. This is
worse than an error, because the record then disagrees with what the caller believes happened.

**Ask.** *Does this path return success without writing?* Then: is what it checked still valid
(survival, not presence — see H1), and does the caller learn which of the two happened? An operation
with two outcomes should answer which one it was.

**Cost so far.** Twice, in the same shape. `publish` returned success on a no-op — fixed in
[#151](https://github.com/bombadil-labs/loam/pull/151) ("publish answers its outcome"). `promote`
does it today over a stale adoption trail (T46), permanently refusing to re-establish provenance the
operator withdrew, while reporting success. Two occurrences is why this is a hazard and not a bugfix.

---

## H8. A delta store invites the full scan — notice it, and pick the affordance carefully

**The property.** rhizomatic's model is a delta SET you evaluate over. That is correct, and it is
seductive: almost every question ("what is lawful?", "what is struck?", "what is on disk?") has an
obvious answer that walks everything. The obvious answer is usually right the first time and wrong at
the tenth thousand delta.

**The hazard.** These scans land on paths that run per-request, per-append, or per-boot, and their
bound grows MONOTONICALLY — deltas are append-only, tombstones are append-only, so nothing ever
shrinks the walk. It never fails; it just gets slower forever, and it is invisible in a test suite
whose fixtures hold ten deltas.

**Ask, every time you write a loop over the whole set:** *what runs this, how often, and what bounds
it?* Then, before reaching for infrastructure, check the cheap fixes first — they are usually enough:

- **Invert the loop.** Walking `items × candidates` when `candidates × items` answers identically is
  the most common form, and it costs nothing to fix. `ArchiveBackend.purge` was `ids × fans × files`
  and is now one pass over files with a Set lookup: ~10M string comparisons per boot became ~10k.
- **Then, and only then, an affordance** — and choose by FAILURE DIRECTION, which matters more than
  speed:
  - An index of **work completed** (a swept high-water mark) fails SAFE: lose it and you redo the
    work, which is idempotent and merely costs time.
  - An index of **data location** (`id → path`, a materialized set) fails OPEN: it knows only what
    was successfully recorded, so it is blind to exactly the cases a completeness sweep exists for —
    a crash between fsync and rename, a misfiled copy. See H7; this is the same trap wearing a
    performance costume.

  **Index the work you have COMPLETED, never the data you expect to FIND.** `ArchiveBackend` already
  embodies this: it keeps an `onDisk` set that `append` consults to skip rewrites, and `purge`
  deliberately never asks it what to remove.

**The dual hazard — a scan you must NOT remove.** The cure above removes redundant scans; the mirror
hazard is removing one that was never redundant. A scan on a WRITE or a SAFETY decision may be a
STAMP-TIME FRESHNESS read, not a recompute of something a caller already holds. If any `await` sits
between the value's earlier read and its use, another operation can run at that yield and change the
state — so the cached value answers *was this true THEN*, and the guard silently reads it as *is this
safe NOW*. T233: the severed-channel guard walked `channelStatus` on every stamp, which reads exactly
like an H8 redundant scan — the sync already read the status at poll-top. Caching that poll-top read to
skip the walk reopened the precise resurrection the guard exists to refuse: a `drop` landing during the
sync's `await pull()` made the cached value stale, and the guard admitted a severed channel back into
existence. Three independent lenses flagged the scan as redundant before one traced that it was a
freshness re-read. The scan stays; T237 makes it O(1) with an index of live-channel names (work
COMPLETED, per above) — never a cached read carried across the await. **The tell:** the "redundant"
value decides a safety matter, AND an `await` separates its read from its use.

**Be judicious.** Durable state you did not need is another thing that goes stale and lies. Measure
after the cheap fix before adding any.

**Cost so far.** Three sites, none of them a wrong ANSWER — which is why review keeps waving them
through: constitutional reads scan the whole store per request (T37); `withNegationClosure`
materializes the whole store per call on three hot paths (T51); and `ArchiveBackend.purge` was moved
onto the boot path by T55's own fix, at `erasures × archived deltas`, before the inversion landed.

---

## H9. A swallowed failure answers NO — and a caller weighing safety hears "it is gone"

**The property.** Loam has probes whose FALSE is a licence: `holds(id) === false` lets an erasure
report §11 completeness, an empty `quarantine()` lets a boot proceed, a zero purge count reads as
nothing-to-do. These are not neutral reads. A negative answer authorizes an action.

**The hazard.** Every `catch { continue }`, every discarded return value, every `?? false` inside
such a probe converts *"I could not determine this"* into *"the answer is no."* The conversion is
silent by construction — that is what the catch is for — and it happens at the exact moment the
system is least healthy, which is when the probe matters most. It is H7's mirror image: H7 reports a
success it never proved; H9 reports an ABSENCE it never proved.

**Ask.** *Does a FALSE from this function permit something?* Then walk every path that can produce
false and ask which of them mean "checked, and no" versus "did not check." Name the narrow error you
can genuinely interpret — `ENOENT` means a directory really is not there — and rethrow the rest. If
the answer is composed from several sources, ask what happens when one refuses: `Promise.allSettled`
plus "attempt all, then report the first refusal" is the shape that keeps a partial answer from
posing as a whole one. And if a report carries a failure field, **find its reader** — a field nobody
reads is a swallowed error with extra steps.

**Cost so far.** Three sites in one night (2026-07-23, T67's P5). `ArchiveBackend.holds` caught every
`readdirSync` error, not just `ENOENT`, so an unreadable fan answered "no bytes here" and `erase`
reported a completion over legible plaintext — the very bug the ticket existed to fix, on the tier
the fix was written for. `MirrorBackend.heal` records refused sweeps into `purgeFailures`, promising
in its own comment that the operator is told; the CLI's boot sequence now reads that field and
reports each failure to the operator on `stderr` (`cli.ts:146`), closing the T70 silence. And the
pool fan-out aborted on its first refusal, so replicas ordered behind a broken one were never swept —
an unexamined replica reported as a clean one.

---

## H10. A rail whose expected value comes from the code under test measures nothing

**The property.** A test is a comparison between what the code does and what somebody decided it
should do. The second half has to come from OUTSIDE the code — a literal, a golden file, a hand-written
list, a second independent computation. The moment the expectation is *derived from the subject*, the
comparison is between the code and itself, and it holds no matter what the code does.

**The hazard, and it is SILENT.** This has three recognisable disguises, and all three read as diligence:

- **The self-referential list.** `expect(SHIPPED.every(x => isSealed(x))).toBe(true)` passes when
  `SHIPPED` has one element. So does `it.each(SHIPPED)`. Narrowing the shipped set narrows the test
  with it, in lockstep, forever.
- **The empty-set pass.** `expect(everythingWrong).toEqual([])` is green when the input was empty —
  because the filter is wrong, because the regex never matched, or because the collection the book or
  the config or the manifest was supposed to hold is simply absent. Mutual pairs are the worst case:
  *every declared item is used* and *every used item is declared* are BOTH satisfied by declaring
  nothing and using nothing.
- **The echo fixture.** A stub that reflects a request back — pulling a field name out of the query
  the code just composed and answering to it — confirms a wrongly-composed request exactly as
  readily as a right one. The bug lives in the composition, and the fixture agrees with it.

Each disguise survives review because the test *names* the right property. Only the expectation is
counterfeit.

**Ask.** *Where did the expected value come from, and could the code have changed it?* Then, the
sharper form, which is mechanical enough to run on every assertion you write: **shrink the subject
to nothing and re-read the test.** Set the list to one element. Set the collection to empty. Delete
the feature whole. If the assertion is still green, it is not measuring the thing in its own title.
For a fixture, ask instead: *can this fixture DISTINGUISH the right answer from the wrong one?* — a
corpus in which two derivations coincide (all-lowercase names, a program name equal to a lens name,
a two-member set that cannot tell `> 0` from `> 1`) cannot see a bug between them, however many cases
it enumerates.

**The fix is cheap and it is always the same shape:** write the expectation by hand, next to the
assertion, and add a rail that the shipped set COVERS the hand-written one. Then a narrowing goes red
and a widening asks you to update a list on purpose. Where the expectation is a whole corpus, add a
FLOOR — a count the collection must exceed — so a vacuous pass becomes impossible rather than merely
unlikely.

**Cost so far.** Seven sites in one day (2026-07-25), found by three different lenses across three
unrelated changes, which is what earned this its own entry rather than a line under H7:

- The capabilities book's term rails were mutual in exactly the way described above — `TERMS = []`
  with no markup satisfied both — and its figures likewise. Its receipts rail was worse: every
  citation check was guarded on `claim.proof` being truthy, so setting all 82 proofs to `null` with a
  one-character reason deleted the feature under a green bar. Closed with floors and a CAP on the
  unproven count, which can only rise by editing the line.
- Its coverage rail was satisfiable by appending one string to a chapter's `covers` — the spec
  section counted as documented with nothing a reader could see. Closed by requiring a covered
  section to be CITED by one of that chapter's own claims.
- T79's sealed-channels rail iterated the very list it measured: narrowing the shipped set to one
  entry still passed. Its sibling file had already solved this with a hand-written `MUST_SEAL` plus a
  covers-check — so the discipline existed in the change and was applied to one of the two lists it
  shipped. Seven of `HOST_GLOBALS`' twenty-four names were exercised by nothing at all.
- T79's mutation rails ran against an ECHO fixture, and every writable prop in the corpus was
  lowercase-initial — the one shape in which the store's two name manglings coincide. The page was
  composing argument names with the root-field derivation, so every artifact-hosted write of a
  capital-initial field would have failed against every real store. The read side had the same bug and
  was caught, because there one rail POSTed the composed document to a live schema.
- T64's receipt-field rail asserted a literal declared fourteen lines above it in the same file, and
  its vocabulary rail was a dedupe check over a two-element literal.
- And the tooling did it to me while I was writing this up: an `until` loop polling CI with
  `jq 'all(.bucket != "pending")'` exited immediately, because `all` over an empty array is `true`.

**And the cost is not one missed bug — it is every bug downstream staying invisible.** Measured the
same day, on T79: repairing two vacuous rails immediately turned up defects nothing else had seen.
Recording `invalidate` into the harness's call log made the de-vacuumed retry rail go red, which
revealed there was no per-code retry exclusion *at all*; and the first rail to actually EXECUTE the
realm program found that a throw inside a then-success callback never reaches that same then's
rejection handler, so a faulting bundle posted nothing and the page recovered only on its clock. Both
had been sitting under a green bar. So a rail that cannot fail is not merely worthless — it is load-
bearing in the wrong direction, holding a whole region of the code out of reach of every later review.
Fix the rail first, then read what it says.

**Provenance.** 2026-07-25 — distilled at P7 from the P5 rounds on T64, T79 and T95.

---

## Adding to this file

An entry earns its place by having **cost something** — a bug, a near-miss caught in review, or a
substrate answer that contradicted what we believed. Not by being interesting.

Write it as: the property (with its SPEC citation), the hazard (what goes wrong, and whether it is
loud or silent), the question to ask, and what it cost. **The question is the load-bearing part** —
this file is used by someone scanning for "does this apply to me," and a hazard they cannot recognize
in their own diff is a hazard they will ship.
