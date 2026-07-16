## 2026-07-10 — Unit 2: the open door (PR #43) and the village that reads through it

**Public reads as data; the browser client ships.** SPEC §12 landed whole. One operator-signed
declaration at `loam:public` opens named registered schemas to tokenless query + subscribe;
union across surviving declarations, one negation revokes, live next request; malformed
declarations refused at BOTH doors (`publicDefect` in `authorize` and in `federate` — the
erasure lesson, applied on day one). The anonymous surface is a **restricted GraphQL schema**
with no Mutation type at all — the decisive design call: `hooks.mutate` with no actor signs as
the OPERATOR, so tokenless writes had to be a validation impossibility, not a policed string;
the bonus is introspection that honestly reveals only the public shapes. Transport keeps its
refusals uniform (closed = absent = 401, bad token never downgrades) and serves CORS everywhere
(authority is an explicit bearer header, never ambient — the wildcard lends nothing).
`@bombadil/loam/client` is the non-custodial side: keygen in-page, local signing, `/append`
writes, fetch-based SSE. 361/361; phase13 6/6; the dashboard now reads the almanac directly,
tokenless.

Learnings worth keeping:

- **The bundling care point was real.** rhizomatic's root re-exports its peer transport
  (`node:http`), exposes only `"."`, and lacks `sideEffects: false` — tree-shaking alone does
  NOT drop the edge (verified empirically before writing any code). The client ships as one
  esbuild bundle with `node:http` aliased to a throwing stub; `bundle.test.ts` pins zero
  `node:` specifiers. A browser-safe subpath export in rhizomatic would retire the stub —
  noted for Myk, not urgent.
- **A public door needs its own budgets.** The review's sharpest finding: anonymous
  subscriptions drew on the SHARED lazy-materialization cap (1024, process lifetime) and
  stream cap — a stranger could quietly degrade the authenticated surface. Per-door budgets
  (`maxPublicWatches`, `maxPublicStreams`, both 256) confine the stranger's cost to the
  stranger's door. General rule: **when a surface is opened to the unauthenticated, every
  resource it can consume needs a boundary that authenticated users don't share.**
- **Uniformity is more than a status code.** Closed-vs-absent must match in body AND cost: a
  per-request O(store) scan of the open set was a timing oracle (and a cheap-to-send,
  expensive-to-serve request). The open set is now cached and invalidated once per WRITE via
  the raw-stream subscription — the liveness contract holds, and a refusal costs O(registered).
- **Windows PowerShell 5.1 mangles UTF-8 in-place edits** (reads ANSI, writes BOM) — village
  narration carried mixed-encoding mojibake from earlier sessions; repaired with a run-based
  cp1252-reversal script. Use the Edit tool for source, always.
- Village hygiene paid down in passing: homes reset and re-baselined; `gen-schemas.mjs` now
  emits the `presence` prop the mill's evolution promises (regeneration was silently a
  regression); phase0's operator-count check follows the store roster instead of pinning 4.
