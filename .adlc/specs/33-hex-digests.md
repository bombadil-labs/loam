# §17 correction — `_hex` and `_hviewHex` become digests of the canonical bytes (T107)

## The problem

`_hex` and `_hviewHex` are today the canonical CBOR bytes themselves, hex-encoded
(`viewCanonicalHex` / `hviewCanonicalHex`): 2 hex chars per byte of the answer. `_hex` grows
linearly with the resolved view; `_hviewHex` grows with the ENTIRE gathered bucket — a
million-delta hyperview is the million deltas, in hex, per request. And because the bytes are
the value, `_hex` re-discloses every resolved field legibly, which forecloses ever serving a
projection.

## The decision (Myk, on T107 — option (a))

Both fields become fixed-size digests of the same canonical bytes: `contentAddress(bytes)`,
rhizomatic's own content-address form — `1e20` multihash prefix + blake3-256, **68 hex chars**,
exactly the form of a delta id. (The ticket wrote "64 hex chars"; that counted the bare digest
and dropped the 4-char multihash prefix that every delta id carries. The self-describing form
wins: one address vocabulary across the whole store.) Digest equality ⇔ byte equality, so every
equality consumer keeps its semantics by construction. rhizomatic is frozen and needs no change:
`contentAddress` is already exported, and the bytes come back out of the canonical hex.

The producers are exactly three, all in `src/gateway/reads.ts` (`resolvedNodeImpl`,
`resolvePinnedImpl`, `watchEntityImpl`); every other `_hex`/`_hviewHex`/`_fromHex`/`n.hex`
surface (GraphQL, REST, SSE frames, the renderer floor, pinned views) carries `node.hex`
downstream and moves with them.

**Internal identity is untouched.** Loam has no internal consumer of the canonical hex: resolver
memo keys are built from delta ids, materialization hexes (`change.newHex`, the `inputHex` that
`derivedClaims` records at rest in `rhizomatic.derived.from`) are computed inside frozen
rhizomatic's reactor and never touched by Loam's surface. Derived delta ids for identical inputs
are byte-identical before and after this change — no re-derivation, no migration (§20 does not
apply: `_hex`/`_hviewHex` are computed at read time and never at rest).

## Acceptance criteria

- (a) `_hex` is `contentAddress` of the resolved view's canonical CBOR bytes: fixed-width
  (`/^1e20[0-9a-f]{64}$/`), and equal to a digest recomputed independently from
  `viewCanonicalHex` in the test. Verified by `test/gateway/hex-digest.test.ts`.
- (b) `_hviewHex` is `contentAddress` of the gathered hyperview's canonical CBOR bytes, same
  fixed-width form, and shared by two lenses over one body while their `_hex` differ. Verified by
  `test/gateway/hex-digest.test.ts`.
- (c) Digest stability across arrival orders: the same deltas ingested in different orders
  answer identical `_hex` and `_hviewHex`. Verified by `test/gateway/hex-digest.test.ts`.
- (d) Live frames carry fixed-width hashes: a subscription's initial `_hex` and a patch's
  `_fromHex`/`_hex` all match `/^1e20[0-9a-f]{64}$/` and chain (`_fromHex` = the prior `_hex`).
  Verified by `test/gateway/hex-digest.test.ts`.
- (e) THE LEAK IS CLOSED, as an assertable absence: for a view holding a distinctive string
  value, neither `_hex` nor `_hviewHex` contains the hex encoding of that string (the old
  encoding provably did — the rail asserts that too, against `viewCanonicalHex` directly, so the
  absence cannot pass vacuously). Verified by `test/gateway/hex-digest.test.ts`.
- (f) Every existing `_hex`-equality consumer passes UNCHANGED: `test/site/arc.test.ts`,
  `test/gateway/claims.test.ts`, `test/surface/rest.test.ts`, `test/gateway/read.test.ts`,
  `test/gateway/subscribe.test.ts` carry no diff in this change. Verified by
  `git diff --name-only main -- test/site/arc.test.ts test/gateway/claims.test.ts test/surface/rest.test.ts test/gateway/read.test.ts test/gateway/subscribe.test.ts` answering empty, and `npm run check` green.
- (g) Derivation identity is untouched: no Loam source calls `derivedClaims` or feeds a
  surface hex into derivation provenance. Verified by
  `grep -rn "derivedClaims\|newHex" src/ --include=*.ts` answering no sites, and the runner
  suite green under `npm run check`.
