# The board lands — live instance first, durable form same day

§34 landed in an order worth recording because no PR shows it whole: the **live instance came
first**. Myk's persistent board store went up over the wire in an afternoon session — improvised
flat vocabulary, singleton entity, one claim per dynamic item context — and was serving his real
status page before the durable form existed. The build lane (T108, #272) then wrote the
repo-blessed form against the working spec: per-item entities, the `expand`-through-a-reading
collection, one-call templates, and a boot script whose re-run deliberately **re-expresses law
that differs** — so the improvised store is not a stranded fork but the blessed script's first
migration customer.

The sequencing paid immediately, which was the point of dogfooding:

- **T110** — the board hit the missing list-things-of-a-kind door *within the hour* of the live
  stand-up; the improvised singleton and the durable form's explicit membership are both
  workarounds for it, and Myk settled the shape same day (container-backed materialization,
  authed-only v1).
- **T112** — the durable form's own P5 rail lens found the renderer silently dropping an item
  whose status matches no section; store and page disagree, on the one app we read daily.

One process learning: the P5 suppression lens flagged that the public `Board.items` expand shipped
with no negation-closure rail. The probe came back clean — the substrate expand IS negation-closed
— but the flag was right that nothing pinned it, and the two-sided rail now does. An app whose
collection reaches the anonymous door through `expand` should treat that rail as part of the
app, not as substrate trivia.
