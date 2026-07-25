# The blessing is an ordinary publish that remembers its probation (T33)

**Date:** 2026-07-25. **Ticket:** T33. **PR:** [#210](https://github.com/bombadil-labs/loam/pull/210).
**Spec:** §24.4 closed, §27.6 question 3 closed, §27.8's `loam.manifest` vocabulary minted.

Promote-outputs (#111) has refused law since July and pointed at a door that did not exist. It exists now.
`src/gateway/adopt-law.ts` carries the whole concern: the `loam.manifest` row mint, classification read from
the export's own BYTES inside a frozen version's members, and `adoptLaw` / `blessAll` / `lawFrom` /
`lawAdoptions` over the ordinary publish paths under the operator's authorship. §24.4's recommendation held
verbatim — the graduation is a publish, not a flag — and the only thing it could not have anticipated is how
much of the design turned out to live in the word *which*: which name, which entity, which author's strike,
which of two modules originated the law you already trust.

The premortem paid for itself before a line of code. Six narratives read the ticket against the sealed spec
and found four traps: the ticket's `promoteLaw(deltaId)` sketch and the spec's `adoptLaw` door would have
shipped as two mechanisms with every guard on only one of them; the pen-conferral trap the ticket itself
names had no criterion number; a row struck in its own container would have blessed on presence alone; and
criterion 2's "shape-identical to a direct publish" was **mutually unsatisfiable with the erasure rail** —
resolved the #111 way, blessed deltas inheriting the source's timestamp, so a re-blessing re-mints an id the
tombstone already refuses and idempotence rides identity.

Then two independent reviews read the landed work — one at the code, one at the rails. Eleven confirmed
findings, all folded; fifteen mutants written, fifteen caught.

## Novel learnings

- **The sharpest hollow rail yet: the concurrency rail passed with the entire lock deleted.** Both legs of
  criterion 14 — the forced adoption-vs-adoption race and the adoption-vs-direct-publish race — stayed green
  with the whole living-name queue removed, because the injected hold sat OUTSIDE the critical section and
  the refusal came from a post-hold re-check that needs no serialization at all. The rail proved the
  re-check, and the re-check is not the lock. The fix is the shape a deleted queue cannot survive: two
  adoptions park past their checks and are released TOGETHER, the bound registrations are COUNTED rather
  than `toBeDefined()`, and a third leg blocks the shared seam and watches both direct publish doors wait on
  it. **Generalization worth keeping: forcing a race is not the same as forcing the race your mechanism is
  the only answer to.** A rail for a lock has to be unsatisfiable by anything cheaper than the lock, and
  "the test is timing-sensitive and passes" is not evidence that timing is what made it pass.
- **When a guard defends a NAME, ask what else the input gets to name.** The root-name guard defends the
  lens name — and a manifest row names its export by an ENTITY the shipper chooses. Ship a definition under
  a fresh program name (so the publish trial, which keys on the program, sees no conflict) at the operator's
  own `hyperschema:Plant` with a timestamp past any clock, and blessing an innocent-looking lens lands
  operator-signed bytes that win latest-wins at the operator's own definition entity: the operator's own
  reads now gather through a stranger's term. The lower-timestamp mirror is H7 — the blessing persists, the
  publish reports bound (it checks `(entity, lens)`, never the body), and the provenance describes law the
  store did not bind. Both halves are shut by an entity-capture refusal plus a post-append check that the
  address BOUND is the address CLASSIFIED. Nothing in the tree defended this before, and no rail could have
  found it from the spec, because the spec's guard was about names.
- **A rail can bind the FIX and still not bind the BEHAVIOR, and mutation testing cannot see the
  difference.** A rail-adequacy lens found four assertions one step from vacuous sitting behind rails that
  genuinely failed on the pre-fix code: criterion 2's named method ("diff the two grounds delta-for-delta
  modulo timestamps") was a count and a timestamp set, so a blessing could drop the module's `writable` in
  silence; criterion 24's `>= 400` conflated 405 read-only with 403 no-standing, so a blessing that stripped
  the whole write surface passed; criterion 6's identity assertion degenerated to `expect([]).toEqual([])`
  if inheritance ever stopped; and criterion 22's collider sorted FIRST, so "refuses the whole call" was
  indistinguishable from "refuses at the first row". Mutation is blind to all four — the mutants die, because
  the fixture never reaches the claim. The lens that finds them is the one asking *what would still pass?*
  rather than *what breaks?*
- **The spec's letter can be impossible, and the honest move is to say so in the spec.** T31 wrote
  "`supersede` OUTRANKS; it never negates." It cannot: a blessing inherits the source's older timestamp and
  therefore cannot win on recency. `supersede` carries a negation of the incumbent on the blessing itself,
  which meets the contract T31 actually wanted — reversible, non-destructive, prior law still present — and
  has two consequences a reader is owed: a narrowing edge admitting the incumbent now ships the blessed
  registration with it, and §17's version door reads the retired incumbent as WITHDRAWN, so the operator's
  own live hash answers 410 with no §14 act. Both are written into §27.8 rather than into a comment. The
  alternative shape (the strike on its own delta) costs a two-act undo in which forgetting the second act
  leaves your own law retired while you believe you restored it.
- **`freeze` closes over negations author-blind, on purpose — so "in the members" means only "somebody
  struck this".** `survivalOver` read every author's strike as the module's own word, which let a hostile
  co-tenant REFUSE a lawful blessing and a foreign negation-of-the-negation REVIVE law its author withdrew.
  A strike binds a member only when the member's own author signed it, and the scoping had to reach the
  OPERAND SET as well, because rhizomatic's bootstrap opens `mask policy: "drop"` author-blind one layer
  down. H1 has a fifth site and this is it.
- **`lawFrom` went blind exactly when it mattered, and the tell was a safe-sounding word.** A row its author
  retracted upstream is still BOUND here and still serving — and classifying it for survival made it
  unclassifiable, so the query answered "not exposed" at the one moment the honest answer is "yes, and the
  author withdrew it". Exposure and survival are now two readings of one classifier. Worth generalizing:
  when a query's failure mode is to answer the reassuring thing, the failure is not a bug in the answer, it
  is a missing distinction in the question.
- **`promotionRefusal` was reading half the namespace.** It checked reserved CONTEXTS, and a hyperschema or
  Schema definition wears the reserved namespace only in its ROLES — its pointers sit at a neutral
  `definition` context. So the gather program every read resolves through could cross by promote-outputs,
  past every §24.4 guard. A reserved namespace is only as reserved as the places you look for it.
- **eslint had been linting six agent worktrees, so a green run reported 2973 findings about copies of
  itself.** git ignores the per-ticket worktrees; eslint did not, and the real bar was unreadable
  underneath. Fixed in this commit (`eslint.config.js` ignores them). The class is worth naming: **an
  ignore file is per-tool, and a bar nobody can read is a red bar nobody can see** — the same shape as the
  stale-pin and silent-spawn failures `journal/2026-07-22-the-init-that-never-ran.md` records.

Gate evidence: p1–p4 green under T33 (26 criteria from `.adlc/specs/27-trust-on-load.md`, each naming its
rail; 36 rails in `test/gateway/adopt-law.test.ts`; the frozen `test/gateway/promotion.test.ts` unmoved —
that immobility IS criterion 23). One gap named in the rail header rather than implied: §28.1's effectiveness
attenuation is unbuilt, so a wall shares the host's operator and a stranger's renderer is inert THERE too;
criterion 7 asserts the 404 that is true. Residual carried forward as **T89** — law resolution has no Policy,
so the root-name guard is a fail-fast door and federation has no door. Myk's merge (P6): a capability surface
and a vocabulary mint.
