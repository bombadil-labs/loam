## 43. The listing door — container-backed enumeration on the authed door

Every registered lens serves a listing field on the **authed** GraphQL door: `plants(limit, after)`
beside `plant(entity)` — one page of the entities holding this lens's evidence, each resolved
through the lens, ascending by entity id. It exists because "all the Plants" was a question the
system could not answer at all (§34 hit that wall within an hour of the board going live — T110 was
minted that day, and the board was its first customer). No new data is served: a token holder could
already read every entity point-wise; the listing is a new *index* over already-served data. The
public surface gains nothing — see 43.4.

### 43.1 Membership is an evidence-level question, and a container is the answer

An entity has no type, and any entity reads through any registered lens — so "the Plants" cannot
mean "entities of kind Plant". It means: **which entities hold claims in the buckets this
hyperschema's readings resolve into fields**. The maintained answer is a **container** (§27), one
per hyperschema — `container:hyperschema:<program>`, trust `curated`, posture `shared` — whose
membership Term is the gather's selection **un-rooted**: every delta carrying a pointer whose
context is in the union of the surviving sibling lenses' prop contexts. One container per
*hyperschema*, N listing fields per *lens*: the container answers which entities have relevant
evidence; which View each resolves to depends on the schema the caller asked through.

Riding the container algebra is the point, not a convenience. The candidate set is a governed,
erasure-reachable, freezable maintained set from birth: **exclusion narrows it** (excluding the
container empties the listing — railed, and a bespoke scan could never honor it), `freeze` names
it, and the read goes through the **container scope** — negation-closed, fail-closed on any
unresolvable dependency, never a bare Term evaluation.

Two closures keep the set honest:

- **The context union reads the latest-per-lens grouping, never the flat registration list** — the
  flat list legitimately holds a superseded binding beside its evolution, and a union drawn from it
  would admit contexts no surviving lens reads (the H6 family's shape). An evolved lens that
  narrows its props narrows the membership.
- **The membership suppresses by the program's own mask, lifted from the hyperschema body**
  (`programMaskJson`), not by a hardcoded posture. The candidate set and the reading must suppress
  by the same rule, or an entity vanishes from the enumeration while still resolving through the
  point door — and "absent from the list" reads as "no such entity", a strictly bigger claim than
  any single read makes. A hardcoded `drop` was exactly that bug: it handed the heckler's veto back
  to the enumeration that `governedGatherBody` exists to make inert. A body that masks two
  different ways refuses — one candidate set cannot suppress by two rules at once. A body that
  masks nothing gets a membership that masks nothing, rather than an invented suppression.

### 43.2 The declaration, and what guards it

The first listing declares the backing container, operator-signed; a widened context union (a
sibling lens arrived) re-declares — membership is a latest-wins knob (§27.1), so the refresh is one
more declaration, never an edit, and same-membership is a no-op. The re-declaration **carries the
standing record's other knobs** (`parent`, `version`, `inboxOf`): a declaration is latest-wins over
the whole record, so omitting a knob deletes it, and a refresh that knew only its own knobs would
silently re-root a container an operator had nested — a read quietly undoing a write.

Three refusals guard the read *before* any short-circuit:

- **A squatted name refuses.** If `container:hyperschema:<program>` stands declared with any other
  trust/posture, the door refuses rather than serve a pool's snapshot as "the Plants" — trust and
  posture are immutable (§28.4), so no re-declare could repair it silently either.
- **A detached backing container refuses.** Detached ground contributes nothing to a scope read by
  design, which for a caller who never named a container would turn "off the record" into a
  complete-looking empty page (H9). The exclusion knob is the deliberate way to empty a listing.
- **An addressed membership refuses.** The door compares the *inline* Term to decide whether
  anything changed; a membership standing at a published address never matches, so every read would
  mint one more operator-signed declaration, forever. Refusal is the honest answer to a container
  the door cannot tell is already correct.

An ungoverned store refuses outright: no operator, no container, no silent fallback. An
unregistered lens refuses in the door's own voice.

### 43.3 The page

Members are deltas; the door serves entities: the read projects the distinct entities the member
deltas point at (in the listing contexts), sorts ascending, and slices. Ordering is deterministic
across stores and pulses, which is what makes `after` an honest cursor — exclusive, the last
`_entity` of the previous page; a moved ground shifts entities, never reorders them. The §14 edge
rides along: an entity can hold evidence yet resolve sparse under the asked lens — the door returns
views, and absence stays absence. Claims in contexts no lens reads as a prop are not members, by
design: a dynamic-only entity is invisible to the listing.

The bounds are **measurements, not preferences**, pinned as literals in the rails: `limit` is
1..**25**, default **10**, out-of-range refuses loudly. A cold resolution is O(ground) (~655ms per
entity at a 10k-delta ground, memory backend, 2026-08-12), and the door's first cap of 500 bought
one authed request ~330 seconds of *blocked event loop* — `resolvedNode` is synchronous, so every
other mount and the tokenless public door waited behind one caller's page. Two fixes, both needed:
the cap, and a real yield **between** resolutions (a macrotask, railed with a negative control), so
what remains is the caller's latency rather than the server's. Neither makes the door cheap; they
make it bounded and interruptible — the rest is T163 (43.5).

### 43.4 Authed only — the public surface never builds the field

Enumeration is exactly what the uniform-refusal discipline (§12) prevents elsewhere: a public
listing door can inventory a store. So on the read/public projection the listing field **is never
built** — a validation impossibility, not a guarded field. The rails pin the honesty at the byte
level: a tokenless query for `plants` gets the same error a field that never existed gets
(identical modulo the field name), so no prober learns the authed surface can enumerate; a missing
token and a foreign token meet byte-identical 401s, so bad credentials never downgrade to
anonymous. Public enumeration waits for §12's per-lens `enumerable` flag, deliberately.

### 43.5 Open edges, ticketed rather than hidden

- **T163 — the cost is linear in the ground, three times over.** The membership Term is not
  maintained incrementally (`select` re-runs over the whole ground per page); the projection is
  quadratic on a cursor walk (every page projects and sorts the whole id set before slicing); a
  cold resolution is O(ground) per listed entity. None returns a wrong answer, which is why the
  shape keeps passing review (H8); the cap of 25 is the containment, and it may rise only on
  evidence.
- **T164 — a read mints law.** `ensureListingContainer`'s only caller is the body of a GraphQL
  query, and it signs an operator declaration. Beyond the surprise itself: a transiently unbound
  sibling lens narrows the context union, the next read re-declares narrower, the read after the
  rebind declares wider — one permanent operator-signed delta per flap, and nothing collects them.
  The declaration wants to live where registrations bind, with `list` a pure fail-closed read.
- **T165 — `${name}s` reserves the plural of every lens name.** A store serving both `Item` and
  `Items` was well-formed before this door and refuses after it, with no §20 migration shipped.
  The collision refuses loudly for a manual `register()` and is **swallowed for a store-origin
  replay** (the lifecycle catches a candidate's bind failure by design), so which of the pair
  survives depends on replay order. And English is not a naming scheme. The rail pinning today's
  both-orders refusal is to be revisited, not preserved, by whatever T165 decides — Myk's call.
- **T90 adjacency:** `select` applies no dead-set filter, so a condemned-but-not-yet-purged delta
  lists until its purge lands; and a frozen backing container would make erase's pinning guard
  refuse erasures of that evidence — a fail-closed surprise, named in the rails.

**Provenance.** [#371](https://github.com/bombadil-labs/loam/pull/371) (T110; design settled by
Myk 2026-07-26, authed-only ruled the same day). Implementation: `src/gateway/listing.ts` (the
whole mechanism) and the listing-field block in `src/gateway/gql.ts`; rails in
`test/gateway/listing.test.ts` (both levels: the served page, the declared container, suppression
closure, exclusion emptying the listing) and `test/server/listing-door.test.ts` (the transport
refusal shapes). The page bounds were re-measured and tightened post-landing (the 500→25 cap and
the inter-resolution yield); T163/T164/T165 were minted by this landing's own P5 panel and audit.
