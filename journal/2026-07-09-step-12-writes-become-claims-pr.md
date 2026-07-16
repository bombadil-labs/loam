## 2026-07-09 — Step 12: Writes become claims (PR #15)

The schema became a PROTOCOL: claim templates — pointer skeletons with argument holes — travel
in the registration delta beside the read program, and each becomes a GraphQL mutation emitting
exactly ONE signed multi-pointer delta (a hosted screening: host, film, guests, date — one fact
filing into four entities' views). The generic `_claim` covers unanticipated shapes; `POST
/:mount/append` is the non-custodial door (the token authenticates transport; each delta is
authorized by its own verified author's standing); `_hviewHex` rides beside `_hex` — the
evidence and the answer, separately addressable. 207/207.

Learnings worth keeping:

- **"Loud on publish, quiet on replay" is a CONTRACT, and the loud side must cover everything
  the quiet side will trip on.** The review's sharpest find: an unvalidated argument name
  persisted cleanly, then failed inside replay's buildGqlSchema, where the templateless
  fallback bound the schema minus its mutation — publish reported success for a mutation that
  didn't exist. The fix is structural: the publish trial now runs the FULL bind (registry,
  materializability, template visibility, GraphQL build) before anything lands.
- **A trial specimen must impersonate faithfully.** The visibility check's specimen was
  authored "loam:specimen" — so any governed-store body with an author lens refused honest
  templates. The specimen now signs as the operator; the residual infidelities (exotic value
  or timestamp predicates) are documented rather than pretended away.
- **Resolution elides the anchor.** At Wren's root, the five-pointer screening delta resolves
  as the event FROM HER PERSPECTIVE — host, film, the OTHER guest, the date; her own anchoring
  pointer dropped. Nobody designed that view; the substrate's resolution rules produced
  exactly what a human would want. Field-test finds like this are why the village exists.
- **Shared namespaces need symmetric guards** — the mutation root is fed by per-prop fields
  AND templates from every schema; a collision check that only guards one insertion order is
  half a check.
- Raw append grants the library's full power over HTTP (own timestamps, delta-refs,
  negations) — that is the POINT (non-custodial parity), and it is now stated plainly in the
  code rather than discovered by surprise.
