## 51. The write side of a reference is derived from the read side

A hyperschema body already states, machine-readably, what a well-formed edge delta looks like: an
`expand` node with an exact role feeding a grouped property is the read program's own description
of the deltas it consumes. §51 makes the generator read that statement backwards. A registration
may declare `refs` — reference properties, each naming its edge role and, optionally, the
reciprocal role and context the far side folds under — and the surface then serves
`link<lens>_<prop>(entity: ID!, target: ID!)` and its `unlink` twin, minting one symmetric
two-pointer delta per link: the role at the target under the reciprocal context, the reverse role
at the entity under the property's own context. One declaration, both directions; the write side
is the adjoint of the read program, never a second source of truth.

The rule this section exists for: **the introspected surface is the entire documentation a cold
MCP client will ever read, so it must teach the truth.** Before §51, every writable property
advertised `PrimitiveValue`, and the first cold client to write a reference did the natural thing
and minted a string fossil — an inert id no `expand` can follow, repairable only by folklore. A
reference property therefore *loses* its primitive argument entirely: a property is a reference
or a primitive, never both. Declaring one in both `writable` and `refs` warns, and `refs` wins.

The boundaries hold their shape. `refs` carries names, not code, so it rides a scoped register
grant exactly as `roots` and `writable` do — no constitutional change. A declaration whose
reciprocal is unknown still generates the mutations; the authored delta simply carries no
far-side context, and registration says so loudly (`reciprocal context … undeclared; link deltas
will not fold on the <target> side`) — loud at register time, soft at write time. `unlink`
retracts only the caller's own link claims, and the retraction is itself a claim: history
survives. `_claim` stays untouched as the raw escape hatch; the mask stays the only trust
boundary; existing primitive fossils keep resolving beside real edges in the mixed array, and no
migration touches them. Republishing with a changed `refs` regenerates the surface immediately,
like every other evolution. A `prefix`/`inSet` role marks a property as a reference for typing but
mints no link mutation — there is no single canonical role to author. Bilateral reciprocal
derivation and typed nested view fields are deliberate deferrals, not omissions.

**Provenance.** Designed by Myk (the lens-derived edge mutations brief, 2026-08-25, from the
first cold MCP client's live string-fossil repro); realized by T245 (PR #482). Implementation:
detection and `refs` parsing in `src/gateway/registration.ts`, generation in
`src/gateway/gql.ts`, the authored delta and retraction in `src/gateway/mutate.ts`, warnings in
`src/gateway/lifecycle.ts`. The rails are `test/gateway/edge-mutations.test.ts`.
