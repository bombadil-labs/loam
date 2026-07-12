# Current work — rhizomatic 0.3.0 overhaul + migration tool + registration realignment

_Branch `rhizomatic-0.3.0-vocab` (PR #72). **Complete — ready for Myk's merge.**_

## Done

- **0.3.0 vocabulary overhaul** — Schema/Policy rename + Option B wire realignment; source, tests,
  demos, docs; village 0-19 green; tutorial live-verified; 2-angle review (6 doc fixes).
- **Migration tool (SPEC §20)** — `migrate()` + `loam migrate` + the `hyperschema-roles` step:
  re-sign the new form + negate the old with `supersededBy` + reason; grow-only, shape-detected,
  idempotent. Review caught + fixed a signing-oracle (now gated on `verifyDelta`) and the re-run
  report. The shape-distinguishability discipline is explicit (CLAUDE.md + §20).
- **Registration-role realignment** — the registration delta's WIRE roles now follow the model:
  `hyperschema` names the definition entity, `schema` carries the resolution program (was
  `schema`/`policy`). `registration.ts` only; packets regenerated (content addresses moved);
  451 tests + full village 0-19 green (transparent — everything reads the parsed `Registration`).
- **Store-level version marker: dropped** (Myk) — shape-detection is the mechanism; a marker could
  only be a fast-path in a federating store and isn't worth the maintenance.

## Also done

- Internal `Registration`/`Registered`/`Bound` field rename to match the wire (`.schema`→
  `.hyperschema`, `.policy`→`.schema`) across gql / rest / surface / gateway / migrate / tests /
  demos — compiler-guided, no wire/content-address impact (packets byte-identical).
- **Unified register input format**: the `loam register` file, `POST /:mount/register`, and the MCP
  `loam_register` tool now take ONE shape, identical to `Registration` —
  `{ hyperschema: { name, alg?, body }, schema, roots, entity?, mutations? }` — via a single shared
  `parseRegistrationInput`. The file went flat → nested. No wire impact (register input isn't a
  delta). Village schemas regenerated, README register docs rewritten.

**Nothing deferred — the 0.3.0 vocabulary is complete end to end: wire, parsed, and user-facing.**

## Gate

`npm run check` **green, 451 tests**. Village 0-19 green. PR #72 updated.
