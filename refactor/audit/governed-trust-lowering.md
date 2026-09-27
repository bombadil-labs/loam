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

1. `governedStrikers(input, now, operator, adminsOnly, userGround)` returns a sorted key list. It
   replaces `dataStrikers`. It evaluates `lawfulGrantsTermJson` over the grants in the input and
   their negation closure (H1), then maps each subject through `subjectKeyAt`.
2. `lowerGovernedTrust(term, input, now, ctx)` walks the Term. It finds each `inView` whose `term` is
   byte-equal to `lawfulGrantsTermJson(X, flag)` for some operator `X`, with field `author` and
   extract role `subject`. It replaces that `inView` with `match author inSet governedStrikers(...)`
   for `X` and `flag`. Recognition is by exact structure, not by a marker. Every other node stays.
   A body that names an operator other than the ground's own lowers with that body's own `X`.
3. `dataStruck` and `dataStrikeWitnesses` read `governedStrikers` directly. The comment about "two
   derivations of one rule" goes away: there is one derivation.

A memo keys the striker list by input identity and size, `now`, operator, flag, and the user
ground's size. One read computes it once.

## The sites

Every site in this list takes the lowerer. The rails below hold each one.

| site | today | change |
|---|---|---|
| `lifecycle.ts` `registerImpl`, `rebindImpl`, `replayRegistrationsImpl`, `matForImpl` | `reactor.register(name, body, roots, now, registry)` | pass `lowerTerm`. It runs on each refresh, `advanceTime` included |
| `lifecycle.ts` `assertTemplatesVisible`, `assertMaterializable` | trial `evalTermRaw` | lower first, so the trial runs the program that the reads run |
| `reads.ts` gather: bound, channel pool, as-of, cold | `evalTerm` / `reactor.eval` | lower first, with the input that is evaluated |
| `reads.ts` `gatherForRetractionImpl`, `resolvePinnedImpl`, subscribe cold path | same | lower first |
| `ingest.ts` `selectImpl`, `watchImpl` (listing membership) | `evalTermRaw` | lower first |
| `listing.ts` membership declaration and its `JSON.stringify` compare | holds the mask | NOT lowered. The declaration stays stable, so a read writes nothing (the pulse law) |
| `listing.ts` `trustFeeder` invalidation | grants and arrivals | also a user-ground root change |
| `erase.ts` audit gather | `evalTerm(mask(trust ...))` | lower first |
| `slate.ts`, `server/admin-federation.ts`, `federation/translate.ts`, `adopt.ts` | `dataStruck` / membership eval | through `governedStrikers` or the lowerer |

The signed hyperschema bytes, `termCanonicalHex`, `termHash`, `groupPrograms`, `boundKey`,
`schemaLawAddress` and `bodyHash` all see the unlowered body. Nothing that hashes or signs sees a
lowered one.

## When the answer moves without an ingest here

The striker list depends on two grounds: the input (the grants) and the user ground (root claims).
A pool reads its users from its host. So a pool's answer can move in three ways that its own
reactor does not see:

1. The host ingests a new root claim for a granted user.
2. A root claim's `validFrom` or `validUntil` passes in the host.
3. The operator strikes a root claim in the host.

The host already arms a timer on its own validity boundaries (`armValidityTimer`), and it already
sees its own ingests. The change: a Gateway that reads users from a host registers as a dependent.
When the host ingests a delta at a `user:*` entity in context `loam.root`, or crosses a boundary of
such a claim, it notifies each dependent. The dependent refreshes its materializations and its
listing index at the new `now`. On the host itself, a root-claim ingest already refreshes a governed
materialization, because a reflective body is broad-dispatch.

Question for Sol: rhizomatic has no public "refresh every materialization" call. The options are
(a) the dependent re-registers through its reseat path, or (b) a small rhizomatic API, for example
`reactor.refreshAll(now)`. We lean (a) for now, because it needs no substrate change.

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
  governed read honors the strike. After a re-point in the host, the pool's subscription gets a new
  frame. The rail awaits that frame, and does not race `setImmediate`.
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

Every rail runs on the base tree first (`rails-red`). R1 and R9 are controls, and they pass on the
base. They say so in their text.

## Order

1. PR A: `governedStrikers`, the lowerer, and all sites. R1, R2, R7, R8, R9, R10. The grants in R2
   are written by the test, because no writer names a user yet.
2. PR B: the dependent notification, for pools and boundaries. R5, R6.
3. PR C: the writers switch (the parked diff). R3, R4, R11, and the owed 3d rails.
