## 2026-07-12 — Overhaul against rhizomatic 0.3.0: the L5 vocabulary realignment

rhizomatic 0.3.0 landed the rename this repo's [issue #3](https://github.com/bombadil-labs/rhizomatic/issues/3)
proposed, in the **Option B** (full-realignment) form Myk chose: the resolution program is now a
**`Schema`** (was `Policy`) and a single property's rule is a **`Policy`** (was `PropPolicy`),
restoring the symmetry `HyperSchema : HyperView :: Schema : View`. Option B also moved the at-rest
schema-definition wire vocabulary — `rhizomatic.schema.*` → `rhizomatic.hyperschema.*`,
`SCHEMA_SCHEMA` → `HYPER_SCHEMA_SCHEMA`, and the resolve term's program field `"policy"` → `"schema"`.

The Loam side: bump the dep, then an ordered type/API sweep (`Policy`→`Schema`, `PropPolicy`→`Policy`
with the swap done Policy-first so the word-boundary rename can't collide; `parsePolicy`→`parseSchema`,
`policyToJson`→`schemaToJson`), the wire-vocab updates (two hand-referenced role strings in the
tutorial classifier + tests, plus template-literal `${VOCAB_PREFIX}.schema.defines` forms the literal
sweep missed), and regenerating the committed tutorial packets (schema-definition deltas take new
content addresses from the new roles). `MaskPolicy` and the mask term's `"policy"` field were left
untouched — a different, L2 concept the PR explicitly excluded. `npm run check` green, 445 tests.

Verification worth recording: the vocab change is provably semantics-neutral (rhizomatic's own
`eval-resolve.json` vectors are byte-stable across the rename), so resolved Views don't move — only
schema-definition delta addresses do. The tutorial boots clean and registers/resolves live on 0.3.0
(all 16 arc lessons green headless), and the village rebuilds green across **all phases 0-19**. A
pre-existing village failure surfaced along the way (phase17.3/17.4): phase12 files a future-dated
"regret" bio on the commons and erases it only on the almanac (per-instance erasure, §11), so when
phase17's tab pulls the commons and writes its own real-time "waves" bio, a naive PICK-latest
surfaced the future-dated regret. `git diff main` showed phase17's logic unchanged and resolution is
byte-stable, so it failed identically on 0.2.0 — a latent demo timing bug, orthogonal to the vocab
work. Fixed in the same overhaul (Myk routed it back): the commons' current bio is now dated above
the fixture, and the village is green end to end.

Learnings: (1) an ordered word-boundary swap (rename the outgoing name first) avoids the classic
A→B→A collision without a sentinel — `\bPolicy\b`→`Schema` can't touch `PropPolicy`/`MaskPolicy`
because there's no left word-boundary inside them. (2) A literal-string sweep misses template-literal
role construction (`${VOCAB_PREFIX}.schema.defines`); grep the suffixes (`.schema.defines`) as well as
the full prefix. (3) Deferred a cosmetic follow-up: Loam's registration pointer roles still read
`schema`/`policy` (the `policy` role now holds a Schema) — realigning them to `hyperschema`/`schema`
is queued in TODO.md as its own PR because it moves registration-delta content addresses.
