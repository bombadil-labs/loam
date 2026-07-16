## 2026-07-13 — The ADLC migration: TODO/CURRENT_WORK retire, the backlog becomes tickets, SPEC.md splits into a folder

We moved off the bespoke workflow (TODO.md + CURRENT_WORK.md hand-tracked state, the nine-step
loop) onto **ADLC** — the same lifecycle the fleet runs. Three changes, one branch
(`chore/adlc-bootstrap`, which had already wired the `.adlc/` runtime + ignore rules):

1. **The backlog ingested into tickets.** TODO.md's seven reserved sections became seven schema-
   valid ADLC tickets in `.adlc/tickets.json` — T1 (§14 amendment), T2 (§21), T3 (§22), T4 (§23),
   T5 (§24), T6 (hardening), T7 (as-of) — the dependency spine encoded as `edges`, each body
   carrying the section's full argumentation because the tickets are now the sole record. TODO.md
   and CURRENT_WORK.md were then dropped (their state lives in the tickets and the gate evidence).
   `merge-forecast` validates the DAG. CLAUDE.md was rewritten around the ADLC phases (P0 ticket →
   P1 design-stage → P3 rails/tests-first → P4 build → P5 prosecute → P6 human gate + landing),
   keeping every craft rule (honest tests, review budget/framing, the audit-pause retro, the
   village practice, vocabulary, migration discipline).

2. **rhizomatic 0.4.0 noted on T4.** 0.4.0 is imminent and lands the additive `bytes` target kind
   (rhizomatic#7). T4 (§23 renderers) now records that the store-small-assets-as-deltas capability
   WAITS for 0.4.0 — while the rest of the renderer design (host contract, router, trust, versioning)
   proceeds, since v1 resolvers and the renderer code bundle are text ESM and only binary assets
   (images, fonts) need the new kind.

3. **SPEC.md split into `spec/`.** The monolith became twenty `spec/NN-slug.md` files (content
   verified byte-identical, whitespace-insensitive), with SPEC.md kept as the index (preamble +
   section table). The law is now: **a landing adds a new `spec/` file** (its whole section +
   provenance footer) plus one index row; editing an existing section file is the rare exception.
   All cross-references are prose "§N" (zero anchor links in the repo), so nothing broke; §N
   resolves via the index. The design tickets' `scope` now points each at its own spec file.

Learning — the honest correction on "why width 1." Merge-forecast still forecasts
`recommendedWidth: 1` for this arc, and the split did NOT change that. Earlier I'd attributed the
serialization to the SPEC.md monolith alone; wrong. This backlog also has genuine *code* overlap
(T1 and T2 both touch `src/gateway/registration.ts` + `src/migrate/`; T6 and T7 both touch
`src/**`) and the dependency spine already serializes T2→T3→T4→T5. The monolithic spec was a real
*additional* coupling but not the *binding* one here. The split is still the right systemic
move — it removes spec-file contention for all *future* landings that are code-disjoint — it just
doesn't parallelize an arc whose tickets share code. Forecast is advisory (exit 2 = a concurrency
warning, not a malformed DAG); build the arc sequentially, which was always its nature.
