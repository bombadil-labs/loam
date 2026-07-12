# Current work — §21 + §22 design stage: from open questions to concrete requirements

_Set up 2026-07-12, late (Myk). SPEC §14 landed and merged
([#73](https://github.com/bombadil-labs/loam/pull/73)); the backlog re-plan that reframed the next
arc is [#74](https://github.com/bombadil-labs/loam/pull/74) — **merge it first if it is still open**
(Myk has to name the merge), then work from the TODO.md it produces. The remaining-§14-verbs
amendment may still be churning in a parallel session; it is independent of this step — stay out of
its way (don't touch the §14-amendment TODO item or write-path code)._

## The step

This is a **design step, not a build step**. Take TODO.md's two reserved sections — **§21 custom
resolvers** and **§22 renderers** — and drive them from "musings + open questions" to **locked,
concrete requirements**, edited in place in TODO.md. No implementation code. The output is two TODO
items a build step could open against without re-deciding anything.

## Success criteria

- **Every open question in §21 is answered or explicitly deferred-with-reason.** The seven on the
  list (override-vs-replacement and naming; the DerivedFn relation — now load-bearing because of
  rung (e) synthetics; which purity rungs v1 admits and whether the rung is signed at rest; what a
  resolver IS at rest; the `writable` interaction; the caching/invalidation contract per rung;
  resolver-in-the-lens-identity under §17 law). Answers become requirements ("v1 admits rungs
  (a)–(b); the rung is a signed field of the schema definition"), not essays.
- **§22's design questions get the same treatment**, in dependency order — the host contract first
  (it anchors everything), then artifact/signing (inherited from §21's answer), push-time
  verification relation, §17 versioning, trust/sandboxing, router discipline.
- **Decisions that are Myk's are surfaced as a short numbered decision list**, each with a
  recommendation and its cost — not buried in prose. Known ones going in: which purity rungs v1
  admits; whether effectful/synthetic resolvers are v1 at all; the DerivedFn conversation (it is a
  rhizomatic conversation — prepare the question, don't answer it unilaterally); how hot the trust
  posture for executable deltas runs.
- **The result still lives in TODO.md** — SPEC.md grows only by a landing PR. When the build steps
  later land, the same-PR migration rule applies as always.
- Gate green (docs-only, but the gate is the gate), PR opened, journal entry appended. Myk names
  merges.

## Sub-tasks

1. [ ] Merge #74 if Myk has named it / it is still open awaiting him (check first).
2. [ ] Re-read SPEC §13, §14, §17 and rhizomatic's Schema/Policy/DerivedFn surface — the answers
   must sit on what IS, not on memory.
3. [ ] §21: answer the seven questions in place; rewrite the item as requirements + Myk's decision
   list.
4. [ ] §22: same, in dependency order, inheriting §21's artifact/signing doctrine.
5. [ ] Journal + PR; update memory `renderer-task` if the shape changes.

_Left off: nothing yet — this file IS the starting line for tomorrow._
