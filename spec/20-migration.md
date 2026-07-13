## 20. Migration — old deltas in, new deltas out

A store is grow-only and content-addressed, which makes a breaking change to the on-wire format a
genuine problem: a signed delta CANNOT be rewritten in place (the id is its content; the signature
is its author's). When a format change alters the bytes or roles of a delta that older stores
already hold — as rhizomatic 0.3.0's realignment did to schema-definition deltas
(`rhizomatic.schema.*` → `rhizomatic.hyperschema.*`, §2) — those stores open but lose the surface
those deltas backed. So **every breaking on-wire change ships a migration** (standing rule): a step
that reads the old deltas and streams correctly-formed ones out.

**A migration never rewrites; it supersedes.** For each delta a step changes it does two grow-only
things, both signed by the operator running the migration:

1. **Re-sign** the delta into the new form, at its original timestamp — a faithful re-expression,
   not a new fact. (Only the operator's OWN definitions: a seed can re-sign only what it authored,
   and a foreign definition is inert under the new format anyway — its own operator migrates it.)
2. **Negate** the old delta with a negation that also points `supersededBy` at the replacement and
   carries a `reason`. The record reads as a linked chain of supersessions — every retirement
   explained, nothing destroyed.

Because the re-expression is deterministic (same input → same content address) and the output is
deduplicated by id, **re-migrating is a no-op**: the tool is idempotent, and running it against an
already-current store adds nothing.

**Version detection is by SHAPE** — a step `applies` when the old shape it migrates is present —
and steps run in declared order, so a store several versions back is carried forward one step at a
time. This works because a delta's version already lives in its bytes: the vocabulary a structural
delta speaks (`rhizomatic.hyperschema.*` vs the old `rhizomatic.schema.*`) IS its format, so no
per-delta version stamp is needed (one would only pollute the content address with metadata the
bytes already carry). The load-bearing discipline: **every breaking change must give its changed
deltas a shape unambiguously distinct from all prior versions** — then shape-detection cannot
misfire. Almost no delta kinds ever change across a version (a `subject/value` data claim is
byte-identical), so the set a migration must recognize is small and self-labelling. Shape-detection
is the mechanism, not a stopgap: even a per-store version marker could only ever be a fast-path in a
federating store — a lagging peer can deliver an old-shape delta the day after you stamped a version
— so the scan stays the backstop regardless, and the marker isn't worth its maintenance. The chain
composes, so "many versions back" costs only more steps.

The surface: a library `migrate(deltas, { seed }) → { deltas, report }` over the `MIGRATIONS` chain,
and a CLI `loam migrate <offer> [--out <file>]` that re-expresses a frozen offer (a store's export or
a saved `GET /federate` body) in the current format, run against the home whose seed authored the
definitions.

**Provenance.** Landed — the rhizomatic 0.3.0 overhaul PR (the first breaking on-wire change, and so
the first migration). Lives in `src/migrate/migrate.ts` (`migrate`, `MIGRATIONS`, the
`hyperschema-roles` step) and the `loam migrate` command (`src/cli/cli.ts`); tested by
`test/migrate/migrate.test.ts` and `test/cli/migrate.test.ts`. Key decision (Myk, 2026-07-12):
supersede, don't rewrite — re-sign the new form and negate the old with a forward link and a reason,
so a content-addressed, grow-only store can change formats without losing its history or its soul.
