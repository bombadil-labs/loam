# Current work — Sprint 1: the browser store (SPEC §15)

_Cycle stage: 5 (review). Branch: `browser-store`._

**Success criteria.** A complete Loam boots in a page: `LocalStorageBackend` keeps the
`StoreBackend` contract over an injectable `Storage`, `@bombadil/loam/browser` is a curated
barrel shipped as a self-contained browser ESM bundle (zero `node:` specifiers) that BOOTS —
genesis → register → claim → query — entirely inside the artifact.

## Checklist

- [x] **Tests first** — contract harness (localStorage over `MemStorage` shim), driver-edge
      suite (key layout, quota atomicity, seed key, foreign keys, corruption), browser bundle
      boot suite, pack surface extended with `"./browser"`.
- [x] **Implement** — `src/store/local-storage.ts`, `src/browser/index.ts`,
      `scripts/build-bundles.mjs` (replaces build-client.mjs; per-entry args so parallel test
      workers never race), `"./browser"` export, root barrel exports `LocalStorageBackend`.
      **Learnings en route:** (a) `gateway/erase.ts` imported `node:crypto` — now
      `@noble/hashes` (direct dep; hash parity verified), so the whole law bundles for the
      page; (b) that file carried a RAW NUL BYTE in the `sealCommitment` template literal,
      making it invisible to grep/ripgrep — now the `backslash-u0000` escape, same bytes hashed;
      (c) graphql v17 carries a guarded `getBuiltinModule("node:diagnostics_channel")` probe —
      a runtime feature-detection, not a specifier; the bundle test allows exactly that;
      (d) the browser barrel must also carry `parseTerm` / `parsePolicy` / `signClaims` —
      without them a page could hold a schema but never say one.
- [x] **Green** — `npm run check`: 31 files, 391 tests, all counts read.
- [ ] **PR** — branch `browser-store`, open PR, one careful review agent, resolve, merge.
- [ ] **Journal** — append the record.
- [ ] **Village** — a browser-store act in `_testing/` (boot a store on a shimmed localStorage,
      federate it with the village no-HTTP via direct `federate(offeredDeltas())`), ledger updated.
- [ ] **Re-plan** — reread SPEC §15/§16 against learnings; open sprint 2 (continuity / `loam pull`).

**Left off here:** plan written; about to write the tests.
