# Current work — §21–§23 design stage: from open questions to concrete requirements

_Set up 2026-07-12, late (Myk). SPEC §14 landed and merged
([#73](https://github.com/bombadil-labs/loam/pull/73)); the backlog re-plan is merged
([#74](https://github.com/bombadil-labs/loam/pull/74)); the schema-identity probe that reordered
the arc is committed to main. Work from TODO.md. The remaining-§14-verbs amendment is done; that
item is Myk-decision-gated, not in flight._

## The step

This is a **design step, not a build step**. Take TODO.md's three reserved sections — **§21
schema identity & versioning**, **§22 custom resolvers**, **§23 renderers** — and drive them from
"musings + open questions" to **locked, concrete requirements**, edited in place in TODO.md. No
implementation code. The output is three TODO items a build step could open against without
re-deciding anything.

**§21 goes first and gates the others** (Myk, 2026-07-12): resolvers and renderers both need a
schema identity that can be named, multiplied, and pinned — today's registration model
(1:1:1 hyperschema : Schema : roots, latest-wins replacement) gives them none of the three. The
ladder to design against: HyperSchema —many→ Schema —many→ VersionedSchema —many→ API.

## Success criteria

- **§21's six design questions answered or explicitly deferred-with-reason** — Schema as
  first-class entity vs inline carrier; what a VersionedSchema is at rest; unlocking the
  many-to-many (registration keying + surface naming); where roots sit on the ladder (probe
  says: liveness declaration → binding layer, not Schema); the schema/hyperschema naming pass
  (on-wire renames ship §20 migrations); how §22/§23 stand on the ladder.
- **§22's seven open questions answered or explicitly deferred-with-reason.** (Override-vs-
  replacement and naming; the DerivedFn relation — load-bearing because of rung (e) synthetics;
  which purity rungs v1 admits and whether the rung is signed at rest; what a resolver IS at
  rest; the `writable` interaction; the caching/invalidation contract per rung;
  resolver-in-the-lens-identity — which is §21's VersionedSchema question from the other side.)
  Answers become requirements, not essays.
- **§23's design questions get the same treatment**, in dependency order — the host contract
  first (it anchors everything), then artifact/signing (inherited from §22's answer), push-time
  verification relation, §17 versioning (now standing on §21's VersionedSchema), trust/
  sandboxing, router discipline.
- **Decisions that are Myk's are surfaced as a short numbered decision list**, each with a
  recommendation and its cost — not buried in prose. Known ones going in: Schema-as-entity vs
  registration-as-carrier; what names a lens; which purity rungs v1 admits; whether effectful/
  synthetic resolvers are v1 at all; the DerivedFn conversation (a rhizomatic conversation —
  prepare the question, don't answer it unilaterally); how hot the trust posture for executable
  deltas runs.
- **The result still lives in TODO.md** — SPEC.md grows only by a landing PR. When the build
  steps later land, the same-PR migration rule applies as always.
- Gate green (docs-only, but the gate is the gate), PR opened, journal entry appended. Myk names
  merges.

## Sub-tasks

1. [ ] Re-read SPEC §13, §14, §17, §20 and the registration internals (`registration.ts`,
   `gateway.ts` `matFor`/`gather`) plus rhizomatic's Schema/Policy/DerivedFn surface — the
   answers must sit on what IS, not on memory.
2. [ ] §21: answer the six questions in place; rewrite the item as requirements + Myk's decision
   list. This is the load-bearing one — take the time.
3. [ ] §22: answer the seven questions, riding §21's ladder.
4. [ ] §23: same, in dependency order, inheriting §21's identity story and §22's artifact/signing
   doctrine.
5. [ ] Journal + PR; update memory `renderer-task` if the shape changes.

_Left off: nothing yet — this file IS the starting line for tomorrow._
