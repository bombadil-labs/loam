## 2026-07-15 — §23 renderers, v1 build: push deltas, get software

The design landed (#98, Myk-reviewed) and the v1 read-only slice follows it. A renderer is a surface
whose door is PIXELS — the next witness to §17's SurfaceGenerator seam, whose "door" is a rendered route
instead of a GraphQLSchema. A renderer is a content-addressed ESM bundle pushed as a delta, bound to a
route + schema + optional §17 vN pin; `readRenderers` derives the served set (latest-per-route, lawful
slice) exactly as `readRegistrations` derives the surface; `publishRenderer` proves it at push (operator-
only, schema registered, pinned version exists, consumed fields real, bundle loads to a function); and
`serveRoute` resolves the node under the door's discipline and executes the bundle to HTML, served at
`GET /:mount/app/<route>/<entity>` on both doors (the anonymous door only a publicly-declared lens's
latest, §17). Push a renderer, GET the route, receive HTML rendered from the store's live view — no build,
no deploy, the database is the deployment. Demonstrated end to end over real HTTP in phase23 (4/4): serve,
read discipline (anon 401 → 200 after the operator opens the lens), live evolution on re-push, and the
route going dark when its bindings are struck.

Two decisions that kept the slice tight:
- **Pin by §17 vN, not by schema content-hash (yet).** A renderer pins a schema by its version alias,
  which already freezes the whole reading — resolvers included, since §22 freezes resolvers at the
  registration-version level. So the resolver-in-snapshot fold and name@hash schema-snapshot pinning that
  §21/§22 deferred "until §23 needs the whole reading frozen" DON'T come due in this slice — they come due
  in the slice that first pins a renderer by schema content-hash. The deferral held one rung longer than
  the design guessed, which is fine: build the freeze where the pin that needs it actually lands.
- **Headless host first.** v1's renderer is `export default (node) => html`, executed server-side, so a
  GET returns server-rendered HTML — fully testable, no browser. A React renderer bundles its own React
  and returns renderToString; the host is framework-agnostic, which is the point (a renderer is, for all
  it knows, a component against a bundled service). The live browser React host + hydration + subscription,
  write-enabled renderers + the pen, the ocap sandbox, the byte-door, and the pinned-public amendment are
  each their own named later slice (spec/23 §23.11).

Refactor folded in: the content-addressed `data:`-URL ESM loader (§22.3 snapshot doctrine) is now shared
between resolvers and renderers as `src/gateway/esm.ts` — one loader, one cache, for every consumer of
executable-code-at-rest. v1 executes the operator's OWN bundles in a governed store (only operator law
binds, §7); the confinement for untrusted executable law (object-capability SES/Worker/wasm, §6) is the
named §23.9/§24 work, not invented here.

Learning: the SurfaceGenerator seam paid for itself again. §23 added a whole new SURFACE — a rendered
route — without inventing any new authority machinery: `serveRoute` resolves through the same door
projection GraphQL and REST resolve through, so the anonymous-read discipline, the version door, and the
lawful-slice filtering all applied for free, and the entire novel surface is ~a module plus a verb. "N
interfaces over one store answer the same ground" now includes one whose answer is HTML.

`npm run check` green — format, lint, typecheck, build, 561 tests (test/gateway/renderers.test.ts:
serve, push-verify, latest-per-route, pinned version, withdraw-stops-serving, read discipline, faulting-
renderer refusal, operator-only). Additive/non-breaking (a store with no renderers is unchanged) → no §20
migration. Panel review (substrate-semantics · capability-security · correctness-API) on the PR. Breaking?
No — but it introduces an executable-consumer surface, so it is Myk's merge.
