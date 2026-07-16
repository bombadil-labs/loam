## 2026-07-14 — §22: custom resolvers, rung (a)

The last step of a lens becomes programmable. A Policy did two jobs in one breath — SELECT (which
claims survive, in what order) and REPRESENT (what they mean as a value). §22 frees representation: an
optional `resolve(bucket) → value` rides the binding, per field, downstream of the Policy. The closed
rhizomatic algebra keeps the epistemics untouched; the resolver overrides only the semantics, so the
View stops being limited to the six shapes the Policy algebra exports and becomes what an app MEANS by
its data — while the ground stays pure deltas. Writability stays orthogonal (a write still hits the
bucket; the surface documents the honest "you read back f(x), not x"). v1 builds RUNG (a) alone —
bucket-pure, a function of the field's gathered deltas: deterministic, reproducible on any peer,
cacheable. The higher rungs (b/c/d) and (e) synthetics are described and refused at parse.

Resolver at rest = directly-runnable ESM (§22.3): `export default (bucket) => value`. Loaded once,
async, from a `data:` URL and cached by content address; the resolve path stays SYNCHRONOUS because
rung-(a) resolvers are pure sync functions pre-loaded at bind time (boot + publish). The memo keys on
`(resolver-content-address, surviving-bucket-delta-set)` — so erasure invalidates BY CONSTRUCTION: an
erased fact drops from the bucket, the key changes, the memo misses, and a value distilled from
forgotten bytes can never be served (§11). The doors advertise each resolved field's DECLARED output
type (§22.6), not the Policy's — a resolver changes what the value IS, so GraphQL types it Float/String/
etc. and OpenAPI documents the same, keeping §17's two-doors-agree invariant.

The load-bearing decision (Myk flagged it, then overruled the constraint): §22.4/22.5 assumed "§21
already froze the resolver into the VersionedSchema," but §21 landed hashing only `props`+`default`
(rhizomatic's `Schema`, which is frozen and has no room for a Loam `resolve`). Rather than re-open
§21's just-landed snapshot, a resolver rides the BINDING and freezes at the registration-version
granularity — changing a resolver mints a new binding → a new version (`readRegistrationVersions` pins
each), and a pinned version applies its own resolver forever. This meets §17's append-only law and the
"pin it, answers the same" guarantee at the version-delta level. Folding a resolver into the `name@hash`
VersionedSchema itself (so a §23 renderer pinning `name@hash` freezes the resolution too) is deferred
to §23 — the exact same deferral §21 used for `VersionedHyperSchema`: build the freezing when the pin
that needs it arrives, not speculatively. Spec §22.4 was rewritten to say this plainly.

Learning: when a downstream spec section rests on an assumption about how an upstream section was
IMPLEMENTED (not just designed), the assumption is only as true as the build. §21's design said "the
VersionedSchema freezes the reading"; its build froze the SELECTION half, which is all §21 itself
exercised. §22's "resolver is part of the frozen version" was true in spirit but not in the bytes — and
the clean resolution was to freeze at the granularity that already exists (the version delta) and defer
the deeper folding to the consumer that needs it. Deferring-to-the-need is becoming the arc's load-
bearing pattern (VersionedHyperSchema, now resolver-in-snapshot): the freezing is built where a pin
first depends on it, keeping each slice tight.

`npm run check` green — format, lint, typecheck, build, 547 tests (test/gateway/resolvers.test.ts: the
override, rung admission, output types, the required memo+erasure invalidation, writability
orthogonality, and per-version resolver freezing). Additive/non-breaking → no §20 migration; a binding
without resolvers is the pre-§22 shape. Village phase22 exercises it end to end over a running store.
