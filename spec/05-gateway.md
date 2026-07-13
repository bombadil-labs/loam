## 5. The gateway (Loam's only surface)

HTTP, CLI and MCP interfaces exposing GraphQL: **`query`** (resolve → snapshot), **`subscribe`** (live →
snapshot + patches), **`mutate`** (a schema's write-resolvers turn field-args → deltas → append),
**`loadSchema(deltas) → schema`** (append schema-defining deltas, meta-resolve via `HYPER_SCHEMA_SCHEMA`,
return it). Nothing is reachable except through GraphQL over a schema — including schema CRUD.
**Schemas are always built from deltas.** Underneath there are two primitives — **`append`** and
**`resolve`** — and `query`/`mutate`/`loadSchema`/`subscribe` are framings of them. Query is
reflective (resolving a schema is itself a resolve); snapshots amortize the reflection (meta-resolve
once at snapshot time, read cheap thereafter).

**Registration (decided 2026-07-09, step 10 — cutover from step 7's blob form).** A schema is
DEFINED by hyperschema-schema deltas — rhizomatic's `publishSchemaClaims` shape (`rhizomatic.hyperschema.defines` /
`.name` / `.alg` / `.term`) filed at a schema entity, `schema:<Name>` by default. A REGISTRATION is
a separate delta under `loam.registration` holding only references: a `hyperschema` pointer to the
definition entity, the `schema` (the resolution program) as canonical JSON, and the roots. The
GraphQL surface is generated: `readRegistrations`
meta-resolves each referenced entity via `loadSchema` over the store's surviving definitions —
so **evolution is append** (republish at the same entity; the running gateway rebinds — the
reactor has no deregister, so live materialization names are generation-qualified internally —
and a reopened store replays the latest shape) and **deprecation is negation** (a negated
definition leaves its registration unbound; the type drops from the surface). The schema's
identity is the **entity**, not the name. In a governed store only operator-authored definitions
and registrations bind — a federated foreign definition merges as a delta but reshapes nothing
(the same operator-rooting that keeps foreign grants inert). The policy — a Schema — carries no
hyperschema-schema and needs none: it is the reader's lens, not the entity's shape, and travels as
canonical JSON. The register surface is `POST /:mount/register` (operator token), the
`loam_register` MCP tool, and `loam register <file>` — an HTTP endpoint rather than a GraphQL
mutation because an empty store has no GraphQL surface to mutate through; the endpoint IS the
hyperschema-schema mutation mechanism, and GraphQL stays strictly derived-from-what-is-registered.

**Writes become claims (decided 2026-07-09, step 12 — queued).** A schema is a _protocol_: the
read program (the hyperschema body) and the **write discipline**, both data, both traveling in
the registration. The point of writing through a mutation is the SHAPE GUARANTEE — everyone who
adopts a published schema emits byte-compatible facts — so the shape is declared, never
inferred (a read program at one root cannot determine what the fact looks like from the other
roots; one delta serves many views).

- **Claim templates**: a registration may declare named mutations, each a pointer skeleton with
  argument holes (`{ role, at?/value?, context? }`); the GraphQL mutation derives its args from
  the holes and emits ONE signed multi-pointer delta — a hosted screening with host, film,
  guests, and date is one delta filing into four entities' views. Today's primitive-prop
  mutations remain as the auto-derived degenerate template. At registration time each template
  is **trial-proven against the schema's own body** (generate a specimen, evaluate the gather,
  refuse a template whose output its own reads would never see) — prove before persist, as
  everywhere.
- **The generic claim**: a `_claim(pointers: […])` mutation for shapes no template anticipated —
  same signing, same standing, no schema sugar.
- **Raw append** (`POST /:mount/append`): pre-signed wire deltas, verified and admitted under
  the author-standing rule — the non-custodial path, where the server never holds the key.
- **Both hashes on the surface**: `_hex` (the resolved view's canonical bytes — the answer) and
  `_hviewHex` (the gathered hyperview's — the evidence). Two lenses over the same ground share
  `_hviewHex` while their `_hex` diverges exactly when their schemas adjudicate differently.
- **Foreign dialects are transformed, not rejected**: deltas expressing the same ideas in other
  shapes merge as always; a runner binding reads them and emits canonical-shape deltas citing
  their sources (the §9 provenance discipline). Standard shape by guarantee for your own
  writers; translation for everyone else's.

**Provenance.** Landed — [#4](https://github.com/bombadil-labs/loam/pull/4) (the read gateway: `query`/`loadSchema`), [#5](https://github.com/bombadil-labs/loam/pull/5) (`mutate`/`subscribe`), [#13](https://github.com/bombadil-labs/loam/pull/13) (registrations-as-deltas: evolution is append, deprecation is negation), and [#15](https://github.com/bombadil-labs/loam/pull/15) (writes become claims: templates, the generic `_claim`, raw append, `_hviewHex`). Lives in `src/gateway/gateway.ts` (`Gateway`) and `src/gateway/registration.ts` (`readRegistrations`, `schemaEntityFor`, `registrationClaims`). Key decision: the schema's identity is the **entity**, not the name, so a republish at the same entity rebinds the running gateway with no restart.
