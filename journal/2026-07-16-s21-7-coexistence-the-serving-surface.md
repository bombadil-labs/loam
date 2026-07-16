## 2026-07-16 — §21.7 coexistence: the serving surface (design pass, T2 slice 2b)

The deferred remainder of T2 opened at the design stage: two lenses over one hyperschema, the
serving surface §21 pinned a registry key for and then left unspecified. The draft (a new §21.7
subsection in spec/21-schema-identity.md, marked DRAFT pending Myk's P6) turns on one finding: the
lens name is ALREADY in every binding's bytes — the `schema` pointer targets `schema:<name>` — so
coexistence is a serving-side reading, not a wire change. Latest-wins narrows to latest-per-lens by
regrouping surviving bindings on `(registration entity, lens)`, the eviction §21 opened with turns
out to have been a grouping error, and NO §20 migration ships because no delta moves.

The recommendations (Myk decides at the PR): every door serves the LENS name (`Schema.name`, 0.5.0)
— GraphQL type/query/mutation families per lens, REST's path segment, `loam.public` declarations —
while the hyperschema's name recedes to the program layer (SchemaRegistry refs, `fix`). The
degenerate single-lens case is byte-identical because `Schema.name == hyperschema.name` makes every
derived name the same string. The frozen SchemaRegistry needs no substrate change: its duplicate
refusal is CORRECT (a name must name one gather program); the gateway builds it from the deduped
hyperschema set instead of one entry per binding — the wall was Loam's own list-building habit. Each
lens runs its own §17 version ladder; §22 resolvers are per-lens by construction (they ride the
binding); §23 renderer pins name the lens. Premortem finding folded in: writability is per-binding
serving discipline, so a field writable through one sibling lens is writable (§14's posture, not a
bypass) — said honestly in the draft. "Lens" stays prose; no type gains the word.

Design-stage → never self-merged. PR opened as the decision memo; implementation waits for Myk's
word.
