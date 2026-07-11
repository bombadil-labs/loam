# Current work

_The live checklist. Empty means nothing is queued — the resume protocol (see `CLAUDE.md`) is
then to ask Myk what to build next, and open it here at cycle stage 1._

**Nothing in flight (2026-07-11).** The v1 build (steps 0–9) and the Reader's Republic demo arc
(Units 1–3c + demo item 7, "grow an app live") are complete and merged — the JOURNAL is their
record, and `_testing/README.md`'s ledger maps each demo beat to its machinery. The demo script
and pitch spine live in that ledger and in SPEC §13.

**The road to shipping (designed; the near-term arc).** SPEC §15 (the browser peer) + §16 (the
interactive tutorial) are the plan for the public launch: a full store in the page, and a
GitHub Pages site that teaches Loam by growing one, ending in `npm i -g @bombadil/loam` +
`loam pull` to carry the store to the learner's machine. Three sprints, in order:

1. **The browser store (SPEC §15).** `src/store/local-storage.ts` (`LocalStorageBackend`,
   one key per delta, quota→degradation; contract-tested via an injectable `Storage` shim —
   no jsdom; reuse `canonicalDelta` + `MemoryBackend`'s batch-first atomicity),
   `src/browser/index.ts` (the curated barrel), a second esbuild entry + `"./browser"` export,
   `test/browser/bundle.test.ts` (zero `node:` + boots genesis→register→claim→query).
2. **Continuity (SPEC §15).** `exportOffer(gateway)` in the browser barrel (byte-compatible
   with the served `/federate` body), `loam pull <url|file>` in `src/cli/cli.ts` (boot/close
   discipline from `cmdRegister`), `test/cli/pull.test.ts` (same-operator law-binds;
   foreign law-inert; tombstone refused; URL idempotency; the round-trip `_hex` match).
3. **The tutorial (SPEC §16).** `site/` + the packets generator + `scripts/build-site.mjs` +
   `.github/workflows/pages.yml` + `test/site/arc.test.ts`, lesson by lesson over the two-store
   media+circle domain. Stands alone — cold-apprehensible copy is the acceptance bar.

**Other designed candidates (not on the ship path):**

- **Write semantics — policy-informed mutation (SPEC §14).** Make writing the dual of reading;
  clearing = retraction → absence; fixes the silent null-drop bug. Pure Loam except the deferred
  first-class-null-value question (a rhizomatic `Primitive` change).
- **As-of replay** — a timestamp mask on the gather → scrub history like a replay. Substrate-ready.
- **Hosted `StoreBackend` (libSQL/Turso)** — a persistent URL, not localhost.
- **Renderer-generation for grown stores** — grow a *view* for a novel schema, not just data.

Next sprint: sprint 1 above (the browser store) unless Myk redirects.
