## 2026-07-12 — Re-plan: resolvers before renderers (TODO only, no code)

PR #73 merged on Myk's word (§14 write semantics + the remove-one/writability amendment). Then a
backlog re-plan, run as CLAUDE.md stage 8 while the remaining-§14-verbs work churns in a parallel
session: two TODO items rewritten, nothing implemented.

**New: Reserved §21 — custom resolvers.** Myk's 3am proposal, and it earns its place ahead of
renderers. The observation: a rhizomatic Policy does two jobs — SELECTION (whose claims count) and
REPRESENTATION (what the survivors denote) — and only selection needs the closed algebra. An
optional Loam-level `resolve(deltas) → value` downstream of the Policy recovers app-level
expressiveness with zero substrate changes. The pleasant surprise recorded in the item: §14's write
verbs never needed the value function — clear/remove act on the bucket and let resolution re-run —
so a custom resolve costs predictability (write x, read f(x)), not mechanism, and Loam's §13
posture already refuses to promise more. The item carries a purity ladder (bucket-pure →
hyperview-scoped → store-querying → effectful → synthetic, Myk's top rung: Schema properties with
no hyperview analog at all — read-only by definition, and the point where the DerivedFn overlap
becomes a design question) and seven open questions; the load-bearing one is
that a resolver is CODE SHIPPED AS DELTAS, which is exactly the renderer question — answer it once
in §21 and let §22 inherit the doctrine. That dependency is WHY resolvers go first.

**Rewritten: Reserved §22 — renderers.** The old item was welded to the phrasing of the original
handoff; the reframe is the thesis it was circling: a renderer is a surface whose door is pixels —
§17's law arriving at the screen. Loam ships a stock React host whose router is DERIVED from the
store; push a renderer delta and the route exists. Village-as-a-URL, federation shipping apps
(inert-by-default like foreign law), app-store mechanics for free out of the delta model. The
design questions kept their teeth (host contract as capability-scoped handles, push-time
verification at the SurfaceGenerator seam, §17 versioning, trust/sandboxing, router discipline);
what changed is that they now serve the vision instead of substituting for it.

Renumbering note: renderers held "Reserved §21" but nothing outside TODO.md referenced it, so
resolvers took §21 (they land first) and renderers moved to §22 — landing order and section order
agree, no renumbering debt.
