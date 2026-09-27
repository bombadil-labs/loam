# Governed trust with user-named grants (step 5, PR 3d-ii)

Status: design, for Sol's review. No writer names a user in a grant until this lands.

## The problem

A governed read honors a data strike only from a trusted author: the operator, or the subject of a
surviving operator grant. `lawfulStrikersJson(operator, adminsOnly)` (`src/gateway/accounts.ts`)
says this in the Term language:

```
or[ author == operator,
    inView{ term: operator's surviving grants, field: author, extract: {role: "subject"} } ]
```

The `inView` reflects the grant's subject STRING. PR 3d-i lets a grant name `user:<name>`, and the
door resolves that name to the user's current root. The `inView` cannot do this. It would put the
string `user:alice` into the author set, and alice's key would lose its trust. If 3d-ii switches the
writers now, alice's strikes stop counting in every governed read. They still count at the door.

The Term language has no join, so no Term can say "the root of the user this grant names". Sol and
Claude chose option (b): Loam lowers the predicate at the read time. The signed body stays as it is.

## The rule (ruling 8, M5)

The trusted strikers at `now` over an input set are:

- the operator;
- for each operator grant that survives in the input (the `lawfulGrantsTermJson` selection,
  unchanged), the key its subject names at `now`: a key names itself, and `user:<name>` names
  `subjectKeyAt(...)`, which is the user's current root, read from the user ground.

A user's root counts. A key that acts for the root by delegation does not count. A connection's own
strike on data is therefore inert. A user with no readable root adds nobody.

Recovery (3e) may widen this to the keys the new root binds (`associatedKeys`). That is a separate
decision for 3e, and this design does not make it.

## One computation, one lowerer

1. `governedStrikers(input, at, operator, adminsOnly, users, mode)` returns a sorted key list: the
   operator, plus the key or keys each surviving grant's subject names. It replaces `dataStrikers`.
   It evaluates `lawfulGrantsTermJson` over the grants in the input and their negation closure
   (H1), then maps each subject:
   - A subject that is a key names itself.
   - `user:<name>` in **present mode** names `userRootAt(users, at, ...)`: the one current root.
   - `user:<name>` in **raw mode** names every root key the user ground's raw read gives (below).
2. `lowerGovernedTrust(term, input, at, ctx)` walks the Term. It replaces each WHOLE trust
   predicate that is structurally `lawfulStrikersJson(X, flag)` with
   `match author inSet governedStrikers(..., X, flag, ...)`. It never replaces the `inView` leaf
   alone: the strikers include the operator, and the leaf does not.
3. `dataStruck` and `dataStrikeWitnesses` read `governedStrikers` directly. There is one
   derivation.

### Recognition

The lowerer parses each trust predicate and compares it with the parsed canonical form of
`lawfulStrikersJson(X, flag)` for the `X` and `flag` it names. A node that matches is lowered.

A near miss fails closed. A near miss is a `mask` trust policy that carries an `inView` whose
`term` names `CTX_GRANTS`, or whose extract role is `subject`, but that is not an exact match. The
check looks only at trust policies. An `inView` elsewhere is legal and stays as it is. The lowerer throws with a
message that names the body. It does not evaluate the near miss unlowered: that would reflect
`user:` strings as authors.

The lowerer also lowers every evaluation body in the registry that it passes on, as
`lowerPrincipalRegistry` does with `mapEvaluationBodies`. The `lowerTerm` hook returns the lowered
term and the lowered registry, so a body the term references by name or hash is lowered too.
Pinned hash keys stay those of the signed bodies.

### Present mode and raw mode

`evalTerm` sites evaluate at `now`. Validity and negations apply there. They take present mode.

`evalTermRaw` sites run select, watch, freeze, trial and audit machinery. There, a raw `inView`
sees grants that are expired or not yet valid. These sites take raw mode:

- The grants come from `evalTermRaw` of `lawfulGrantsTermJson`, exactly as the raw `inView` sees
  them today.
- A user subject expands to every key named by an operator-signed root claim for that user, read
  with the same raw posture: validity is ignored, and the raw operator mask applies. The user
  claim must name the user.

So raw mode never narrows what the raw machinery trusts today for a key-named grant. The raw
expansion of a user is a superset of the root at any one instant.

### The user ground is an explicit input

The lowerer does not read "the host" by itself. The caller passes the user ground:

- A present read passes the live user ground (the host for a pool).
- An as-of read passes the matching as-of slice of that ground: deltas signed by `asOf`, read with
  validity at `asOf`. That is the same cut `asOfGroundImpl` makes for the input.
- A pool's as-of read cuts its host's ground at the same `asOf`.

### No memo across evaluations

The striker list is memoized for one evaluation only, and a new evaluation computes it again. A
memo keyed by size can survive a same-size reseat or erasure and serve a stale root. If a
measurement later shows cost, the key will be an explicit revision of the grant and user grounds,
not a size.

## The sites

Every site in this list takes the lowerer. The rails below hold each one.

| site | mode | change |
|---|---|---|
| `lifecycle.ts` `registerImpl`, `rebindImpl`, `replayRegistrationsImpl`, `matForImpl` | present | pass `lowerTerm`, with the registry. It runs on each refresh, `advanceTime` included |
| `lifecycle.ts` `assertTemplatesVisible`, `assertMaterializable` | raw | lower first, so the trial runs the program the reads run |
| `reads.ts` gather: bound, channel pool, cold | present | lower first, with the evaluated input |
| `reads.ts` gather as-of | present at `asOf` | lower first, with the as-of user slice |
| `reads.ts` `gatherForRetractionImpl`, `resolvePinnedImpl`, subscribe cold path | present | lower first |
| `ingest.ts` `selectImpl`, `watchImpl` (listing membership) | raw | lower first |
| `listing.ts` membership declaration and its `JSON.stringify` compare | none | NOT lowered. The declaration stays stable, so a read writes nothing (the pulse law) |
| `listing.ts` `trustFeeder` invalidation | none | also invalidates on a user-ground change |
| `erase.ts` audit gather | as the site evaluates | lower first |
| `slate.ts`, `server/admin-federation.ts`, `federation/translate.ts`, `adopt.ts` | as each evaluates | through `governedStrikers` or the lowerer |

The signed hyperschema bytes, `termCanonicalHex`, `termHash`, `groupPrograms`, `boundKey`,
`schemaLawAddress` and `bodyHash` all see the unlowered body. Nothing that hashes or signs sees a
lowered one.

## When the answer moves without an ingest here

The striker list depends on two grounds: the input (the grants) and the user ground. A pool reads
its users from its host. The host-side dependency is wide: `loam.user` and `loam.root` claims, the
negations and counter-negations of either, erasure, and every validity boundary in those chains.

The first implementation does not try to be narrow. A Gateway that reads users from a host
registers as a dependent. The host notifies each dependent on EVERY accepted ingest and on EVERY
validity boundary it crosses. The dependent then refreshes its current materializations at the new
`now`, and it invalidates its listing index.

The refresh must keep subscribers. Reseat ends subscriptions. Rebind registers a new generation,
and the subscribed materializations stay behind. Neither gives R5's frame to an existing
subscriber. So the dependent calls a rhizomatic `Reactor.refreshAll(now)` (the name is Sol's
call). It refreshes every current materialization and emits the normal change events. PR B waits
on a rhizomatic prerelease with that call.

On the host itself, a root-claim ingest already refreshes a governed materialization, because a
reflective body is broad-dispatch. A root-claim boundary is a host boundary, so `advanceTime`
refreshes it too.

## Writers (the parked 3d-ii diff)

When this lowerer is on main and its rails are green, the writers switch:

- `provision.ts`, CLI `user create` and `assign-role`, and bind (`ownerName`) name `user:<name>`.
- `remove-role` strikes the user-named admin grant.
- A writer names the user only if the user's root resolves when it writes. If not, it names the key,
  as today. This covers the 3d no-root fallback.

## Rails

Each rail asserts at both levels: the deltas in the store, and what a governed View or a door
serves. Each erasure-adjacent rail is two-sided: a named bystander survives.

- **R1 parity.** In a store where every grant names a key, the lowered body and the unlowered body
  give the same View, the same listing and the same `dataStruck`. The fixtures are those of
  `test/gateway/data-struck-parity.test.ts`, run from a new file.
- **R2 user-named trust.** A grant names `user:alice`. Alice's root strikes a value, and the
  governed View drops it. A stranger's strike on a second value is inert, and that value stays.
- **R3 re-point.** The operator re-points alice from K1 to K2. K2's strike now counts. A new strike
  by K1 does not.
- **R4 connection strike (M5).** Alice's connection has a delegation for its inbox. Its strike on
  data in that inbox is inert. Alice's root strike on the same value counts.
- **R5 pool.** The grant and the strike are in a pool. The root claim is in the host. The pool's
  governed read honors the strike. After a re-point in the host, an EXISTING subscriber to the
  pool's materialization gets a new frame. The rail awaits that frame, and does not race
  `setImmediate`.
- **R6 boundary.** A root claim starts in the future. Before the boundary, the new root's strike is
  inert. After it, the strike counts with no ingest, in the host and in a pool.
- **R7 listing agrees with the point read.** An entity that alice's root struck is absent from the
  listing and from the point read. An entity that a stranger struck is present in both.
- **R8 erasure audit agrees** with the governed read under a user-named grant.
- **R9 identity.** The signed hyperschema bytes and hash do not change. A listing read writes no
  container re-declaration.
- **R10 one derivation.** `dataStruck` equals the lowered read for R2 to R6.
- **R11 no root.** A grant names a user with no root. It adds no striker. The writer falls back to
  the key.
- **R12 whole predicate.** The lowered body contains no `inView` over grants, and the operator's
  own strike still counts. A body that carries the leaf outside the expected `or` throws.
- **R13 near miss.** A trust predicate that differs from the canonical form in one field (the
  extract role, the verb, the context) throws when it is lowered. It is never evaluated unlowered.
- **R14 raw control.** An expired key-named grant's subject is in the raw striker set, before and
  after lowering. A select or watch over raw input gives the same candidates both ways.
- **R15 as-of.** At `asOf`, alice's root is K1. After `asOf`, the operator re-points her to K2. An
  as-of read at `asOf` honors K1's strike and not K2's. A present read honors K2's and not K1's.
- **R16 no stale memo.** Erase a root claim, then write a new one, so the ground keeps its size.
  The next read uses the new root.
- **R17 registry body.** A body that references, by name, a schema carrying the predicate is
  lowered through the registry. A user-named grantee's strike counts in it.

Every rail runs on the base tree first (`rails-red`). R1, R9 and R14 are controls, and they pass on
the base. They say so in their text.

## Order

1. PR A: `governedStrikers` in both modes, the lowerer, the registry lowering, and all sites. R1,
   R2, R7 to R10, R12 to R17. The grants in these rails are written by the test, because no writer
   names a user yet.
2. PR B: the dependent notification and `refreshAll`, for pools and boundaries. R5, R6. It waits
   on a rhizomatic prerelease.
3. PR C: the writers switch (the parked diff). R3, R4, R11, and the owed 3d rails.
