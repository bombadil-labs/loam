# Step 10 — Schema-schema cutover: the surface is generated from definition deltas

SPEC §5 already promises it: "Schemas are always built from deltas." Step 7 cut the corner —
registrations carry the schema body as a JSON blob, and rhizomatic's schema-schema
(`publishSchemaClaims` / `loadSchema`, proven in the spike) generates a `HyperSchema` nothing
registers. This step cuts over (no blob form survives — nothing is published yet): a schema is
DEFINED by schema-schema deltas at a schema entity; a registration REFERENCES that entity; the
GraphQL surface is generated from the surviving definitions. Evolution is append; deprecation is
negation; and registration is reachable turnkey (HTTP + MCP + CLI), closing the field-test gap
(2026-07-09: a bare `loam serve` store has no way to gain a surface without the library).

## Success criteria

1. **Registrations reference, never carry.** A registration delta holds a pointer to a schema
   entity + policy JSON + roots JSON — no schema body anywhere in it. `readRegistrations`
   generates each `HyperSchema` via `loadSchema` over the store's surviving definition deltas.
2. **Foreign law stays inert.** In a governed store, only operator-authored definition AND
   registration deltas bind. A federated peer's definition delta at the same schema entity
   merges (union is union) but cannot reshape the local surface. Pinned by a test.
3. **Evolution is append, live.** Republishing a definition at the same schema entity serves the
   new shape — on the RUNNING gateway via `publishRegistration` (no restart; the reactor has no
   deregister, so internal materialization names are generation-qualified in the gateway's
   NUL namespace), and on reopen via replay.
4. **Deprecation is negation.** A negated definition leaves its registration unbound — the type
   drops from the surface on rebuild/reopen; never a crash, never a stale blob resurrected.
5. **Turnkey registration.** `POST /:mount/register` (operator token only: 403 non-operator,
   400 malformed), an MCP tool `loam_register` (same gate), and `loam register <file> [--home]`
   (offline, against the home's store; documented single-writer caveat). A fresh `loam serve`
   store can be given its first schema with nothing but curl.
6. **Genesis emits the new form** — one definition claim + one registration claim per
   registration, deterministic timestamps, boot stays idempotent.
7. **Docs are first-class.** SPEC gains the registration model (definitions at `schema:<Name>`
   entities; registrations reference; operator filtering; policy stays canonical JSON — the
   reader's lens has no schema-schema and doesn't need one). README: HTTP API table, CLI table,
   embedding section, plus the pending SSE `subscription`-keyword fix rides along.
8. **`npm run check` green**; feature branch; PR; one careful review agent (neutral register);
   JOURNAL entry on merge.

## Sub-tasks

- [x] SPEC.md: specify the registration model (a §5 passage)
- [x] Tests first (24 new, red before implementation, all honest):
  - [x] registration: claims shape; generate-via-loadSchema; operator filtering (foreign
        definitions AND registrations inert); latest definition wins; negation unbinds (both
        the definition and the registration); malformed binds nothing
  - [x] gateway: evolution reshapes the RUNNING surface (no restart); reopen serves the evolved
        shape; deprecation-by-negation reopens without the type; genesis emits definition +
        reference; ref'd schemas fixpoint whatever the genesis order (Bed→Plant)
  - [x] federation: a peer's definition/registration deltas are admitted (union) but the
        reopened surface is the operator's alone
  - [x] http: POST /register end-to-end (register → mutate → query the new type), 403/400;
        MCP loam_register (listed, gated, works)
  - [x] cli: `loam register plant.json --home …` then a fresh serve answers; friendly errors
- [x] Implement:
  - [x] registration.ts: reference-shaped claims; `lawfulSnapshot`; readRegistrations generates
        via loadSchema over the lawful slice (negations lawful-filtered too)
  - [x] gateway.ts: publishRegistration emits definition (trial-proven via the now-lawful
        `Gateway.loadSchema` seam — no longer dead code) + reference; generation-qualified
        materialization names (`matName`); rebind-on-change replay; `materializationFor(name)`
        public resolver (the runner binds through it)
  - [x] genesis.ts: two claims per registration, deterministic clock
  - [x] http.ts: /register route + `loam_register` MCP tool (shared `performRegistration`)
  - [x] cli.ts: `register` subcommand
  - [x] README: quickstart, HTTP API, "Schemas are data" section, embedding note; SSE fix rode
        along
- [x] Gate: `npm run check` — 175/175 tests, format+lint+typecheck+build green
- [x] Branch + PR — [#13](https://github.com/bombadil-labs/loam/pull/13)
- [x] Review (one agent, neutral register) — 15 findings, 5 correctness, strong ones
- [x] Resolve review — all correctness findings fixed, 10 new tests, 185/185:
  - [x] (1) assertMaterializable (content-independent sort trial) in fixpoint, register(), and
        publishRegistration — refuse before persisting; a hand-planted poison boots unbound
  - [x] (2) NUL refused at publish, skipped at read; (3) negation algebra honored (revival);
        (4) publish verifies BOUND or throws plainly; (5) streams capture (policy, mat) at
        subscribe; (6) lazyMats cleared on rebind; (7) additive replay binds incrementally;
        (9) dead branch removed; (10) CLI names the file, close() cannot mask the refusal
  - [x] accepted as-is: (8) fixpoint builds gql per trial — administrative scale
- [ ] Merge; JOURNAL entry; re-plan; clear this file  ← **left off here**

## Decisions taken at planning (so the next cycle doesn't re-litigate)

- **Cut over, no compatibility shim** (Myk, 2026-07-09): nothing is published; one
  representation only.
- **The register surface is HTTP/MCP/CLI, not a GraphQL mutation**: an empty store has no
  GraphQL surface to mutate through (chicken-and-egg); the endpoint IS the schema-schema
  mutation mechanism, and GraphQL stays derived-from-what-is-registered.
- **Schema identity is the ENTITY, not the name**: default entity `schema:<Name>`; republishing
  at the same entity evolves; a different entity is a different schema even with a colliding
  name (the duplicate-name refusal leaves the later one unbound — the replay fixpoint already
  handles it).
- **Old subscription streams keep watching the superseded materialization** after a live
  evolve; new subscriptions see the new shape. Honest and simple; revisit only if it bites.
