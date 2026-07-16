## 2026-07-09 — Step 10: Schema-schema cutover (PR #13)

The surface is generated, not configured. Registrations no longer carry the schema body as a
JSON blob: a schema is DEFINED by schema-schema deltas (rhizomatic's `publishSchemaClaims`
shape) at a schema entity, and a registration is a REFERENCE — a pointer to that entity, the
policy as canonical JSON, the roots. `readRegistrations` meta-resolves each referenced entity
via `loadSchema` over the lawful slice, so the substrate's whole definition lifecycle finally
reaches the GraphQL surface: **evolution is append** (republish at the same entity; the running
gateway rebinds — no restart), **deprecation is negation**, and **the schema's identity is the
entity, not the name**. Registration went turnkey in the same stroke: `POST /:mount/register`
(operator token), the `loam_register` MCP tool, and `loam register <file>` — closing the
field-test gap where a bare `loam serve` store could never gain a surface. 185/185.

Learnings worth keeping:

- **The reactor has no deregister, so evolution is a NAMESPACE, not a mutation.** Internal
  materialization names are generation-qualified (`NUL g<n> NUL <name>`); an evolved schema
  binds fresh materializations under a bumped generation and the superseded ones are left
  behind (documented cost; reopen starts clean). Anything that binds to a materialization by
  name — the runner's `BindingSpec` — resolves through `gateway.materializationFor()`.
- **Validate the SORT, not just the canon.** The review's sharpest find: `loadSchema` proves
  canonicality, `SchemaRegistry`/`buildGqlSchema` prove names and refs, and NONE of them
  evaluate the body — so a canonical dset-sort definition persisted, then crashed every later
  boot inside `reactor.register`. The sort of a term is content-independent (the offeredLens
  trick), so `assertMaterializable` trial-evals empty and refuses poison before it lands.
  On append-only ground, "validate before any state changes" must include validating what the
  REPLAY will do, not just what the append does.
- **One negation algebra, everywhere.** First cut treated any lawful negation of a registration
  as final; the substrate revives on negation-of-negation, and definitions (via `loadSchema`'s
  mask) already followed it. Registrations now do too, and only LAWFUL negations count — a
  federated foreign negation retires nothing, closing a hole the blob form never had to face.
- **Success must mean BOUND.** `publishRegistration` persists deltas and then verifies the
  replay actually bound them; a name collision is a plain refusal, never a silent 200 over a
  registration that looks real and serves nothing.
- **A live stream captures its shape.** Trigger and resolution must read the same
  materialization: a stream triggered by the old generation but resolving through the new def
  silently misses what only the new shape gathers. Streams now capture (policy, matName) at
  subscribe — an old stream honestly serves the shape it promised until the reader resubscribes.
- The register surface is HTTP/MCP/CLI, **not** a GraphQL mutation: an empty store has no
  GraphQL surface to mutate through — the endpoint IS the schema-schema mutation mechanism, and
  GraphQL stays strictly derived-from-what-is-registered.
