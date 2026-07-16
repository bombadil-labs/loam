## 2026-07-16 — T14: rhizomatic 0.6.0 adopted — the set algebra is whole

The substrate bump §27 was waiting on. `@bombadil/rhizomatic` ^0.5.0 → ^0.6.0 (package.json + lock;
`node_modules/@bombadil/rhizomatic` verified at 0.6.0), purely additive exactly as claimed: no `alg`
bump, no §20 migration, every pre-existing test green untouched. 0.6.0 gives `union` its missing
company — two new dset-sort Term operators, keyed by content-addressed id, nestable to any depth:
`{ op: "difference", of, without }` (asymmetric, of ∖ without) and `{ op: "intersect", left, right }`.
They enter under the fail-closed parse rule: an older witness meets the unknown `op` and rejects at
parse time, loudly.

The proof is a smoke/rail test (test/spike/set-algebra.test.ts, 3 tests) asserting against real
evaluation through Loam's actual substrate surface (JSON `op` profile → `parseTerm` → `evalTerm` over
a two-delta ground): difference leaves exactly the complement, intersect exactly the crossing, and —
the thing the old depth-1 `select(not(inView(...)))` idiom could never do — a difference whose
`without` is itself a difference evaluates correctly. Containers defined relative to one another now
compose. `npm run check` green: 58 files, 611 tests (608 + the 3 new).

The UNRUNNABLE_KEYS question (src/federation/translate.ts:105) answered from 0.6.0's real shape: NO
entry needed. That set guards recognizers, which are Preds run by bare `evalPred`; difference and
intersect are Term operators — bare-evaluable by `evalTerm` like union — and the only door from a
Pred into a Term is `inView`, which the set already refuses at its threshold. (Mechanically they
could never match anyway: in the JSON profile they ride the `op` VALUE, and the key-walk matches
KEYS.) Recorded as a comment on the set.

Two learnings worth keeping. (1) 0.6.0 still restricts `inView.term` to `input | select | union |
mask` — a difference/intersect may NOT ride inside an `inView` predicate; the new algebra composes
at the Term layer, not the Pred layer. The §27 follow-on should design with that boundary in mind.
(2) The village is untouched on purpose: a substrate bump has no user-visible behavior until the
§27 membership/scope-merge work builds on it — that follow-on act is where the operators go on
stage.
