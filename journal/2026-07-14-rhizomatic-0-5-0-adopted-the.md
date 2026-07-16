## 2026-07-14 — rhizomatic 0.5.0 adopted; the unfinished specs revalidated against it

T8 landed (#89): Loam is on rhizomatic 0.5.0 — the loadSchema/publishSchemaClaims → HyperSchema
rename swept clean, the additive `bytes` Target kind falling through Loam's selective checks (byte-
parity federation test), no §20 migration (code-only). Then, at Myk's ask, every unfinished task
spec was revalidated against the 0.4.0/0.5.0 changes:

- **§21 (spec/21 + T2) — VALIDATED, and better-defined.** The design called for a Schema Schema; 0.5.0
  shipped it exactly. spec/21 now cites the concrete primitives: `SCHEMA_SCHEMA` + publishSchemaClaims/
  loadSchema publish and read a resolution `Schema` as its own deltas over `rhizomatic.schema.*`; the
  lens name is `Schema.name`, the version hash is `schemaCanonicalHex(props+default)` with name/alg
  excluded (so `name@hash` is real, and renaming a lens doesn't rev its version). The old "loadSchema
  names the hyperschema — a lag we route around (#10)" note is rewritten: #10 is FIXED in 0.5.0, so
  Loam's own `schema:`→`hyperschema:` entity rename is the only naming work §21 has left. §21 is now
  top of queue and directly buildable.
- **§22 (T3).** The claim "a resolver's content is part of what a VersionedSchema freezes" is now backed
  by `schemaCanonicalHex` (props+default), no new machinery. v1 resolvers stay text ESM.
- **§23 (T4).** The bytes DEPENDENCY (rhizomatic#7) is SATISFIED — adopted in T8. New surface found:
  0.5.0's `View` can be a `BytesView`, so a schema resolving a bytes target into a view field yields raw
  bytes in the VIEW, which Loam's view serializers (gql `ViewValue`, REST body) don't yet encode to JSON.
  Latent today; §23's host contract must define how a BytesView crosses a door.
- **§24 (T5).** Unchanged blocker; SCHEMA_SCHEMA tidies "promotion of law" (reuse the publish path).
- **§14 wave-B (T1).** Unaffected — its writable-flip rides §21's migration wave, which 0.5.0's code-only
  rename doesn't touch.

Learning: a two-version substrate jump is not just a bump — the `View`-can-be-`BytesView` implication
lived a layer deeper than T8's delta-level target.kind audit, and only a spec-by-spec revalidation
surfaced it. Filing the upstream issues (#10/#11) precisely is what made the release land exactly what
§21 needed, so the revalidation was confirmation, not redesign.
