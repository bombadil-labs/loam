## 2026-07-11 — Sprint 1 of the ship path: the browser store (PR #51, SPEC §15)

A complete Loam now boots in a page. `@bombadil/loam/browser` is the curated barrel — the whole
`Gateway`, genesis, the claim constructors and readers, federation, the `Runner`, `mintSeed` —
shipped exactly as `./client` is: one self-contained browser-safe ESM bundle, zero `node:`
specifiers, pinned by a bundle test that does not merely import but BOOTS: genesis → register →
claim → query inside the artifact, then a second boot from the same origin that remembers
everything. `LocalStorageBackend` is the sixth interchangeable witness to the store contract —
one key per delta (`loam:<store>:<id>`, canonical wire JSON value, so an export never launders
provenance), quota as an atomic all-or-nothing refusal that latches the gateway's degradation,
reads that recompute every id and verify every signature, the seed key structurally outside the
delta set. Contract-tested over an injectable `Storage` shim — no jsdom anywhere.

Learnings worth keeping: (1) `gateway/erase.ts` was the one place the LAW spoke `node:` —
`createHash` for `sealCommitment` — and the swap to `@noble/hashes` (already in the tree under
rhizomatic; parity verified byte-for-byte before the change) is what let the whole law bundle.
(2) That same file carried a RAW NUL BYTE as the commitment preimage separator, which made
grep/ripgrep classify it as binary and silently skip it — that is exactly how the `node:crypto`
import survived an earlier sweep. The byte is now its escape sequence: identical bytes hashed,
greppable source. Standing lesson: a source file that search tools cannot see is a hazard
independent of what it says. (3) graphql v17 ships a guarded
`process.getBuiltinModule("node:diagnostics_channel")` probe — runtime feature detection, not a
specifier; the bundle test exempts exactly that call and nothing else. (4) The §15 export list
was missing the substrate primitives that make it SPEAKABLE — `parseTerm`, `parsePolicy`,
`signClaims` — a page could have held a schema but never said one; the barrel carries them, and
§15's surface paragraph should be read with that addendum. (5) The review earned its budget:
a store name containing `:` could brick a sibling store's reads (now refused at birth), and the
two compositions §15 actually claims — quota reaching the GATEWAY's latch, erasure reaching the
origin's keys — were untested until asked for.
