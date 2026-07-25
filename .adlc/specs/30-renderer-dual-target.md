# T79 — The dual target is a HOST, not a renderer: a Loam app publishes as a Claude Artifact that speaks to the viewer's own store

**Ticket.** T79. **Depends on** §23 (renderers), §17 (surfaces), §12 (the open door), §6 (two keys),
§7 (the mount is the read boundary). **Edge:** T78 (dynamic mounts) — needed for the demo path, not
for this contract (see *Sequencing*). Design-stage: this spec carries reasoned recommendations; **the
decisions are Myk's at the PR**, because it lands on the publication and capability surfaces.
**Proposed section number: §30** — `spec/30-artifact-host.md`. (§29 is claimed by BOTH T64
*slating-and-graveyards* and T77 *the hub*; that collision is pre-existing and worth resolving
separately, but T79 should not become a third claimant.)

## The reframe: nothing about the renderer is dual

The ticket's sketch was a `target` role on the binding — `host` vs `artifact` — shape-distinguishable,
absent-reads-as-host, no migration. That would work, and it is the wrong seam, because it asks the
binding to carry a fact that belongs to the thing running it.

Read §23.2 again. Its governing sentence is *"for all a renderer knows, it is an ordinary React app
talking to a GraphQL service that happens to be bundled with it"* — the renderer speaks lens, the
HOST holds the keys. And the v1 bundle contract landed exactly that shape: `RenderFn = (node:
RenderNode) => string`, a pure function from a resolved view to markup (`src/gateway/renderers.ts`).
That signature names no host. It runs today in a `worker_threads` Worker on the operator's server; it
can run unchanged in a browser tab, called with a `RenderNode` assembled from a query result, its
string written into the DOM.

So the duality is a property of the HOST:

| | host target (built, #99–#133) | artifact target (this ticket) |
|---|---|---|
| where the bundle runs | operator's Worker, 500 ms cap, `maxPublicRenders` fan cap | Anthropic's artifact sandbox |
| who resolves the view | the operator's gateway, under the door's discipline | the VIEWER's MCP connector, under the viewer's token |
| whose authority | the operator's doors, plus a §23.3 pen | exactly the viewer's own, and no pen |
| what the page holds | nothing (server-rendered per request) | the bundle, the coordinates, no data, no key |

Two different trust roots, and — this is the ticket's point (4) and it survives the reframe intact —
**neither is weaker; they are different.** What makes the difference legible is not a flag on the
binding. It is that one of them requires a deliberate operator DECLARATION to exist at all, and the
emitted page states whose identity reads and whose identity writes, on its face.

**Recommendation 1 — the binding gains no target vocabulary, and no per-target bundle role.** One
renderer, one content address, two hosts. This is §23.1's whole point held: the signature attests
exactly what mounts, one hash, no signed-vs-executed gap — and it would be quietly falsified by a
second bundle role, which would mean the route's attested code depends on which door you knocked at.
§23.5's latest-per-route law is untouched because no new key is introduced.

**Recommendation 2 — the emitted page is a build PRODUCT, and publication is a DECLARATION.**
Two pieces, one of them new vocabulary:

- **`loam.artifact`, an operator declaration** — entity `loam:artifact`, repeatable `route`
  primitives, read as the union of surviving lawful declarations. It is `loam.public`'s twin in
  shape and in doctrine (`src/gateway/public.ts`): the open set is a derived view over deltas,
  a fresh declaration only ADDS, and removal is negation. `Gateway.declareArtifact(routes)`.
  Shape-distinguishable from `loam.public` and `loam.renderer` per the §20 corollary; purely
  additive, so no migration.
- **`Gateway.packArtifact(route, entity, opts)`** — a door that EMITS a self-contained HTML page
  from surviving law, plus `GET /:mount/artifact/<route>/<entity>` beside `app` and `bytes` in
  `src/server/http.ts`.

The declaration is separate from the binding on purpose. Putting permission-to-publish *in* the
binding would mean granting or revoking it changes the bundle's content address — a new renderer
version for a decision that is not about the code. As a declaration, an operator can publish and
un-publish a route without touching what runs, and un-publishing is an ordinary lawful negation, so
§23.6 ("an app never outlives its source") extends to the emission for free: strike the declaration
and the door stops emitting on the next request.

**Recommendation 3 — the pack door lives on the GATEWAY, not the CLI**, as the ticket recommends and
for the reason it gives: withdrawal must be live. A CLI build step reading a file would keep emitting
a page whose binding, schema version, or declaration had been struck. On the gateway the emission is
re-derived from `readRenderers` on every call, exactly as `serveRoute` is. The CLI verb
(`loam artifact pack`) is then a thin HTTP client of that door — the same "one shape for every door"
discipline `parseRendererInput` already enforces, so a refusal reads identically from HTTP, the CLI,
and a direct call.

**The pack door is OPERATOR-ONLY, and to every other identity it does not exist** — byte-for-byte the
404 an unknown verb gets, the idiom `health` already established in `src/server/http.ts`. The reason
is specific: the emitted page contains the renderer's BUNDLE SOURCE verbatim, which no existing door
discloses (`serveRoute` discloses only the bundle's output). Deciding to publish your code is the
operator's, and so is the emission that carries it.

## What the page names, and what it deliberately does not

This is the headline, and it is stronger than the ticket anticipated.

The artifact CSP blocks every request to an external host, so the page cannot fetch the store. The
data path is therefore `window.claude.mcp`, whose addressing is settled and consequential: `server`
is the connector's **display name**, never an id, "because a published page runs for many viewers"
(`mcp.d.ts`). The connector holds the URL — including the mount path — and the credential.

Therefore the emitted page names: **a connector display name, a tool name or two, a lens name, an
entity, and the `consumes` field list.** It does not name a host, an origin, a mount, a token, a
seed, or a single byte of view data.

Which means the wedge in the strategy note is not a thing we build toward — it falls out. The same
published page, byte-identical, reads whichever store the viewer's connector points at. "Provisioned
to your account" is literal: the page is store-agnostic and the connector is the binding. Hand
someone a link; they add a connector; they are looking at their own ground through your app.

**Recommendation 4 — live via MCP; a publish-time snapshot is refused.** Embedding a snapshot is the
one option that must not ship, and the reason is not performance:

- It falsifies §23.6 in the most literal available way. A page carrying its own data keeps answering
  after the binding is struck and after the deltas are ERASED (§11) — an app outliving its source,
  handed to strangers as a URL, with purged content legible inside it. That is an erasure hole of the
  §11/H7 shape, downstream of a design premise rather than a bug, and no rail on the pack door could
  close it.
- It inverts the trust story. A snapshot page publishes the OPERATOR's reading to everyone holding
  the link. The live page publishes a READING, and each viewer sees exactly what their own token may
  read. Publication of the page is not publication of the data.

So: zero view data in the emitted bytes, asserted as a rail, not a convention.

## The tool manifest, enumerated against the door that exists

Per the ticket: enumerate, do not invent. `MCP_TOOLS` in `src/server/http.ts` is exactly three:
`loam_query`, `loam_mutate`, `loam_register`.

**Recommendation 5 — the manifest is `[loam_query]`, plus `loam_mutate` for a write-enabled binding,
and never `loam_register`.** `loam_register` is constitutional (operator-token only, and the door
says so). A page declaring it would be asking the viewer for store-shaping authority in order to draw
a view; a pack that would emit it refuses. No new MCP tool is required — and in particular **no
subscribe tool**, because the liveness is the shell's: `watchTool(server, tool, input, handler,
{ refetchInterval })` polls, coalesces per identity, pauses while hidden, and catches up on return.
The poll we would otherwise have designed already exists on the other side of the wall.

**Recommendation 6 — two honesty fixes to the MCP door, and the first is load-bearing.** Reading the
handler against the artifact contract turns up a real defect that only this ticket's use makes
dangerous:

1. **`loam_query` can mutate today.** Both tools funnel into `gateway.query(source, …)`, which runs
   `graphql({ schema, source, … })` over any document — including a `mutation`. So the two tool names
   are one authority, and an artifact manifest declaring only `loam_query` would advertise a
   read-only scope it does not have. Worse: `watchTool` and the call cache are keyed on the belief
   that a read-only-annotated tool is safe to replay, so a mutating document under `loam_query` could
   be cached and re-executed by machinery whose contract forbids exactly that. **Fix: `loam_query`
   refuses a document containing a `mutation` (or `subscription`) operation.** Small, precise, and it
   is what makes the manifest's read-only scope true rather than cosmetic.
2. **`MCP_TOOLS` carries no `annotations`.** Add `readOnlyHint: true` to `loam_query` (now true, per
   fix 1) and `readOnlyHint: false` to `loam_mutate` and `loam_register`. This is not decoration: a
   wire-explicit `readOnlyHint: false` makes the shell itself refuse to watch or cache the call
   ("policy floor: a declared write can never be cached or re-executed by cache machinery"). It buys
   a second, independent guard against a replayed write, held by the runtime rather than by us.

**The token model maps to the connector one-to-one.** Loam's table is opaque bearer token →
`TokenIdentity` (`{ actor }` or `{ operator: true }`), compared timing-safely. A connector is
configured by the VIEWER with the MCP URL and their own bearer token; one connector is one token is
one identity, and the page never sees it (`window.claude.mcp` runs "with the viewer's credentials;
your code never sees tokens"). Per-viewer isolation is therefore the isolation §7 already has: a
separate mount (their own store or container — which is where T78 earns its edge) or a distinct actor
token on a shared one.

**And note what is absent: there is no MCP door on the public branch.** `case "mcp"` appears only in
the token switch of `src/server/http.ts`; the anonymous door serves `graphql`, `subscribe`,
`openapi.json`, `rest`, `app`, `bytes` and no MCP. So an artifact with no connector reads nothing at
all — not a narrowed public view, nothing. That is the correct default and this ticket should not
change it: opening an anonymous MCP door is a new tokenless authority surface and deserves its own
decision. **(Myk)** — flagged, not assumed.

## Trust: which door, and whose hand writes

**The content comes from the FULL door, under the viewer's own identity.** Because the MCP door is
token-bearing, the artifact is not outward-facing publication of CONTENT; it is publication of a
READING. The page shows precisely what that viewer's token may read and nothing more, enforced by the
store they pointed at, at §7's boundary. The page itself is public and inert.

**Writes are the viewer's own, and never a pen.** §23.3's pen is server-side custody by construction:
the seed lives in `GatewayOptions.pens`, and `writeRoute` signs the delta AS the pen so provenance
shows the mediating code. An artifact has no server and no seed. Its write is `loam_mutate` on the
viewer's connector, which the door executes with `contextFor(identity)` — the viewer's actor. So:

- **Recommendation 7 — the pen never rides an artifact, and the pack door refuses to pretend
  otherwise.** Packing a pen-holding binding without an explicit acknowledgement REFUSES, naming the
  pen, and the emitted page never declares the pen in any form. This is T31's criterion-9 shape
  ("a pen never rides the sugar") at a different door, and the reason is the same: the same route
  writing under two different identities depending on which host served it is a provenance lie unless
  someone said so out loud. §23.3's own rule already demands it — "a host must SHOW which pen a
  mounted renderer writes under" — so the page must display whose identity writes.
- **Nothing is widened, and it is worth being precise about why.** `loam_mutate` on the viewer's own
  connector is authority the viewer already held: they could send the same document to
  `/:mount/graphql` with the same token. The page is a convenience over the viewer's existing
  standing, so §6's two keys hold trivially — publishing the code confers nothing, and the page is
  inert until a connector exists. A viewer whose token has no write standing gets the store's own
  §14 refusal, unchanged.
- **One real observable difference, and it does not ride silently.** `writeRoute` enforces the
  binding's OWN `writable` allow-list at the door, atop the schema's. `loam_mutate` does not go
  through `writeRoute`, so on the artifact target only the schema's `writable` binds. That is not a
  widening of anyone's authority, but it IS a difference between two hosts serving one route, and it
  is decidable at pack time. **Recommendation 8: the pack door refuses when `binding.writable` is a
  strict subset of the schema's `writable`, naming both sets, unless acknowledged.** Cheap to
  satisfy, and it makes the operator look at the delta once rather than discover it from a delta they
  did not expect.

## Fail closed at pack time, where the answer is decidable

Four refusals. Each is a case where the artifact host genuinely cannot honor something the host
target promises, and where quietly degrading would break a §23 guarantee.

1. **A version-pinned binding refuses.** A pinned binding must resolve THAT frozen reading (§21/§23.6
   — a pin never silently slides). Pinned reads exist on the REST door (`/rest/@<deltaId>` →
   `resolvePinned`, `src/surface/rest.ts`) and **not in GraphQL** — and `loam_query` is GraphQL. So
   the page could not address the reading it was pinned to, and packing it as latest would break the
   pin's whole promise. Refuse, naming the gap. The follow-on is small and named: teach the MCP door
   a pinned read (a `version`/`@address` argument, or a REST-shaped `loam_read` tool). Doing it here
   would widen T79 past its wedge.
2. **A consumed field the schema DECLARES `bytes` refuses.** §23.7's envelope is ref-by-default, and
   the ref is fetched from `/:mount/bytes/<ref>?from=…` — an external host, blocked by CSP. Declared
   bytes are decidable at pack time (`ResolverOutputType` includes `bytes`, per field), so refuse
   with the reason. The honest residual, stated because it is not decidable: `gql.ts` types the
   envelope at the VALUE level too, "whether or not the field was declared `bytes`", so an
   undeclared bytes leaf can still arrive at runtime — for which the shell renders a legible
   placeholder for a ref-only envelope and paints inline `base64url` as a `data:` URI. Pack-time
   refusal for what we can prove; a legible degrade for what we cannot.
3. **An undeclared route refuses** (Recommendation 2) — the uniform refusal, live on the next request
   after the declaration is struck.
4. **A pen or a narrower `writable` refuses without acknowledgement** (Recommendations 7 and 8).

## What the page is, mechanically

One file, everything inlined, no external host referenced anywhere — the artifact rules and §23's own
posture agree here.

- **The bundle rides VERBATIM.** The page mounts it the same way the server does: `importEsm`
  already imports a unit from a `data:text/javascript;base64,…` URL, cached by content address
  (`src/gateway/esm.ts`). The shell performs that identical motion in the browser, so the bytes the
  operator signed are the bytes that run, and the page's copy of the bundle content-addresses equal
  to the binding's. **No textual rewrite of the bundle, no `eval`, no `new Function`** — a rewrite
  would reintroduce exactly the signed-vs-executed gap §23.1 exists to close. If a viewer's CSP
  refuses a `data:` module import the shell falls back to a `blob:` object URL, and if neither works
  it renders "this renderer could not be mounted in this viewer" — a legible dead end, never a blank
  page. Which mechanism a given runtime permits is the one implementation unknown here; the rail is
  the invariant (verbatim bytes, no eval, no external request), not the mechanism.
- **The shell is the client HOST ADAPTER** — the seam that makes this ticket's second half cheap. It
  holds the coordinates, calls `watchTool(server, "loam_query", { query, variables }, handler,
  { refetchInterval })`, assembles a `RenderNode` (`{ entity, view, hex }`) from `result.payload`,
  calls the bundle's `RenderFn`, and writes the string into its mount point. **One watch per
  (lens, entity)** — well inside the 64-per-view limit, and coalesced by the shell.
- **Forms work on both hosts from one markup.** A §23.3 renderer already emits a `<form>` that POSTs
  to `/:mount/app/<route>/<entity>`. The shell intercepts submit, prevents default, and maps the
  fields to `loam_mutate`, then `invalidate`s so the watch refetches. The author writes one form and
  both hosts honor it. (Preventing default is not cosmetic: an un-intercepted form would attempt a
  cross-origin POST, which CSP kills silently — a form that looks like it worked and did nothing.)
- **`window.claude.mcp !== undefined` is the availability gate**, per `mcp.d.ts`: the member check,
  never a probing call, and never gating render on a permissions read equalling `"granted"`. The page
  renders its static shell FIRST, so a top-level navigation (where `window.claude` is absent
  entirely) shows something legible rather than nothing.
- **Degraded states branch on `code`, never on message text.** This is a contract, not polish: the
  four codes with distinct correct fixes are `server_not_connected` ("add a connector named X
  pointing at `<url>`" — the onboarding path, and the ONE place the store's URL appears, as copy the
  viewer reads rather than a target the page requests), `needs_reauth` (reconnect), `not_granted` /
  `capability_disabled` (render the no-MCP experience), and `server_unavailable` (retryable — at most
  one retry per user-visible refresh, honoring `retryAfterMs`). `needs_reauth` and
  `server_not_connected` are never retried; repeating them cannot succeed.

**Process note for P3:** the builder must load the `artifact-capabilities` skill before writing the
`capabilities` declaration or any `window.claude.*` code. The `.d.ts` files read for this design are
a snapshot; the skill serves the live roster and the exact declaration shape, and transcribing a
contract from a bundled type file is how a version skew ships as a bug.

## Where the React host stands

**It does not exist.** There is no React anywhere in `src/` — §23's "stock React HOST whose router is
DERIVED FROM THE STORE" is prose with no implementation, and §23.11 lists the live browser host,
client hydration, and the subscription transport as deferred design-stage units. T79 should not build
it.

**Recommendation 9 — T79 narrowly targets the artifact host, and it is Loam's second host and first
client-side one.** The claim that makes this the right order: the artifact shell IS a §23.2 host — it
holds the keys (the connector), hands the renderer a resolved view and nothing else, and injects
write capability as a handle (the intercepted form → `loam_mutate`). So the seam T79 introduces —
*coordinates + a data client + the bundle's `RenderFn`* — is exactly the seam the React host will
reuse, with `fetch`/SSE against `/:mount/graphql` and `/:mount/subscribe` in place of
`window.claude.mcp`. Building the artifact host first is therefore not a detour around the React
host; it is the client-host seam being paid for once, by the target that needs no infrastructure to
demonstrate. The React host becomes a swap of the data client. **This is worth Myk's explicit word**
— the ticket title says "EITHER … OR", and this recommendation delivers one arm plus the seam rather
than both arms. **(Myk)**

## Sequencing with T78

**T79's contract needs nothing from T78; T79's DEMO does.** A statically-mounted gateway already
serves `/:mount/mcp`, so every criterion below is satisfiable against a static mount. And because the
mount lives in the CONNECTOR's URL rather than in the page, the coupling is even looser than the
ticket's edge assumed.

What T78 unlocks is the story: "ingest this module and run it, now" needs a container spawned at
runtime to be reachable at its own mount, or the viewer has no URL to point a connector at. So keep
the edge for ordering, and note that T79 stays buildable if T78 slips.

One genuine interaction, worth a rail: a connector pointing at a REMOVED mount must surface as a
legible degraded state in the page, not a blank screen — T78 promises "a dangling mount must 404,
never 500", and the page's job is to turn that into the `server_not_connected`/`upstream_error`
rendering with its onboarding copy.

## What this does NOT decide

An anonymous (tokenless) MCP door — flagged for Myk above, deliberately out of scope. Pinned reads
over MCP (the named follow-on behind refusal 1). The React host itself (§23.11's deferred unit,
though this spec fixes the seam it will use). Non-custodial client signing — the viewer's *key* never
enters this design, only their *identity*, and §23.3's user's-own-pen variant still waits on the
browser host. Chunked bundle economics (§23.10) and what happens when a bundle exceeds an artifact
page's practical size. Multi-entity or entity-choosing pages: the page's identity is `(route,
entity)`, exactly as the host route's is. Rating, discovery, and the manifest conventions a published
artifact might carry (T77). And the §29/§30 numbering, which is a landing-time detail.

## Acceptance criteria (T79's build transcribes these; each names its verification)

1. **One bundle, two hosts, one content address.** After packing a declared route: the bundle bytes
   recovered from the emitted page content-address EQUAL `binding.bundle`'s
   (`esmAddress(recovered) === esmAddress(binding.bundle)`), and the same binding still serves its
   HTML unchanged at `GET /:mount/app/<route>/<entity>`. No `target` role exists in the binding's
   claims (the delta's pointer roles are asserted as the pre-T79 set). — `test/gateway/artifact-pack.test.ts`
   (delta level: the binding's roles and the recovered bytes; object level: both doors' answers).
2. **Publication is a declaration, and it fail-closes both ways.** `packArtifact` on an UNDECLARED
   route refuses with the uniform refusal; after `declareArtifact([route])` it emits a 200 page; after
   negating that declaration it refuses again on the very next request with no restart. — `test/gateway/artifact-pack.test.ts`.
3. **The page carries no data.** With a distinctive sentinel value stored in the packed entity's
   consumed field, the emitted bytes contain neither the sentinel nor any other resolved field value,
   nor any configured token, nor any seed. — `test/gateway/artifact-pack.test.ts` (asserted over the
   emitted bytes, and negatively over the whole token table so a renamed field cannot hide a leak).
4. **The page requests nothing from an external host.** The emitted page references no `http(s)` URL
   as the target of any `fetch`/`XMLHttpRequest`/`WebSocket`/`import`/`src`/`href`, and contains no
   `eval` or `new Function`. The store's URL appears at most inside the human-readable
   `server_not_connected` copy. — `test/gateway/artifact-pack.test.ts` (static scan over the bytes),
   plus `test/site/artifact-shell.test.ts` loading the page in a harness whose `fetch`,
   `XMLHttpRequest`, and `WebSocket` are traps that fail the test if called.
5. **The read is LIVE, and it is a watch.** In a harness with a stubbed `window.claude.mcp`: loading
   the page registers exactly one `watchTool` against `(server, "loam_query")`, whose document names
   the binding's lens and every field in `consumes` and nothing outside it; delivering a second
   `{type:"data"}` event with a changed value re-renders the mount point to the new value. — `test/site/artifact-shell.test.ts`.
6. **The manifest is minimal, enumerated, and never constitutional.** A read-only binding's emitted
   capability declaration lists exactly `["loam_query"]`; a write-enabled one exactly
   `["loam_query","loam_mutate"]`; `loam_register` appears in no emitted manifest, and a pack forced
   to emit it refuses instead. — `test/gateway/artifact-pack.test.ts`.
7. **`loam_query` cannot mutate, so its annotation is true.** `tools/call` with `name:"loam_query"`
   and a `mutation` document returns `isError` AND the store's delta count is byte-for-byte unchanged;
   the same document under `loam_mutate` succeeds and the count grows. `tools/list` reports
   `annotations.readOnlyHint === true` for `loam_query` and `false` for `loam_mutate` and
   `loam_register`. — `test/server/mcp-tool-honesty.test.ts` (delta level: the ground before/after;
   object level: what the door answered). This rail must fail if the mutation-refusal is reverted.
8. **Identity rides the connector, not the page.** The SAME emitted bytes, driven by two stubbed
   connectors whose tokens map to two different `TokenIdentity` entries, render two different
   readings; a token with no read standing on that lens renders the refusal path rather than partial
   data. Neither token appears in the page. — `test/site/artifact-shell.test.ts` + `test/server/mcp-tool-honesty.test.ts`
   (the two identities' answers over real HTTP).
9. **The pen never rides an artifact.** Packing a pen-holding binding refuses without the explicit
   acknowledgement and names the pen; with it, the emitted page contains the pen name nowhere and
   displays whose identity writes. The host route's `POST` still signs as the pen, unchanged (the
   existing §23.3 behavior is asserted in the same test so a regression here is visible). — `test/gateway/artifact-pack.test.ts`.
10. **The artifact write is the viewer's own §14 write, and grants nothing new.** Through the shell's
    intercepted form: the landed delta's author is the VIEWER's actor, not the pen; a viewer token
    with no write standing gets the store's own refusal; and the identical mutation document sent
    directly to `/:mount/graphql` with that token refuses identically. — `test/server/artifact-write.test.ts`
    (delta level: the author of what landed; object level: both doors' refusals agreeing).
11. **A narrower binding `writable` does not ride silently.** Packing a binding whose `writable` is a
    strict subset of the schema's refuses, naming both sets; with the acknowledgement it proceeds and
    the emitted page says which allow-list actually binds. — `test/gateway/artifact-pack.test.ts`.
12. **A version-pinned binding refuses rather than packing the latest.** Packing a binding with a
    `versionId` refuses, naming the pinned-read gap; the store's latest reading is NOT emitted, and
    the page bytes are absent entirely (no partial emission). — `test/gateway/artifact-pack.test.ts`.
13. **Declared bytes refuse; an undeclared bytes leaf degrades legibly.** Packing a binding consuming
    a field the schema declares `bytes` refuses with the CSP reason. And in the shell harness, a
    delivered payload carrying a ref-only envelope renders a legible placeholder while an inline
    `base64url` envelope renders as a `data:` URI — neither produces a request to the byte-door. — `test/gateway/artifact-pack.test.ts`
    + `test/site/artifact-shell.test.ts`.
14. **Withdrawal darkens the emission and the route together.** Negating the renderer binding makes
    `packArtifact` refuse AND `GET /:mount/app/<route>/<entity>` 404 on the next request; erasing
    (§11) the binding does the same and the tombstone refuses its re-entry. — `test/gateway/artifact-pack.test.ts`
    (both acts, both levels).
15. **Degraded states branch on `code`, and the page is never blank.** The shell harness feeds
    `server_not_connected`, `needs_reauth`, `not_granted`, and `server_unavailable`: four distinct
    renderings, each naming its own fix, with the connector display name and MCP URL present in the
    `server_not_connected` copy. `needs_reauth` and `server_not_connected` produce ZERO retry calls;
    `server_unavailable` produces at most one. And with `window.claude` absent entirely the page still
    renders its static shell (non-empty body). — `test/site/artifact-shell.test.ts`.
16. **The pack door does not exist to a non-operator.** `GET /:mount/artifact/<route>/<entity>` with
    an actor token, with no token, and with a bad token returns a response byte-for-byte identical to
    the one an unknown verb returns — no distinguishable status, body, or header. — `test/server/artifact-door.test.ts`.
17. **The CLI is a thin client of the door.** `loam artifact pack <mount>/<route>/<entity> --connector <name> --out page.html`
    writes bytes byte-identical to the door's body, and refuses with the identical message on every
    refusal in criteria 2, 9, 11, 12, and 13. — `test/cli/artifact.test.ts`.
18. **A dangling mount degrades, never blanks.** With the connector pointing at a mount that has been
    removed (T78's `removeMount`, or a mount that never existed), the page renders its degraded state
    with the onboarding copy rather than a blank or partially-populated view. — `test/site/artifact-shell.test.ts`
    (harness), and `test/server/dynamic-mounts.test.ts` for the 404-not-500 half if T78 has landed;
    if T78 has not landed, this criterion is asserted against a never-existent mount and the test
    file NAMES the gap and which rail closes it.

## Open for Myk

1. **One arm plus the seam, not both arms** (Recommendation 9). T79 builds the artifact host and the
   client-host seam; the React host stays a deferred §23.11 unit. Is that the right read of "EITHER …
   OR"?
2. **No anonymous MCP door.** Recommended unchanged: an artifact with no connector reads nothing.
   Opening a tokenless MCP surface is a separate trust decision.
3. **Writes allowed, pen refused** (Recommendations 7 and 8). The artifact writes as the viewer, so
   the pen cannot travel and the binding's `writable` narrowing does not bind — both refuse at pack
   time unless acknowledged. The alternative (read-only artifacts in v1) is smaller and cuts the
   demo's write half.
4. **The two refusals that trade scope for honesty**: a version-pinned binding and a declared-`bytes`
   field both refuse rather than degrade. Each names a small follow-on (a pinned read over MCP; inline
   or `data:`-rewritten bytes). Confirm the refusals rather than the widenings.
5. **Section number** — §30 recommended, since §29 already has two claimants (T64 and T77).
