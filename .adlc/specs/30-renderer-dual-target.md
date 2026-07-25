# T79 — The dual target is a HOST, not a renderer: a Loam app publishes as a Claude Artifact that speaks to the viewer's own store

**Ticket.** T79. **Depends on** §23 (renderers), §17 (surfaces), §12 (the open door), §6 (two keys),
§7 (the mount is the read boundary). **Edge:** T78 (dynamic mounts) — needed for the demo path, not
for this contract (see *Sequencing*). Design-stage: this spec carries reasoned recommendations; **the
decisions are Myk's at the PR**, because it lands on the publication and capability surfaces.
**Proposed section number: §30** — `spec/30-artifact-host.md`. (§29 is claimed by BOTH T64
*slating-and-graveyards* and T77 *the hub*; that collision is pre-existing and worth resolving
separately, but T79 should not become a third claimant.)

An independent premortem read this design cold against the code and returned six confirmed
narratives. Two of them changed what the ticket BUILDS rather than what it asserts: **the bundle's
realm** (§*Confinement* — the artifact target is the first host where a renderer holds authority at
all, so the bundle must be confined; Recommendation 9) and **the emitted page's residual** (an
already-published page is the one thing withdrawal cannot reach; Recommendation 11). The other four
narrowed or repaired criteria that were hollow, contradictory, or unsatisfiable as first written; each
is noted where it landed.

**CONFINEMENT IS DECIDED (Myk, 2026-07-25, in chat), and the decision widened the ticket.** His words:
*"I'd rather spec out the complex complete thing than ship a demo we have to walk back later. There
will be an elegant solution we just have to find it!"* So Recommendation 9's sealed compartment is the
build, and this spec no longer describes a forms-only first version. The premortem was right that a
confined bundle cannot reach `window.claude`, and right that this costs the DATA path nothing — the
shell resolves the view and hands it over. What it left unspecified is everything past a single form:
pagination, search, drill-down, following a relation — every case where the rendered app wants MORE
than its `consumes` set. In a sealed compartment that is a **mediated request channel**: the app asks,
the shell decides, the store answers. §*The mediated request channel* designs it, and it is where the
elegant solution turned out to be hiding twice over — the app never asks *at runtime*, and **the
capability declaration already existed.**

**THE APP MODEL — DECIDED (Myk, 2026-07-25, in chat), and it is the sentence the whole request surface
collapses into.** *"A 'renderer' is one part of an 'app' — an app fuses a renderer to its data through
a schema. If I build an app and send it to my friend, I'm sending deltas for the renderer and the
schema, and maybe some seed data too, but their app when they run it is served against **their** loam
not mine."* And on capability: *"the renderer can do whatever the schema allows, and the schema is
provisioned with read and write access based on the user that has deployed it. So I write the app, I
send it to you, you install it, it builds the schema, it serves that schema up via MCP, the renderer
hits the schema — it's **your** credentials, into **your** store."*

**A SECOND independent premortem read this round's new material cold against the code and returned eight
confirmed findings — every one repaired in place, and three of them changed the design rather than a
criterion.** The three: the shell **cannot enumerate a gesture-chosen lens's fields** (GraphQL has no
wildcard, names are `legal()`-mangled), which forced the projection to `_view` and simultaneously fixed a
divergence where the two hosts handed the same bundle different view sets; **reads are identity-independent
inside a mount** (`hooks.resolve` takes no identity — only mutations read `ctx.actor`), which corrected
four sentences of the trust story and made two rails satisfiable; and **`terminate()` does not empty a
worker realm** (`indexedDB` / `caches` / `BroadcastChannel` survive it), which is the one memory §11 was
invoked to reach. The other five: MCP broker codes cannot cross into the bundle's node (no broker exists on
the server host), pagination state had nowhere legal to live, `asOf` is a surface axis the capability
statement did not name, a substring scan would have refused nearly every real React bundle while its rail
stayed green, and the write-pin vs no-read-filter asymmetry needed its reason stated. Each landing is
marked where it lands; the criteria carry the "what is deliberately NOT asserted" notes.

An earlier draft of this round designed a new capability vocabulary for the request surface — declared
readings, entity domains, a `reads` role at rest, a shell-side validator. **All of it is retired**, and
the reason is worth stating rather than quietly deleting: it was a second declaration of a fact the
model already declares. **The SCHEMA is the request surface.** It is the artifact the viewer installs,
it names every readable field and every writable one, it is readable BEFORE installing, and it is
already governed by §21 law with a frozen version identity. A parallel capability system beside it
would have been a near-synonym for a thing that exists — the failure mode CLAUDE.md's vocabulary rule
exists to prevent — and worse, a shell-side allow-list would have been a boundary that looks like
security and is not, since the page is the viewer's own file (criterion 36). §*The mediated request
channel* is now much shorter, and it names the ONE gap the schema genuinely cannot cover.

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
§23.6 ("an app never outlives its source") extends to **the emission**: strike the declaration and
the door stops emitting on the next request.

**The third thing: the page a stranger already holds.** An earlier draft of the paragraph above said
§23.6 extends "for free," and that was the most comfortable false sentence in this spec. Withdrawal
reaches **two** things — the declaration (the door stops emitting) and the binding (the host route
404s). The emitted page is a **third** thing, and it is the only one Loam does not hold. Its data
path is `loam_query` + a lens name + a field list, with no relationship to the renderer binding
whatsoever; nothing in it is re-derived from surviving law. So after the operator negates the binding,
or the `loam.artifact` declaration, or evolves the schema, every already-emitted page keeps working:

- the **withdrawn bundle keeps rendering**, in whatever tab or link still holds it;
- a **widened `writable`** in a v2 schema becomes reachable through a page whose acknowledgement
  (Recommendation 8) was given for the narrow set;
- a **dropped `consumes` field** paints `undefined` where a value used to be.

Criterion 14 asserts the emission and the route darken together. It does not — and cannot — assert
anything about a file in someone else's browser. The honest statement of this target's property is an
**asymmetry**: for the artifact host the **DATA** never outlives its source (criterion 3 proves it at
the bytes — zero view data is emitted, so there is nothing to outlive), and the **CODE** always does.
That is the reverse of the host target, where the code is re-derived per request and the data is
never persisted at all. Recommendation 11 says what to do about it.

**Recommendation 3 — the pack door lives on the GATEWAY, not the CLI**, as the ticket recommends and
for the reason it gives: withdrawal must be live. A CLI build step reading a file would keep emitting
a page whose binding, schema version, or declaration had been struck. On the gateway the emission is
re-derived from `readRenderers` on every call, exactly as `serveRoute` is. The CLI verb
(`loam artifact pack`) is then a thin HTTP client of that door — the same "one shape for every door"
discipline `parseRendererInput` already enforces, so a refusal reads identically from HTTP, the CLI,
and a direct call.

**The pack door is OPERATOR-ONLY, and to every other identity it does not exist** — the idiom `health`
already established in `src/server/http.ts`. The reason is specific: the emitted page contains the
renderer's BUNDLE SOURCE verbatim, which no existing door discloses (`serveRoute` discloses only the
bundle's output). Deciding to publish your code is the operator's, and so is the emission that
carries it.

**"Does not exist" has TWO uniform shapes, not one, and the door must match the right one.** An
earlier draft asked for a single response byte-identical across an actor token, no token, and a bad
token — which `src/server/http.ts` cannot give and should not, because a bad or absent token never
reaches the verb switch at all. It is refused before mount resolution matters, precisely so an
anonymous prober learns nothing about which mounts exist:

| caller | what the server already does | the uniformity being preserved |
|---|---|---|
| token-bearing non-operator | 404 `{"errors":["no such surface"]}` | uniform **across verbs** — this door looks like every unknown one |
| no token, or a bad token | 401 `{"errors":["a bearer token is required, and this one opens nothing"]}` | uniform **across mounts** — no 404-vs-401 oracle |

Two different families, both deliberate, and the code is right. So the rail is: to a token-bearing
non-operator, byte-identical to the unknown-verb 404; to a token-less or bad-token caller,
byte-identical to the server's existing uniform 401. Neither reveals that `artifact` is a verb the
server knows.

## What the page names, and what it deliberately does not

This is the headline, and it is stronger than the ticket anticipated.

The artifact CSP blocks every request to an external host, so the page cannot fetch the store. The
data path is therefore `window.claude.mcp`, whose addressing is settled and consequential: `server`
is the connector's **display name**, never an id, "because a published page runs for many viewers"
(`mcp.d.ts`). The connector holds the URL — including the mount path — and the credential.

Therefore the emitted page names: **a connector display name, a tool name or two, a lens name, an
entity, and the `consumes` field list.** It does not name a host, an origin, a mount, a token, a
seed, or a single byte of view data.

Which means the wedge in the strategy note is not a thing we build toward — it falls out. **The page's
DATA PATH is store-agnostic**: a connector display name, a tool name, a lens name, an entity, and a
projection (`_view`) that needs no field list — so the same bytes read whichever store the connector points
at, and no `legal()`-mangled field name is frozen into them. Be exact about what IS frozen, because an
earlier draft over-claimed here: the capability statement (Recommendation 17), the acknowledged `writable`
set (criterion 25), and the `consumes` list are all pack-time text from the store that packed the page.
Under the federation model that is coherent — the VIEWER's own gateway packs their page from their own
surviving law — and it would be a lie if one operator's page were handed to a stranger's store. Which is
the other reason distribution is federation rather than a link.

**But the distribution channel is NOT a public link, and the earlier draft of this paragraph said it
was.** The live capability contract is explicit that a page declaring an `mcp` manifest **cannot be
shared publicly** — the manifest is a viewer-consented grant, so the runtime will not hand it to
anonymous strangers. Read against Myk's workflow this is not a limitation; it is the workflow. The app
travels as **deltas through federation** (§8/§12), not as a URL: build it in a chat → push it to your
store → federate the renderer binding to a friend → they accept it (inert until blessed) → their own
Claude, on their own connector, packs and renders it against their own store. Each viewer's page is
emitted for that viewer, from their own surviving law, which is why the capability statement
(Recommendation 17) belongs on the **federated offer** and not only on the page. The store-agnostic page
is what makes the bytes identical for everyone; federation is how they get there. **(Myk)** — this
re-tells the demo story, so confirm the telling.

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

**And the annotation has a consequence on the READ side that cuts the other way, which is the one
this spec nearly missed.** `readOnlyHint: true` is also what makes `loam_query` *watchable* — and
watchable means **cached**, by default `{staleTime: 0, gcTime: 5min}`. `watchTool` replays a cached
entry immediately on registration with `revalidating: true`, so any re-boot of the page inside that
window — a restored tab, a live version update, a hidden→visible transition — paints the PREVIOUS
answer before the current one lands. For an ordinary app that is a feature. For a store that can be
ordered to FORGET (§11), it is a copy of erased content living on the viewer's side of the wall,
where Loam has no reach at all: no negation, no tombstone, and no request the gateway could refuse.
The second half is worse. The runtime's retention doctrine keeps last-good data on a **transient**
error and retracts only on an authorization denial — and a GraphQL refusal from `loam_query` arrives
as `tool_error`, which is not an authz denial. So erasing the deltas without also revoking the
viewer's token can leave forgotten content painted indefinitely, under a spinner. **The only lever we
hold is the declaration at pack time** — Recommendation 12.

**The token model maps to the connector one-to-one.** Loam's table is opaque bearer token →
`TokenIdentity` (`{ actor }` or `{ operator: true }`), compared timing-safely. A connector is
configured by the VIEWER with the MCP URL and their own bearer token; one connector is one token is
one identity, and the page never sees it (`window.claude.mcp` runs "with the viewer's credentials;
your code never sees tokens").

**And per-viewer isolation is the MOUNT, for reads — not the token. This spec had it wrong and the code
is unambiguous.** `SurfaceHooks.resolve(schemaName, entity, asOf?)` takes no identity
(`src/surface/surface.ts`), and every GraphQL query field resolves with
`hooks.resolve(lensOf(def), args.entity, …)` — the context value is not even a parameter
(`src/gateway/gql.ts`). Only the MUTATION resolvers read `ctx.actor`. `Gateway.surface(door)` hands every
caller the same hooks over one schema built once. So **two distinct actor tokens on one mount get
byte-identical readings**, and "a token with no read standing on that lens" does not exist on the full
door. §7 says so in its own words: *one mount = one store = one isolated world*, and what a token
individuates is WRITE standing.

Restated correctly, then, and it costs the design nothing: **the read boundary is the mount the connector
points at; the write boundary is the token's own author standing.** Per-viewer isolation is a separate
mount — their own store or container, which is exactly where T78 earns its edge — and a shared mount with
distinct actor tokens isolates writes, not reads. Everything else in this section survives, because the
page never held either boundary; it holds coordinates.

**And note what is absent: there is no MCP door on the public branch.** `case "mcp"` appears only in
the token switch of `src/server/http.ts`; the anonymous door serves `graphql`, `subscribe`,
`openapi.json`, `rest`, `app`, `bytes` and no MCP. So an artifact with no connector reads nothing at
all — not a narrowed public view, nothing. That is the correct default and this ticket should not
change it: opening an anonymous MCP door is a new tokenless authority surface and deserves its own
decision. **(Myk)** — flagged, not assumed.

## Trust: which door, and whose hand writes

**The content comes from the FULL door, under the viewer's own connector.** Because the MCP door is
token-bearing, the artifact is not outward-facing publication of CONTENT; it is publication of a
READING. The page shows exactly what the STORE that connector points at serves — enforced at §7's mount
boundary, not by a per-token read filter (see the correction above) — and it writes as that token's own
author. The page itself is public and inert.

**Writes are the viewer's own, and never a pen.** §23.3's pen is server-side custody by construction:
the seed lives in `GatewayOptions.pens`, and `writeRoute` signs the delta AS the pen so provenance
shows the mediating code. An artifact has no server and no seed. Its write is `loam_mutate` on the
viewer's connector, which the door executes with `contextFor(identity)` — the viewer's actor. So:

- **Recommendation 7 — the pen never rides an artifact, and the pack door refuses to pretend
  otherwise.** Packing a pen-holding binding without an explicit acknowledgement REFUSES, naming the
  pen. This is T31's criterion-9 shape ("a pen never rides the sugar") at a different door, and the
  reason is the same: the same route writing under two different identities depending on which host
  served it is a provenance lie unless someone said so out loud.

  **What "never rides" means is CUSTODY, not absence of the string — and the first draft got that
  wrong in a way no implementation could satisfy.** It asked for three things at once: the bundle
  rides verbatim and content-addresses equal (criteria 1 and 4), *and* the emitted page contains the
  pen name nowhere (criterion 9). Those contradict for exactly the bindings that COMPLY with §23.3 —
  because §23.3's rule is that a host must SHOW which pen a mounted renderer writes under, so a
  compliant renderer displays the pen, so the pen's name is IN THE BUNDLE SOURCE, so it is in the page
  the moment the bundle rides verbatim. No implementation satisfies all three; under pressure the
  unsatisfiable one gets quietly narrowed to "the SHELL declares no pen," and then the page displays
  a FALSE provenance claim inherited from the bundle while the writes land as the viewer. The absence
  rail would have manufactured the exact lie it was written to prevent.

  The pen's **SEED** is what was ever at risk, and it is safe by construction: it lives in
  `GatewayOptions.pens`, server-side, and no artifact has a server. Criterion 3's negative assertion
  over the whole token table already covers it. So the real obligation is not absence — it is **the
  last word**:

  - **Pack-time, decidable:** refuse a bundle whose SOURCE contains the pen name unless the operator
    acknowledges. The packer already holds the source; this is a substring, not a judgment. It makes
    the operator look at "this renderer says it writes as `editor`, and on this host it will not"
    exactly once.
  - **Runtime, structural:** the shell's writer-identity statement is the **LAST** writing-identity
    claim in the DOM, rendered *outside and after* the bundle's mount point. The bundle may say
    whatever it says; the host gets the final sentence, and the viewer reads the host's. That is
    §23.3's rule honored at this host rather than voided by it.
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

## Confinement: the artifact is the first host where a renderer holds authority

**State it plainly, because everything in this section follows from it: on the host target a renderer
bundle holds ZERO authority.** It receives an enveloped node, returns a string, and never touches a
door. That is exactly why two deferrals were cheap — §23.9's honest-scope note ("a Worker bounds the
hang, not ambient authority") and §24's deferred object-capability quarantine. A bundle that can
`import('node:fs')` on the operator's own server, in a thread whose only output is HTML the operator
already trusted enough to sign and mount, is a residual worth naming and not worth paying for yet.

**On the artifact target the cost changed, and this spec inherited the deferrals without noticing.**
The mechanism is the mount itself. The shell imports the bundle from a `data:`/`blob:` module URL —
deliberately, per Recommendation 1, so the bytes that were signed are the bytes that run — and a
module imported from such a URL executes **in the page's own realm**. The artifact kernel has already
installed and locked `window.claude` on that realm. So `window.claude.mcp` is **ambient** to
operator-authored bundle code, and the reach is one line:

```js
window.claude.mcp.callTool(SERVER, "loam_mutate", { mutation: "…" });
```

That writes **as the viewer**, with no form, no gesture, and no shell involvement — and not merely the
`writable` setters the binding acknowledged. It reaches `gql.ts`'s whole mutation root: `_clear*`,
`_remove*`, `_link`/`_sever`, the claim templates, `_claim`. Reads are the same story with
`loam_query`: any lens the viewer's token opens, not just the fields in `consumes`. On a **shared
multi-tenant mount** — §7's common case, one mount with distinct actor tokens — that is a bundle
reading entities and fields far outside its declared appetite and writing them somewhere the operator
can read them, under an identity that is not the operator's.

**CSP does not help, and the reason is worth internalizing.** CSP is precisely why criterion 4's traps
work: `fetch`, `XMLHttpRequest`, and `WebSocket` are already dead on this page. `window.claude` is the
one channel CSP does not block — it is the channel the artifact runtime exists to provide. The three
doors this spec proved closed were never the open one.

**The rails as first drafted could not see it, which is the part to learn from.** Criterion 5
inspected the SHELL's own `watchTool` registration — hollow against a caller it never looks at.
Criterion 4's harness trapped `fetch`/`XHR`/`WebSocket` and not `callTool`. Both rails were correct
about what they asserted and blind to the thing that mattered, because both were written from the
premise that the bundle is a pure function. It is a pure function by *signature*; it was not going to
be one by *reach*.

**Recommendation 9 — the bundle runs CONFINED, in a realm where `window.claude` does not exist.**
**DECIDED (Myk, 2026-07-25)** — *"the sealed compartment is right … there will be an elegant solution
we just have to find it."* The argument that earned it:

`RenderFn` is `(node: RenderNode) => string`, pure and synchronous. That signature is the whole reason
confinement is cheap *here* and would be expensive almost anywhere else — there is nothing to plumb
across the boundary but one structured-cloneable value in and one string out. Confinement is a dozen
lines, not an architecture.

- **Recommended: a Web Worker, spawned PER RENDER.** A module worker's global scope has no `window` and
  no `document`, so `window.claude` is not filtered — it is **absent by construction**.
  `postMessage({ bundle, node })` in, `{ kind: "ok", html }` back, written into the mount point exactly
  as the server writes it into a response body. That is not merely *similar* to
  `src/gateway/render-worker.ts` — it is that file's protocol, message for message, including its
  `notHtml` / `fault` folds. And the per-render lifetime is the server's too: `renderInWorker` spawns a
  Worker, posts one message, and terminates it in `finally`, every render. Adopting the same lifetime
  buys three things at once — the time bound (a worker can be terminated), the structural symmetry
  Recommendation 1 has been claiming, and, unexpectedly, the whole answer to what a compartment may
  RETAIN (§*What forgetting costs*): a bundle handed a fresh realm per render cannot hold a copy of
  anything across renders, because there is nothing for it to hold the copy in.
  T73's lesson transfers with the protocol: **two clocks, not one** — arm a SPAWN bound at construction
  and re-arm a fresh RENDER bound when the worker signals it is live, or a slow spawn under a loaded tab
  charges startup against the render's budget and times out legitimate work.
- **Fallback: a sandboxed sub-frame** (`<iframe sandbox="allow-scripts">`), whose realm is its own and
  onto which the kernel installs nothing. Weaker on the merits: it keeps a DOM the `RenderFn` contract
  does not need, it needs the same `postMessage` plumbing anyway, and `allow-scripts` is a coarser
  dial than a global that simply is not there. Use it only if a runtime refuses worker construction
  under the artifact CSP.
- **Not an option: deleting `window.claude` before importing the bundle.** It is a filter on a locked,
  kernel-installed object in the same realm the shell itself needs it in — and same-realm means any
  surviving reference, closure, or re-derivation wins. Confinement is a boundary, not a scrub.

The rail has to count traffic rather than look for a string: trap `callTool` **and** `watchTool` at the
single seam the shell owns, and assert that TOTAL MCP traffic equals the shell's own calls — driven by
a fixture bundle that deliberately attempts one. A fixture that tries and fails is the only evidence
that the boundary is load-bearing rather than decorative.

## The mediated request channel — the app is renderer + SCHEMA, and the schema is the surface

The compartment is sealed, which settles authority and opens a design question the forms-only sketch
never had to answer: **an app that wants more data than its `consumes` set cannot go get it.** Every
interesting interaction is that case — a second page of a list, a search box, a click into a detail
view, following a relation.

**And the answer is not a new capability system, because the app already ships its own.** Myk's app
model (above) is the load-bearing sentence: an app is a renderer FUSED TO A SCHEMA, both travel as
deltas, and the friend who installs it registers that schema in their own store, which then serves it
over MCP under their own credentials. So:

> **An app may ask anything its schema exposes, at any entity, and nothing else — because the schema is
> the thing the viewer installed, and the viewer's own token is what resolves it.**

That single sentence answers three of the six questions, and the code agrees with it exactly.

### Why the schema IS the declaration — read the query root, then read what a registration already says

**Loam's entire read root is entity-addressed, and every degree of freedom in it comes from the
schema.** `buildGqlSchema` emits, per REGISTERED lens, one query field — `<lens>(entity: ID!, asOf:
Float)` — whose type carries one field per `schema.props` (legal-mangled) plus the meta set, one
subscription field, and mutation fields for exactly the props in `writable` plus the registration's
named claim templates (`src/gateway/gql.ts`). There is **no list query, no filter argument, no cursor,
no `first`/`after`, and no free-text search anywhere.** A caller's only choices are *which lens, which
entity, which fields, which moment* — and the first and third of those are fixed by the registration.

So a registration is already a complete, legible, versioned statement of *what may be read and what may
be written*, published under §21 law with a frozen version identity. Note what that gives for free,
without a line of new vocabulary:

- **Readable set** = the lens's props. Not a subset of them, not a superset: what `buildGqlSchema` built.
- **Writable set** = `writable` plus the claim templates, and §21's **immutable-by-default** already
  fail-closes it — *"absent `writable` → NO prop is writable"*.
- **Frozen and inspectable before installing** = §21's version identity, so a viewer can read the schema
  they are being asked to adopt, and an app cannot swap it without minting a different version.
- **Scoped to the viewer** = §7's MOUNT boundary for reads (`hooks.resolve` carries no identity), and
  `contextFor(identity)` — the token's own author standing — for writes. Two different mechanisms, and
  §*What the page names* has the correction that says why conflating them was wrong.
- **What it does NOT bound, stated because criterion 32 depends on it:** the schema names fields, not
  MOMENTS. Every query field carries `asOf` and every view type carries `_asOf` / `_forgotten`
  (`src/gateway/gql.ts`), so an installed schema is also a licence to read those fields' HISTORY. Erasure
  still wins — `groundAsOfImpl` filters the surviving snapshot — but a RETRACTED value is legible at an
  earlier moment. The shell composes no `asOf` today (criterion 30 asserts its absence) and the capability
  statement names the time axis anyway, because a future gesture verb could carry one.

**Recommendation 14 — the request surface is the app's own SCHEMA, and T79 adds no capability
vocabulary at all.** The gesture names a lens and an entity; the shell issues `loam_query`; the STORE
answers or refuses. What bounds the app is the pair (*the schemas this viewer installed*, *the MOUNT their connector points
at*) — two existing boundaries, both governed, neither invented here. Note which the second one is not: a
per-token read filter, which does not exist (§*What the page names* has the correction).
An earlier draft of this round proposed declared readings with entity domains and a shell-side
validator; it is retired, and the three reasons it was wrong are each worth keeping:

- **It duplicated a declaration the model already makes.** A `reads` role beside `consumes` and
  `writable` would be a near-synonym for the registration — precisely the parallel-vocabulary failure
  Loam's naming rule forbids.
- **A shell-side allow-list is a boundary that only looks like one.** The page is the viewer's own file;
  they may edit the embedded declaration freely (criterion 36 asserts what happens when they do). A
  guard on that side of the wall constrains the APP, never the viewer — which is fine as an appetite
  statement and dishonest as a capability claim.
- **It would have made an app less portable than its own schema.** The whole point of Myk's model is
  that the same app runs against a different store; a second declaration frozen into the page at pack
  time is one more thing that can disagree with the store the app actually met.

**Recommendation 16 — the answer to "where does the declaration live at rest" is NOWHERE NEW.** This is
worth its own number because it is the question that most looked like it needed vocabulary, and the answer
is that both halves already have homes: the request surface lives where the SCHEMA lives (§21's
registration, versioned, frozen, inspectable), and the app's appetite lives where it already lives (the
binding's `consumes`). Nothing is added to `rendererBindingClaims`, so §23.5's latest-per-route law is
untouched, §20 owes no migration, and there is no new at-rest shape for a future reader to misparse.

**What `consumes` becomes, precisely: the FIRST-PAINT appetite, not the boundary.** It keeps exactly the
job `publishRendererImpl` gives it — proven at push against the pinned reading's props (§23.4), so a
renderer can never name a field its lens cannot fill — and it is what the shell's root `loam_query`
document asks for. It was never a capability bound and this spec should not promote it to one.

**And what a version bump means, since the earlier draft owed an answer.** Under Recommendation 14 the
answer is the ordinary one: re-registering the SCHEMA with a wider surface widens what any app over it may
read, on the next request, in every store that installed it — governed by §21's own version law and
readable in the capability statement, which re-derives. Re-pushing the RENDERER at the same route moves the
latest binding (§23.5) and changes what the app asks for on first paint, not what it may ask for. Neither
motion widens an already-emitted page's authority, because the page never held any (criterion 36).

**One structural consequence, stated because it is the only at-rest question left.** `RendererCore` names
a SINGLE lens (`schemaName: LensName`), so a renderer binding today is bound to one lens — while an app
fusing several (a `Note` lens and a `NotesByTag` index lens) needs to read more than one. Under
Recommendation 14 that costs nothing: the gesture carries the lens name, the shell asks, and the store
serves it if that lens is registered for this viewer. **No new role on the binding, no lens list, no
migration.** The binding's `schemaName` stays what it is — the lens the ROUTE is about, and the one the
root watch reads.

### The one real gap, named precisely: read-time parameters

Three of the four interaction shapes need nothing beyond Recommendation 14, and it is worth being exact
about which, because "we need a query language" is the conclusion a hurried reading reaches:

- **Drill-down and following a relation: no gap.** A relation field renders its targets as entity ids
  (`renderTarget`, `src/gateway/resolvers.ts`); following one is another entity-addressed read through a
  lens the viewer installed. This is the common case and it is free.
- **Pagination: no gap, but an honest COST.** A collection in Loam is an ENTITY whose field gathers its
  members, and an `all` / `concatSorted` policy hands over the whole id list in one resolved view
  (`fieldTypeOf`, `src/gateway/gql.ts`). There is nothing to paginate server-side; a page is a slice of
  a list the app already holds, so paging is usually a re-render with no store traffic at all. The cost
  is that the whole list crosses the wire once — real, bounded by §23.10's economics, and not a
  capability question.
- **Keyed search: no gap.** "Notes tagged *harvest*" is a lens the operator authored rooted at
  `tag:harvest` — the selection algebra lives in the hyperschema's `Term` (`select` / `intersect` /
  `difference` / `group` / `prune`, evaluated at `evalTerm(def.hyperschema.body, ground, entity,
  registry)`, `src/gateway/reads.ts`). Any search whose key is an ENTITY works today.
- **Free-text search: THE GAP, and it is one missing argument wide.** "Notes containing the word
  *harvest*" needs a value the viewer just typed to reach the SELECTION, and Loam passes no such value.
  rhizomatic HAS the mechanism — `Hole`, `Bindings`, `substituteHoles`, and `evalTerm` accepts a
  `bindings` argument (`pred.d.ts`, `eval.d.ts`) — and **Loam supplies it from no door**, so a lens with
  holes in its Term cannot be driven from anywhere.

**Recommendation 15 — name that gap as its own follow-on and design nothing for it here. (Myk)** — it is
the one piece of the request surface that genuinely needs new door vocabulary, so its scoping is his. Its
shape is already visible and reassuringly narrow: a lens whose Term carries `Hole`s, a read door that accepts
`bindings`, and a decision about what a caller may bind. The narrowness is the point — **a hole binds a
PRIMITIVE, never a Term** (`Bindings = ReadonlyMap<string, Primitive>`), so the caller supplies values
into a query the operator wrote, which is exactly the authority property "operator-authored parameterized
queries" was reaching for, arriving through §21/§22's own vocabulary instead of a new one. That is a
read-surface change with its own disclosure question, and it is not T79's. Until it lands, an app that
needs free-text search ships an operator-authored index entity per term or does its filtering
client-side over a list it already holds — both honest, both limited, and the limit is named here rather
than discovered by a viewer.

**And a caller-supplied `Term` stays refused on the merits, not deferred.** Handing an app the gather
algebra means `select` over the whole ground and `inView` subqueries — the widest disclosure surface in
the system — and "validate the Term against a declared bound" means a static analysis of an algebra,
which is the kind of guard that is defeated once and trusted forever.

### What a viewer sees before accepting — derived from the schema

**Recommendation 17 — the capability statement is DERIVED, by one function, from the SCHEMA and the
binding, and no author-supplied prose reaches it.** The value is legibility at the moment of installing:
*"this app reads Post.height and Post.planted; it may write Post.height; it reads and writes as you, in
your store."* One function — `capabilityStatement(registered, binding, manifest)` in
`src/gateway/renderers.ts` — assembles that from the registration's props, its `writable` set, its claim
templates, the binding's `consumes`, and the tool manifest. Three properties, and the third is what
makes it non-lying:

- **(a) Author prose can never enter it.** The bundle SOURCE is not an input. A renderer whose markup
  claims "reads nothing" changes nothing, and the statement renders OUTSIDE and AFTER the mount point —
  the same structural rule criterion 9 uses for writer identity, for the same reason: the host gets the
  last sentence.
- **(b) It describes the SCHEMA's surface, including the axes that are easy to forget, and says whose
  credentials run.** §27.8's decided invariant is the model — *a manifest is an interface promise, not an
  access control*, and "internal" means not-advertised, never not-readable. So the statement names what
  the schema exposes and states that reading happens against the store this connector points at, and
  writing happens as the viewer's own author. Three things it must name that a fields-only reading of a
  registration would drop: **the whole resolved view** (the shell's projection is `_view`, which is wider
  than `schema.props` — Recommendation 18), **the time axis** (`asOf` / `_forgotten` are on every query
  field, so an installed schema is a licence to read those fields' history), and **the write templates**
  (`mutations`, not just `writable`). It does not imply a wall the page holds, because the page holds
  none. A label that overclaims is worse than none: T33's trap is the same shape one layer down —
  blessing code and granting its pen are different keys, and a label that conflates them lies.
- **(c) The label and the SERVER read the same value.** The statement is derived from the registration
  that the gateway actually serves, so it cannot drift from what a request will get: if the schema
  narrows, the statement narrows, and the store refuses the removed field either way. There is no second
  source of truth to keep in sync — which is the structural reason this label stays honest, and the main
  dividend of retiring the parallel declaration.

**Which door serves it: the ones that already exist, and NO new MCP read.** Three surfaces, one
function: (a) the **emitted page** carries it above the connector onboarding copy — the page is inert
until a connector exists, so "connect your store" IS the acceptance gesture and the statement sits in
front of it; (b) the **pack door** returns it for the operator's own review, where "look at this once"
already happens for a pen or a narrowed `writable`; and (c) — the surface Myk's workflow needs — the
**federated offer**, because installing an app is accepting DELTAS (§8/§12, inert-by-default) and the
moment a friend blesses a schema and a renderer binding is the moment "what will this app do in my
store" must be readable. §27.8's export table already lists both rows acceptance must range over
(`HyperSchema` / `Schema` / `renderer binding`, all LAW); this gives them their text.

**Does this subsume the premortem's `loam_manifest(route)`? No — and the two are easy to confuse.** The
capability statement answers *what does this app's schema expose*, decidable at pack time and derivable
in any store that installed it. `loam_manifest` answers *is this route still declared and bound, and at
what address* — a LIVENESS question about the operator's CURRENT law, asked at mount time by a page that
already exists. The first needs no new door; the second is a new read over constitutional publication
state, and it stays where Recommendation 11 left it: named, small, optional, and not this ticket.

### A Loam app is not free-floating: the store is its other half

**State the precondition in the spec's own voice, because it is a property of the design rather than a
limitation of the runtime (Myk, 2026-07-25):** *"artifacts as renderers for loam apps do require a host
store, they need MCP as their I/O … it's not like there's a 'general Loam app' they can be pointed at.
You wanna run a loam app you gotta have a loam server with MCP configured and your user has to be
associated with that somehow."*

The runtime agrees on every clause: the artifact CSP blocks every external host, so there is no
arbitrary HTTP I/O available even in principle, and `window.claude.mcp` is the only channel out. And
§*The tool manifest* already established the other half — there is **no MCP door on the public branch**,
so an artifact with no connector reads nothing at all, not a narrowed public view.

The consequence for the page is a posture, not an error path: **a page with no connector is in its FIRST
RUN, not in a failure.** `server_not_connected` renders "connect your store" onboarding copy — the one
place the store's URL appears, as text a viewer reads rather than a target the page requests — and the
static shell renders first so a viewer always sees something legible. A store the viewer has not
connected yet is the expected initial state of every app they install, and the copy says so. Calling
that an error would be the design telling a viewer they did something wrong on the way to doing the
right thing.

### The shell's mediation contract — and the elegant part: the app never asks

Here is where the sealed compartment stops being a cost. The obvious design is a channel: give the
worker a `request()` function, plumb `postMessage` both ways, await the answer. **Do not build that**,
and the reason is the signature. `RenderFn` is `(node: RenderNode) => string` — pure and synchronous.
An asking bundle is an async bundle, and an async bundle is a different contract on the artifact host
than on the server host, which is precisely the "one address, two envelopes" failure the next section
is about. The whole ticket's claim — one bundle, one content address, one behavior — would go.

**Recommendation 18 — a request is MARKUP, not a call. The renderer renders the gesture; the host
intercepts it.** §23.3 already established the idiom and this is the same motion: a write-enabled
renderer emits a `<form>` that POSTs to `/:mount/app/<route>/<entity>`, and the host intercepts submit
and routes it. A read gesture is an element carrying the request as data attributes —
`<a data-loam-read="NotesByTag" data-loam-entity="tag:harvest">`, or a `<form data-loam-read="…">`
whose field supplies the entity — where the read names **a lens and an entity, and nothing else**, which
is all the read root has to offer (Recommendation 14). The host intercepts the click or the submit
exactly as it already intercepts a write. Everything follows:

- **`RenderFn` is untouched**: pure, synchronous, no channel out of the compartment, no async. The
  worker protocol stays the ONE message `render-worker.ts` already sends. Criterion 19's traffic count
  is unchanged after any number of gestures, because the bundle's reach did not grow by a single byte.
- **The bundle needs no channel because it does not outlive the render.** With a per-render worker there
  is nobody inside to await an answer. Requests are gestures on markup that already exists.
- **The answer arrives as DATA on the next render.** `RenderNode` grows two members:
  `reads: Record<string, ReadResult>`, keyed `<lens>@<entity>`, where a `ReadResult` is either
  `{ entity, view, hex }` — the same shape the root node has — or `{ error: { code, message } }`; and
  `state: Record<string, string>` (below). Both are **always present and always objects**, empty until a
  gesture is honored, so the two hosts hand the bundle the same shape from the first render (an optional
  member would be exactly N6's one-address / two-envelopes bug in miniature).
- **The projection is `_view`, on BOTH reads, and this is a correction the draft owed.** A mediated read
  names a lens the page learned from a gesture, and the page cannot enumerate that lens's fields:
  GraphQL has no wildcard selection, and the field names are `legal()`-mangled store-side
  (`src/gateway/gql.ts`), so a store-native prop name does not even predict them. The three ways out are
  all barred except one — introspecting first costs a second call per gesture (breaking criteria 30 and
  33), and baking a per-lens field list into the page is the frozen second declaration Recommendation 14
  retires by name. So **every read the shell composes is `<lens>(entity:) { _entity _hex _view }`**, and
  `_view` is *"the whole resolved view, dynamic properties included"* (`gql.ts`).

  **And that fixes a divergence the `consumes`-only document had already created**, which is the more
  important half: `serveRouteImpl` hands the bundle `view: bytesEnvelope(node.view)` — the ENTIRE
  resolved view, which is wider than `schema.props` (rhizomatic's `resolveView` resolves unnamed props
  through `schema.default`, then decoration and resolvers add more). A document restricted to `consumes`
  would have handed the same bundle a strictly NARROWER view on the artifact host, so any bundle touching
  a prop outside `consumes` — which §23.4's push check does not forbid, it only proves `consumes ⊆ props`
  — renders differently on the two hosts. `_view` makes the two hosts equal by construction rather than
  by a fixture's good luck. The cost is stated plainly: **the artifact host no longer minimizes what
  crosses the wire**, it asks for exactly what the server host already resolves. Minimization would
  require a per-lens field list, which is the thing that cannot be honestly frozen into a store-agnostic
  page; §7 governs what may be read either way.
- **UI state rides `state`, because there is nowhere else for it to live.** Paging is the case: the
  collection field already delivered every id, so a page is a slice of a list the bundle holds and needs
  no store traffic — but the page INDEX has no home. Module scope dies with the per-render realm
  (deliberately — §*What forgetting costs*), the worker has no `document` to read the previous paint from,
  and `reads` is keyed by lens and entity and holds answers. So the floor carries
  `state: Record<string, string>`, echoed verbatim by the shell from the honored gesture's `data-loam-*`
  attributes and by the host route from its query string. One member, no statefulness inside the
  compartment, and `RenderFn` stays a pure function of its argument.

**The postMessage shape, mirrored from the server:**

```
shell → worker:  { bundle, node }              // node = { entity, view, hex, reads, state }
worker → shell:  { kind: "ok", html } | { kind: "notHtml" } | { kind: "fault" }
```

Byte-for-byte the vocabulary of `render-worker.ts`, including that a fault folds to a clean refusal
that leaks nothing of the bundle's internals. The request never crosses the worker boundary at all — it
crosses the DOM boundary, where the shell is already listening.

**What the shell does on a gesture — and note how little judgement it holds.** (a) It composes
`<lens>(entity: "<entity>") { _entity _hex _view }` — no field list, no `asOf`; (b) it issues one uncached
`callTool`; (c) it writes the result into `reads[key]`, echoes the gesture's `data-loam-*` attributes into
`state`, and re-renders; and (d) a refusal writes `reads[key] = { error: { code, message } }` and
re-renders too. **There is no shadow allow-list.** The shell does not adjudicate whether the app may read
that lens — the STORE does, from the registration the viewer installed, which is the entire point of
Recommendation 14. A lens this viewer's store does not serve comes back as the store's own refusal, and
that refusal is more accurate than anything the page could have decided, because the page is not where
the law lives.

**The refusal CODE is Loam's, not the runtime's — and this is the second correction the draft owed.** An
earlier draft said the MCP error codes pass straight through into `reads[key].error.code`. They cannot:
those codes (`needs_reauth`, `server_not_connected`, `selection_required`, …) are the artifact broker's
enum, and the server-rendered host resolving a `?read=` in-process has no broker and can never produce
one. A bundle branching on them would be N6's bug in the very member added to prevent it. So the floor
owns **a small host-neutral enum** — `not_served` (this store does not serve that lens), `refused` (the
store answered and declined), `unavailable` (transient; retry is the host's business, not the bundle's),
and `needs_connection` (no store is reachable from this host at all) — and each host maps its own
failures onto it at its own seam. The runtime's richer code still drives the SHELL's own degraded states
(§*What the page is, mechanically*'s table is unchanged); it just does not cross into the bundle's node,
where only a host-neutral vocabulary can be honest.

**Which means refusal is legible by construction, not by discipline.** The refusal is DATA the renderer
draws — a bundle that renders `reads` at all renders the error in the place the answer would have gone.
And for a bundle that ignores it, the shell's own status line, outside and after the mount point, states
the last refusal in the host's voice. There is no path to a blank: the previous markup is still painted,
the error is in the node, and the host has the last sentence. The MCP error codes of §*What the page is,
mechanically* pass straight through this path, so a mediated read that meets `needs_reauth` renders the
reconnect copy in the section that asked.

**And one refusal is not a refusal at all, which is worth calling out because it is the search gap's
runtime face.** A read at an entity the store simply has nothing for is a SUCCESS carrying an empty view
— `gql.ts` says so in its own words, *"absence is an answer, not an error"*. So a search box driven at
`tag:nonexistent` gets an empty view, not a code, and the renderer must draw "nothing here" rather than
a spinner or a blank. That is the one place the design asks something of the renderer author, and the
shell cannot do it for them: an empty view and an unfetched one are different states, and only the app
knows what its own emptiness should look like.

**Writes round-trip identically, which is the symmetry to keep.** A form submit maps to `loam_mutate`
against the acknowledged `writable` set, then `invalidate()` so the root watch refetches; a read gesture
maps to a one-shot `loam_query`, then a re-render. One interception seam, two verbs, and the author
wrote ordinary markup for both.

**Recommendation 19 — a mediated read is a one-shot `callTool` with `cache: false`, and never a
watch.** Three reasons, all from the live contract: (a) `watchTool`'s per-view ceiling is 64 and a
duplicate registration is `bad_request`, so a watch per drill-down is a defect that arrives as a bug
report about page 65; (b) a watch IS a cache by design — it replays a stored entry on registration; and
(c) `callTool` accepts `cache: false` — *"never cache this call, including where the read-only default
would apply"* — which is a stronger statement than the `gcTime: 0` Recommendation 12 has to settle for
on the watch, because `watchTool`'s options accept only `{ staleTime, gcTime }`. So the page holds
exactly **one** watch (its root reading, cache pinned off) and issues uncached one-shots for everything
else. The 64-watch ceiling stops being reachable at all.

### Two DEPLOY SURFACES, one floor — not one handwavey runtime

The premortem's claim was that the artifact shell IS a §23.2 host and the React host becomes a swap of
the data client. That claim is right about the FLOOR and wrong if it is read as "one runtime", and Myk
made the correction explicitly (2026-07-25): *"artifact vs embedded React host also offer fundamentally
different affordances — apps built to run in artifacts can use MCP and `sendPrompt` from Claude, for
instance, so it's worth thinking about how these are actually different deploy surfaces and not just a
handwavey 'yeah you know, a runtime.'"*

**So the shared seam is a FLOOR, never a ceiling.** The floor is small, precise, and worth naming
exactly, because it is what makes one content address honestly one app: a `RenderFn` that is pure and
synchronous; a `RenderNode` of `{ entity, view, hex, reads, state }`; `_view` as the projection on every
read; `data-loam-read` and `<form>` gestures that name a lens and an entity; a host-neutral four-code
refusal vocabulary; and the app's SCHEMA as the request surface. A bundle that stays on the floor runs
anywhere, and criteria 1 and 35 are its conformance rails — output-equality for one entity, and then for
one gesture.

Above the floor the two surfaces genuinely differ, and pretending otherwise is how one address grows two
capability envelopes (the premortem's N6 class):

| | artifact surface | embedded React host (§23.11) |
|---|---|---|
| I/O | `window.claude.mcp` ONLY — CSP blocks every other host | `fetch` / SSE to its own origin, and whatever else the operator serves |
| liveness | `watchTool` polling, coalesced, paused while hidden | a real `/:mount/subscribe` stream |
| routing | one page, one `(route, entity)` | a router derived from the store (§23's own ambition) |
| who builds the page | **Claude does**, from the deltas | the operator's build |
| affordances the OTHER cannot have | asking Claude to do something (`sendPrompt`-class), the downloads capability, running inside a conversation | service workers, real navigation, its own origin's storage, no CSP wall |
| bundle size | bounded by an artifact page's practical size (§23.10) | ordinary web economics |

**And the affordance question has a sharp consequence confinement already decided.** A bundle that used
`sendPrompt` would need `window.claude`, which the compartment removes and Recommendation 10's source
scan refuses at pack time. That is not an oversight; it is the floor holding. Two honest options for an
app that wants a host affordance, and the design should say which: (a) **mediate it, exactly like a read**
— the shell offers the affordance and the bundle asks for it with markup (`data-loam-prompt="…"`), so the
compartment still holds no authority and the gesture vocabulary grows by one verb; or (b) the app opts
OUT of the floor and is artifact-only, which means it is no longer one bundle for two hosts and should say
so in its own text. **(a) is the recommendation** and the mechanism is already built by Recommendation 18
— but T79 does not ship a prompt verb; it ships the seam that makes adding one a one-line vocabulary
extension rather than a new architecture. **(Myk)** — confirm that the floor is the deliverable and the
affordance verbs are follow-ons.

**The server-rendered host is the one that proves the floor TODAY.** It honors the same gesture as a GET
with a repeatable `?read=<lens>:<entity>`, resolved under the door's own discipline, populating the same
`reads` and `state` members — so an unenhanced link works with no JavaScript at all, and criterion 1's
output-parity claim extends from the first render to an interaction. A floor proven across two hosts is a
floor; a floor described for one is a plan.

**Two constraints on that gesture, both from `serveRouteImpl`'s existing discipline rather than invented
here.** (a) **`?read=` is FULL-DOOR only.** The anonymous door's whole posture is that *every* refusal is
a uniform 404 that leaks nothing about what exists (§17) — so a per-lens "this store does not serve that
lens" on the public app route would be exactly the lens-existence oracle that door closed. On the public
door a `?read=` is ignored and the route renders as it does today; the floor's refusal vocabulary is a
full-door affordance. (b) **Each `?read=` counts against the render budget.** `maxPublicRenders` caps
worker RENDERS, not resolutions, and a repeatable parameter multiplies resolutions per request — H8's
full-scan cost, N times, on one GET. So the count is per-request and bounded, named here because a
repeatable read parameter is precisely the shape that turns a cap into a suggestion.

**One divergence remains, and it is about TRUST rather than envelope.** The host route resolves a gesture
in the gateway, against live law; the artifact shell composes a query in the page and lets the store
answer. Both end at the same boundary — §7's mount, the viewer's own token — but only one of them is
*inside* it. State the consequence rather than hiding it: **the page holds no boundary of its own.** A
viewer may edit the emitted page freely (it is their file), and what they get back is exactly what their
own token may read, which is what they could always have read at `/:mount/graphql`. That is why
Recommendation 17's statement describes the SCHEMA's surface and names whose credentials run, instead of
claiming a wall the page does not hold — and criterion 36 asserts it in both directions.

### What forgetting costs — and the surprise: the compartment is what makes §11 reach the client

The premortem's N3 pinned `gcTime: 0` on the shell's own watch because a cached pre-erasure answer,
replayed on a re-boot, is content living where §11 has no reach. A mediated channel makes that question
bigger: an interactive app accumulates readings. Four disciplines, and the last one is the reason
confinement pays for itself twice.

- **(a) Every mediated read is uncached at the runtime**, per Recommendation 19 — `cache: false`, the
  strongest expression available, and available exactly because it is a one-shot. Nothing enters the
  call cache to be replayed.
- **(b) The shell's accumulated `reads` map is memory-only and dropped WHOLE.** No `localStorage`, no
  `sessionStorage`, no IndexedDB, no cookie — a re-boot starts with an empty map and nothing but the
  page's own root coordinates. And it is dropped in full on every non-data event on the root watch,
  not merely repainted: criterion 23's rule extended from the mount point to the accumulated set,
  because clearing the painted view while three drilled-down copies sit in a map is an H7-shaped claim —
  reporting a completeness the bytes do not have.
- **(c) An erasure arrives as an ordinary answer, and the shell tears down on it.** §11 lands, the root
  watch's next result no longer carries the value (or refuses), and the shell drops the map, calls
  `invalidate()`, and re-renders from the fresh node. There is no erasure notification to design; the
  live read IS the notification, which is §23.6's principle ("an app is a live view over surviving
  deltas") arriving on the client for the first time.
- **(d) And the compartment is the only thing that can reach the app's OWN memory.** This is the part
  worth stating loudly, because it inverts how confinement was justified. Dropping the shell's map does
  not reach inside the bundle: a renderer that memoized its node in module scope holds a copy the shell
  cannot see, cannot enumerate, and cannot negate. `Worker.terminate()` reaches it — it discards the
  realm wholesale. That is §23.6's own third instrument, quarantine-drop, at this host: *"the app's
  deltas are gone, so the app is gone."* With a per-render worker the property is not even a teardown
  step; it is the default, because no render's realm survives to hold anything. **Confinement was
  adopted for authority and turns out to be the mechanism by which forgetting reaches a client at all.**
  Unconfined, the bundle's copies live in the page realm and nothing short of a full reload removes
  them — and the page has no way to force one.

  **But `terminate()` alone is NOT enough, and this is the correction that keeps the claim true.** A
  worker global scope has no `window` and no `localStorage` — which is what made the first draft of this
  bullet sound complete — and it DOES have `indexedDB`, `caches`, and `BroadcastChannel`, as bare
  identifiers. A bundle calling `indexedDB.open("keep")` holds a copy across every render and every
  teardown, in a store §11 cannot reach and the shell cannot enumerate: the exact failure this section
  claims confinement prevents, in the one memory it was invoked for. So the boundary is **two things, not
  one** — the per-render realm AND Recommendation 10's pack-time refusal of every channel that outlives a
  realm. Criterion 34(c) is that half, and it is a pack-time refusal per channel rather than a byte-scan,
  because a scan over one conforming page could never have seen it.

**One residual stays, and it is the shell's own DOM.** The last successful markup is painted until the
next render replaces it, so between an erasure landing and the next root event a viewer is looking at a
pre-erasure string on their own screen. That is not fixable from the store side and it is the same
residual any live client has; criterion 23 bounds it to "the next non-data event clears it", and the
honest sentence is that Loam's reach ends at the last delivered answer.

## One address, two envelopes

Recommendation 1's claim — one bundle, one content address, two hosts — is right, and criterion 1 as
first drafted defended it in a way that would have **hidden** its most likely failure. Proving the
BYTES are identical is exactly the fact that conceals a behavioral divergence, because byte-equality
never asserts that the two hosts produce the same rendering. One address is not one envelope:

| | host target | artifact target |
|---|---|---|
| realm | `{eval:true}` CommonJS Worker — `require`, `Buffer`, reachable `node:*` | a module Worker: no `window`, no `document`, no `window.claude`, no Node builtins |
| time | `RENDER_TIMEOUT_MS` = 500 ms, terminate on overrun | the same budget, two clocks (spawn, then render) |
| memory | `resourceLimits`, 128 / 32 MB | none, and no browser equivalent |
| the node | `bytesEnvelope(node.view)`, a real `node.hex` | assembled from `result.payload` |
| the gesture | `?read=<lens>:<entity>` on the route, full door only | intercepted in the page, composed into a `loam_query` |
| the projection | `bytesEnvelope(node.view)` — the whole resolved view | `_view`, deliberately the same set |
| a read refusal | the door's own refusal, mapped to the floor's enum | an MCP code, mapped to the floor's enum |

Two instances are ready to bite, today, without anyone writing an unusual bundle:

1. **`node.hex` is a META field, and `node.view` is WIDER than `consumes`.** `RenderNode`'s members come
   from `gql.ts`'s meta set (`_entity`, `_hex`) as much as from props, and `serveRouteImpl` hands over
   `bytesEnvelope(node.view)` — the whole resolved view, which rhizomatic's `resolveView` fills beyond
   `schema.props` (unnamed props through `schema.default`, then decoration and resolvers). An artifact
   document restricted to `consumes` would therefore hand the same bundle an empty `hex` AND a narrower
   view, so a bundle using `hex` as a cache key, or touching a prop outside `consumes` — which §23.4 does
   not forbid; it only proves `consumes ⊆ props` — misbehaves on **one host only**: the divergence that is
   hardest to find, because the code is provably the same code. Recommendation 18's `_view` projection is
   the resolution, and criterion 1's fixture must read an out-of-`consumes` prop or it cannot see this.
2. **`Buffer`, or 501 milliseconds.** A bundle that uses a Node builtin, or that renders in 600 ms,
   works fine in the artifact and 500s on the host route. The operator ships an app that only works
   where they happened to test it.

**Two more instances the mediated channel would have created**, both caught before they were built and
both fixed the same way — by making the floor's shape identical rather than nearly identical. An OPTIONAL
`reads` (or `state`) member: a bundle that draws it on a host where it is absent throws or paints nothing,
on one host only — hence Recommendation 18's insistence that both are **always present and always
objects**, empty until a gesture is honored. And an MCP-shaped refusal code inside `reads[key].error`: the
server host has no broker and can never produce `needs_reauth`, so a bundle branching on it diverges — hence
the floor's own four-code enum, mapped at each host's seam.

Five resolutions, and they compose:

- **Criterion 1 compares OUTPUT.** The shell's rendered mount-point markup equals the host route's
  HTML body for one entity, over a fixture bundle that reads `consumes` fields, `hex`, AND a prop outside
  `consumes`. Bundle byte-equality stays — it is §23.1's attestation — and stops being the whole claim.
- **Criterion 35 compares output after a GESTURE**, which is the same claim extended to the interactive
  app: `reads` and `state` structurally equal on both hosts for the same request, and the same
  host-neutral code when it fails.
- **Criterion 5's projection is `{ _entity _hex _view }`, and it is a FIXED selection set rather than a
  field list at all.** The first draft asked for "every field in `consumes` and nothing outside it," which
  was wrong twice: it would have emptied the hex (two of the node's three original members are meta), and
  it would have narrowed the view below what the other host serves. A fixed selection set has no list to
  get wrong and no `legal()`-mangled name to guess.
- **Recommendation 10 — a fifth pack refusal: a bundle that REFERENCES a host-specific global.** Three
  families, not two, because the earlier draft's list was drawn from the page realm and the bundle runs in
  a WORKER realm: browser reach (`window`, `document`, a dynamic `import(`), Node reach (`require(`,
  `node:`, `Buffer`, `process`), and — the family that matters most and was missing —
  **worker-realm reach that survives `terminate()`**: `indexedDB`, `caches`, `BroadcastChannel`,
  `importScripts`, plus `self`, `globalThis`, and `fetch` as the doors to them. A worker global scope has
  no `window` and no `localStorage`, which is what made the first list look complete; it does have those,
  as bare identifiers, and a bundle calling `indexedDB.open("keep")` would hold a copy across every
  render and every teardown — falsifying §*What forgetting costs* exactly where it claims confinement
  makes §11 reach a client. A conforming `RenderFn` needs none of them; it is a pure function of its
  argument.

  **And it scans REFERENCES, not substrings, which is the other repair this recommendation owed.** A
  substring scan refuses the bundles §23.2 names as the target shape: *"a React renderer bundles its own
  React and returns `renderToString(...)`"*, and bundler output for that routinely contains
  `process.env.NODE_ENV` guards, a `globalThis` polyfill, and `typeof document !== "undefined"` checks. It
  also refuses `processNote`, `documentTitle`, and any of the tokens inside a comment. A scan that
  refuses nearly every real bundle is not a cheap guard, it is a broken door — and a rail that only
  measures true positives stays green while it happens. So: parse the module, look at FREE identifiers
  and member expressions, and criterion 20 carries a real bundled-React fixture that must **pack**.

  Said honestly in the other direction too: even a reference scan is defeatable by construction
  (`globalThis["win"+"dow"]`), so it is the cheap half and never the enforcing one — Recommendation 9's
  boundary is. **Both, not either**, which is the same discipline the other refusals already run: prove
  what is decidable, confine what is not.

Time parity comes with the worker: the shell carries the same wall-clock budget, and
`render-worker.ts` exports `RENDER_TIMEOUT_MS` precisely so a host may adopt or tighten it. **Memory
has no browser equivalent** — a worker takes no `resourceLimits`. That residual is named here rather
than papered over; the tab, not the store, is what a memory-hungry bundle can hurt.

## The page a stranger holds

**Recommendation 11 — ACCEPT the residual, name it as a property of this target, pin it with a rail, and
mitigate the one half that is cheap. DECIDED (Myk, 2026-07-25).** His framing is better than the one this
section was reaching for, and it belongs in the prose: *"if I open a website and it's open in my browser
and you take down the server, what's on my browser is still there until I close it. Artifacts are kinda
like that, but with a bit more persistence, since Claude has to actually build the artifact using the code
supplied by the deltas. Maybe we bake in a liveness check or something, or ask Claude to? I'm not too
worried about this."*

**The browser-tab analogy is the right register, and the ONE way an artifact differs from a tab is the
thing to be honest about.** A tab holds a page a server sent, and closing it ends the matter. An artifact
holds code CLAUDE BUILT from the deltas, and it persists where artifacts persist — a conversation, a
gallery, a link a viewer can re-open next week. So the page is not merely a stale copy in flight; it is a
durable reconstruction, and a renderer the operator withdrew can still be re-opened and re-run from it
unless something checks. That is a real difference of degree, it is bounded (the DATA is never in the page
— criterion 3 proves it at the bytes), and it is accepted. The liveness check is a **named follow-on, not a
blocker**, exactly as Myk put it. The argument for why it is a follow-on rather than a line of plumbing:

**Why not simply add the liveness read.** It sounds like a line in the shell — read the current
binding's content address before mounting, darken if the route is no longer declared and bound — and
it is not, because *that read does not exist on this door*. "Is route R still declared, and what
address is bound?" is a fact in the **constitutional** contexts: `loam.artifact` declarations and
`renderer:<route>` bindings. `loam_query` serves **registered lenses**. So a liveness obligation is
not a shell change; it is a new MCP read over constitutional publication state, which is a new
disclosure decision — what may a viewer's token learn about the operator's publication law? — and it
deserves the care refusal 1's pinned read is given rather than being smuggled in as plumbing.
Building it inside T79 widens the ticket past its wedge, exactly as refusal 1 declines to.

**So the follow-on is NAMED and small, in refusal 1's shape:** a manifest read on the MCP door —
`loam_manifest(route)`, answering *declared?* plus the bound bundle's content address — after which
the shell reads it BEFORE mounting and darkens the page when the route is no longer declared+bound, or
when the address has moved. That is the version of §23.6 that reaches the third thing, and it is one
tool away. Not this ticket.

**The cheap mitigation ships now.** The emitted page carries the `writable` set it was acknowledged
for, and the shell maps a form field to `loam_mutate` **only** if the field is in that set. This is
not a security boundary and does not reduce anyone's standing — Recommendation 8's argument holds: the
viewer could always send the document themselves. What it buys is that the PAGE never silently becomes
a wider instrument than its acknowledgement covered, so widening the schema's `writable` in a v2
registration does not widen an already-emitted page.

**And the rail pins the accepted scope instead of hiding it.** A criterion ASSERTS the residual — an
emitted page keeps rendering after its declaration and its binding are struck — so no reader mistakes
criterion 14 for covering it, and the test names the follow-on that would close it. An honest hole is
visible; an implied one is the kind that gets discovered by a stranger.

## Fail closed at pack time, where the answer is decidable

**Six refusals** — four the first draft named, two the premortem earned. Each is a case where the artifact
host genuinely cannot honor something the host target promises, or where the two hosts would diverge
behind one content address, and where quietly degrading would break a §23 guarantee. (A seventh and
eighth were drafted for the retired request-surface declaration; retiring the declaration retired them,
which is the smallest kind of evidence that Recommendation 14 is the simpler design — a boundary that
needs no refusals of its own.)

1. **A version-pinned binding refuses.** A pinned binding must resolve THAT frozen reading (§21/§23.6
   — a pin never silently slides). Pinned reads exist on the REST door (`/rest/@<deltaId>` →
   `resolvePinned`, `src/surface/rest.ts`) and **not in GraphQL** — and `loam_query` is GraphQL. So
   the page could not address the reading it was pinned to, and packing it as latest would break the
   pin's whole promise. Refuse, naming the gap. The follow-on is small and named: teach the MCP door
   a pinned read (a `version`/`@address` argument, or a REST-shaped `loam_read` tool). Doing it here
   would widen T79 past its wedge.
2. **A consumed field the schema DECLARES `bytes` refuses.** §23.7's envelope is ref-by-default, and
   the ref is fetched from `/:mount/bytes/<ref>?from=…` — an external host, blocked by CSP. Refuse
   with the reason. **The decidability here is narrower than it first sounded, and the sentence is
   worth being exact about:** `ResolverOutputType` is declared on a **RESOLVER** (`ResolverSpec.type`,
   `src/gateway/registration.ts`), so `bytes` is provable at pack time only for **resolver-backed**
   fields. A plain policy-shaped field carries no declared type at all. And `gql.ts` types the
   envelope at the VALUE level too, "whether or not the field was declared `bytes`", so an undeclared
   bytes leaf can still arrive at runtime — for which the shell renders a legible placeholder for a
   ref-only envelope and paints inline `base64url` as a `data:` URI. Pack-time refusal for the subset
   we can prove; a legible degrade for the rest.
3. **An undeclared route refuses** (Recommendation 2) — the uniform refusal, live on the next request
   after the declaration is struck.
4. **A pen or a narrower `writable` refuses without acknowledgement** (Recommendations 7 and 8) — and
   per Recommendation 7 a bundle whose SOURCE names the pen refuses on the same terms.
5. **A bundle whose source names a host-specific global refuses** (Recommendation 10) — the browser
   family (`window`, `document`, `globalThis`, a dynamic `import(`) and the Node family (`require(`,
   `node:`, `Buffer`, `process`). The cheap half of confinement, and what makes "one address, one
   behavior" provable instead of hoped for.
6. **An unusable connector display name refuses.** The `server` argument is the single most load-bearing
   string in this design — it is the entire binding between the page and a store, it is baked into the
   emitted bytes, and nothing validates it today. Empty, whitespace-only, and over-length are all
   decidable at pack time, so refuse them there rather than emitting a page that can never connect to
   anything. What is NOT refusable is the interesting one: two publishers telling viewers to name their
   connector the same thing is a collision the packer cannot see, and its runtime face is
   `selection_required` (below). That hazard is **documentation plus a degraded state**, never a
   refusal — the packer has no way to know what else a viewer has installed.
Two things that are deliberately NOT refusals, because the store is a better judge than the packer: a
gesture at a lens the viewer's store does not serve (the store's own refusal is more accurate — §*The
shell's mediation contract*), and a read at an entity that does not exist (an empty view is a lawful
answer, not an error — `gql.ts` says so).

## What the page is, mechanically

One file, everything inlined, no external host referenced anywhere — the artifact rules and §23's own
posture agree here.

- **The bundle rides VERBATIM, and it rides into a CONFINED realm.** The page mounts it the same way
  the server does: `importEsm` already imports a unit from a `data:text/javascript;base64,…` URL,
  cached by content address (`src/gateway/esm.ts`). The shell performs that identical motion — but
  **inside the worker** (Recommendation 9), not on the page, because a `data:`/`blob:` module imported
  on the page executes in the page's realm and inherits `window.claude` with it. So the bytes the
  operator signed are the bytes that run, the page's copy content-addresses equal to the binding's,
  and the code that runs them can reach no door. **No textual rewrite of the bundle, no `eval`, no
  `new Function`** — a rewrite would reintroduce exactly the signed-vs-executed gap §23.1 exists to
  close. If a viewer's CSP refuses a `data:` module import the shell falls back to a `blob:` object
  URL, and if neither works it renders "this renderer could not be mounted in this viewer" — a
  legible dead end, never a blank page. Which mechanism a given runtime permits is the one
  implementation unknown here; the rail is the invariant (verbatim bytes, no eval, no external
  request, no ambient MCP), not the mechanism.
- **The shell is the client HOST ADAPTER** — the seam that makes this ticket's second half cheap. It
  holds the coordinates, calls `watchTool`, assembles a `RenderNode`
  (`{ entity, view, hex, reads }` — `reads` present and empty on the first paint) from
  `result.payload`, posts it to a freshly-spawned confined worker, and writes the returned string into
  its mount point. **Exactly ONE watch, for the root reading** — every mediated read is an uncached
  one-shot instead (Recommendation 19), so the 64-per-view ceiling is unreachable rather than merely
  distant. Because the shell is the ONLY holder of an MCP handle, it is also the only place traffic can
  be counted, which is what makes Recommendation 9's rail assertable at all.
- **The shell is also the MEDIATOR** — it intercepts `data-loam-read` gestures on the markup the bundle
  returned, composes the `loam_query` one-shot for that lens and entity, folds the answer (or the
  refusal) into `node.reads`, and re-renders in a fresh worker. It adjudicates nothing: the boundary is
  the schema the viewer installed and the token their connector carries (Recommendation 14). The point to
  carry here is that interception is ONE seam for both verbs — a `<form>` submit becomes `loam_mutate`, a
  read gesture becomes `loam_query`, and the renderer author wrote ordinary markup for both.
- **Recommendation 12 — the watch pins its cache OFF, explicitly, in the call.**

  ```js
  watchTool(server, "loam_query", input, handler, { refetchInterval, cache: { staleTime: 0, gcTime: 0 } });
  ```

  Zero `gcTime` is the only way to express "do not keep this" — `watchTool` takes no `cache: false` —
  and it must be written even though `staleTime: 0` is already the default, because the default that
  matters is the **five-minute `gcTime`** that comes with `readOnlyHint: true`. Unpinned, a re-boot
  inside that window replays the last answer with `revalidating: true` and paints it: pre-erasure
  content, on the viewer's side of the wall, where §11 cannot reach. This one line is the entire lever
  Loam holds over that cache, which is why it is a recommendation and a rail rather than a default we
  inherit.

  The rail that makes it real is **not** the declaration — a builder can write the option and still
  paint stale content. It is the behavioral half: **on every non-data event, the previously rendered
  view is ABSENT from the mount point**, asserted by the absence of a sentinel value rather than the
  presence of a banner. A banner assertion passes while stale content sits underneath it, which is
  precisely the failure being ruled out.
- **Forms work on both hosts from one markup.** A §23.3 renderer already emits a `<form>` that POSTs
  to `/:mount/app/<route>/<entity>`. The shell intercepts submit, prevents default, and maps the
  fields to `loam_mutate` — **only** fields inside the `writable` set the page was packed and
  acknowledged for (Recommendation 11) — then `invalidate`s so the watch refetches. The author writes
  one form and both hosts honor it. (Preventing default is not cosmetic: an un-intercepted form would
  attempt a cross-origin POST, which CSP kills silently — a form that looks like it worked and did
  nothing.)
- **`window.claude.mcp !== undefined` is the availability gate**, per `mcp.d.ts`: the member check,
  never a probing call, and never gating render on a permissions read equalling `"granted"`. The page
  renders its static shell FIRST, so a top-level navigation (where `window.claude` is absent
  entirely) shows something legible rather than nothing.
- **Degraded states branch on `code`, never on message text — and the enumeration must be EXHAUSTIVE,
  because a catch-all here is a blank page with extra steps.** The first draft named four codes and
  missed the **normal case**: the viewer's store is reachable *and different*. A stranger's store may
  not serve this lens at all, or serve a version whose props differ, or differ after `gql.ts`'s
  `legal()` mangling of lens and prop names into GraphQL-legal identifiers — a page that embedded the
  raw store-native `schemaName`/`consumes` strings names fields that do not exist. Then `loam_query`
  returns `errors`, `handleMcp` sets `isError`, and the broker rejects with **`tool_error`**, which was
  in none of the four and would have landed in the default branch. That is the anti-pattern by name:
  the single code that carries the store's own message — the only thing that can tell a viewer their
  store lacks the lens — swallowed into "something went wrong."

  | `code` | what it means | the fix the page renders |
  |---|---|---|
  | `server_not_connected` | no connector answers to the name | onboarding copy — the ONE place the store's URL appears, as text a viewer reads rather than a target the page requests |
  | `selection_required` | **two or more** connectors answer to it | ask the viewer to choose; persists if dismissed; a different fix from the row above |
  | `needs_reauth` | the connector's credential lapsed | reconnect |
  | `not_granted` / `capability_disabled` | MCP is off for this viewer | the no-MCP experience |
  | `server_unavailable` | the store is unreachable *right now* | retryable — one retry per visible refresh, honoring `retryAfterMs` |
  | `tool_error` | the store ANSWERED and refused | surface the store's own message, naming the lens: the mismatch path |
  | `not_in_manifest` / `blocked_by_policy` / `approval_required` / `bad_request` | refused before reaching the store — includes the 64-watch ceiling | a named, legible message; never retried |

  `needs_reauth`, `server_not_connected`, and `selection_required` are never retried — repeating them
  cannot succeed. And the mismatch case gets its own obligation, because "reachable but different" is
  the case a published page meets most often: **a connector whose store serves a different schema
  renders a named, actionable message containing the lens name and the store's reported error** —
  never a blank page and never a partially-populated view with `undefined` where the fields should be.

**Process note for P3:** the builder must load the `artifact-capabilities` skill before writing the
`capabilities` declaration or any `window.claude.*` code. The `.d.ts` files read for this design are
a snapshot; the skill serves the live roster and the exact declaration shape, and transcribing a
contract from a bundled type file is how a version skew ships as a bug.

## Where the React host stands

**It does not exist.** There is no React anywhere in `src/` — §23's "stock React HOST whose router is
DERIVED FROM THE STORE" is prose with no implementation, and §23.11 lists the live browser host,
client hydration, and the subscription transport as deferred design-stage units. T79 should not build
it.

**Recommendation 13 — T79 narrowly targets the artifact host, and it is Loam's second host and first
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

**And the mediated channel is what makes that claim testable rather than rhetorical.** §*Does this
unify* has the argument: because a request is `data-loam-read` MARKUP validated by one exported
function, the seam is a declaration plus a gesture vocabulary rather than a client API — so the
server-rendered host can honor the same gesture as a plain `?read=` navigation TODAY, in this ticket,
which is the parity rail (criterion 35). A seam proven across two hosts is a seam; a seam described for
one host is a plan.

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
over MCP (the named follow-on behind refusal 1). **A `loam_manifest` read over constitutional
publication state** — the named follow-on behind Recommendation 11, and the only thing that would let
withdrawal reach an already-emitted page (it is NOT subsumed by the capability statement; see
Recommendation 17 for why the two questions differ). **READ-TIME PARAMETERS — the one real gap, and the
follow-on this spec most wants built** — rhizomatic has `Hole` / `Bindings` / `substituteHoles` and
`evalTerm` accepts bindings; Loam supplies them from no door, so free-text search is unexpressible and
waits on it (§*The one real gap*, Recommendation 15). **A caller-supplied `Term`** — refused on the
merits, not deferred: handing an app the gather algebra is the widest disclosure surface in the system.
**Host-affordance verbs** — a `data-loam-prompt`-style gesture for `sendPrompt`-class affordances is the
named extension of Recommendation 18's vocabulary, deliberately not shipped here (§*Two deploy
surfaces*). The React host itself (§23.11's deferred unit, though this
spec fixes the floor it will conform to). Non-custodial client signing — the viewer's *key* never enters this
design, only their *identity*, and §23.3's user's-own-pen variant still waits on the browser host.
Chunked bundle economics (§23.10) and what happens when a bundle exceeds an artifact page's practical
size. Multi-entity or entity-choosing pages: the page's identity is `(route, entity)`, exactly as the
host route's is. Rating, discovery, and the manifest conventions a published artifact might carry
(T77). And the §29/§30 numbering, which is a landing-time detail.

**Seven residuals stated rather than closed**, each named where it lives so nobody discovers it as a
surprise: a browser worker takes no `resourceLimits`, so the artifact host has **no memory bound** (the
tab is what a hungry bundle can hurt, not the store); the pack-time reference scan is **defeatable by
string construction**, which is why it is the cheap half of confinement and never the enforcing one;
**GraphQL introspection is enabled on the full door** (the gateway passes no `validationRules`), so any
token-bearing caller can enumerate every lens, prop, mutation, and claim template the store serves —
pre-existing, not T79's to change, and named because it bounds how much the capability statement can
honestly claim to be telling a viewer something they could not otherwise learn; **the artifact host asks
for the whole resolved view** (`_view`) rather than a minimized field set, which is the price of a
projection that needs no per-lens field list and is exactly what the server host already resolves; a
**cross-publisher connector-name collision** is invisible to the packer, so it is documentation plus
the `selection_required` degraded state rather than a refusal; **an emitted page is a durable
reconstruction rather than a stale tab** — accepted (Recommendation 11), with the liveness check as a
named follow-on; and **the last delivered answer stays painted**
on the viewer's own screen until the next render replaces it, so Loam's reach ends at the last answer it
served (criterion 23 bounds it to the next non-data event).

## Acceptance criteria (T79's build transcribes these; each names its verification)

1. **One bundle, two hosts, one content address — AND one rendering.** After packing a declared route:
   the bundle bytes recovered from the emitted page content-address EQUAL `binding.bundle`'s
   (`esmAddress(recovered) === esmAddress(binding.bundle)`), and the same binding still serves its
   HTML unchanged at `GET /:mount/app/<route>/<entity>`. No `target` role exists in the binding's
   claims (the delta's pointer roles are asserted as the pre-T79 set). **And the two hosts AGREE on
   output**: over a fixture bundle that reads `consumes` fields, `hex`, **and at least one prop OUTSIDE
   `consumes`**, the shell's rendered mount-point markup equals the host route's HTML body for the same
   entity. The out-of-`consumes` prop is the load-bearing part of the fixture, not a flourish: the host
   route hands the bundle the whole resolved view, so a shell that asked only for `consumes` would render
   differently here and a fixture reading only `consumes` could never see it. Byte-equality alone would
   pass while the two hosts rendered differently — that is the divergence this criterion exists to
   catch. — `test/gateway/artifact-pack.test.ts`
   (delta level: the binding's roles and the recovered bytes) + `test/site/artifact-shell.test.ts`
   (object level: both hosts' renderings compared).
2. **Publication is a declaration, and it fail-closes both ways.** `packArtifact` on an UNDECLARED
   route refuses with the uniform refusal; after `declareArtifact([route])` it emits a 200 page; after
   negating that declaration it refuses again on the very next request with no restart. —
   `test/gateway/artifact-pack.test.ts`.
3. **The page carries no data.** With a distinctive sentinel value stored in the packed entity's
   consumed field, the emitted bytes contain neither the sentinel nor any other resolved field value,
   nor any configured token, nor any seed. — `test/gateway/artifact-pack.test.ts` (asserted over the
   emitted bytes, and negatively over the whole token table so a renamed field cannot hide a leak).
4. **The page requests nothing from an external host, through ANY channel.** The emitted page
   references no `http(s)` URL as the target of any `fetch`/`XMLHttpRequest`/`WebSocket`/`import`/
   `src`/`href`, and contains no `eval` or `new Function`. The store's URL appears at most inside the
   human-readable `server_not_connected` copy. — `test/gateway/artifact-pack.test.ts` (static scan over
   the bytes), plus `test/site/artifact-shell.test.ts` loading the page in a harness whose `fetch`,
   `XMLHttpRequest`, `WebSocket`, **and `window.claude.mcp.callTool`/`watchTool`** are all traps. The
   first three are the channels CSP already closes; the fourth is the one it does not, and a harness
   that traps only the dead three proves nothing about the live one (criterion 19 is where that trap
   does its real work).
5. **The read is LIVE, it is a watch, and its projection is `_view` — the same view the other host
   hands over.** In a harness with a stubbed `window.claude.mcp`: loading the page registers exactly one
   `watchTool` against `(server, "loam_query")`, whose document is
   `<lens>(entity:) { _entity _hex _view }` — asserted as that exact selection set, with **no enumerated
   field list and no `asOf`**; delivering a second `{type:"data"}` event with a changed value re-renders
   the mount point to the new value. The projection is asserted positively, and the reason belongs in the
   test header: a `consumes`-only document would hand the bundle a strictly NARROWER view than
   `serveRouteImpl`'s `bytesEnvelope(node.view)`, which is a divergence behind one content address, and it
   could not name a gesture-chosen lens's fields at all (they are `legal()`-mangled store-side). **And the
   node carries `reads` AND `state` as present, EMPTY objects on the first paint** — not absent — so a
   renderer sees one shape on both hosts from the first render. — `test/site/artifact-shell.test.ts`.
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
8. **The STORE rides the connector, not the page — and the boundary asserted is the MOUNT.** The SAME
   emitted bytes, driven by two stubbed connectors pointing at two different MOUNTS, render two different
   readings; a connector pointing at a mount that does not serve that lens renders the refusal path rather
   than partial data. Neither token appears in the page. **What is deliberately NOT asserted:** "two
   actor tokens on ONE mount render two different readings" — unsatisfiable, because
   `SurfaceHooks.resolve(schemaName, entity, asOf?)` carries no identity and every query field resolves
   through it without a context value (`src/surface/surface.ts`, `src/gateway/gql.ts`); a token
   individuates WRITE standing (criterion 10), and §7's isolation unit for reads is the mount. Asserting
   the token version would have been satisfiable only by a stubbed harness inventing two answers — a green
   rail over a false claim. — `test/site/artifact-shell.test.ts` +
   `test/server/mcp-tool-honesty.test.ts`
   (two mounts' answers over real HTTP).
9. **The pen never rides an artifact, and the HOST gets the last word about who writes.** Three
   assertions in place of the first draft's four. (a) Packing a pen-holding binding refuses without the
   explicit acknowledgement, naming the pen — and a bundle whose SOURCE contains the pen name refuses on
   the same terms, decidable because the packer holds the source. (b) With the acknowledgement, the
   shell's writer-identity statement is the **LAST** writing-identity claim in the DOM, rendered outside
   and after the bundle's mount point, so whatever a §23.3 renderer says about its own pen, the host's
   sentence is the one the viewer reads last. (c) The host route's `POST` still signs as the pen,
   unchanged, asserted in the same test so a regression is visible. **What is deliberately NOT
   asserted:**
   "the emitted page contains the pen name nowhere" — unsatisfiable against criteria 1 and 4 for exactly
   the bindings that COMPLY with §23.3, since a compliant renderer displays which pen it writes
   under, so
   the name is in the bundle source, so it is in a verbatim-riding page. It was also aimed at the wrong
   thing: the pen's SEED is the custody question, it lives server-side in `GatewayOptions.pens`, and
   criterion 3's negative sweep over the token table already covers it. —
   `test/gateway/artifact-pack.test.ts`
   (the refusals and the host route) + `test/site/artifact-shell.test.ts` (the DOM-order half).
10. **The artifact write is the viewer's own §14 write, and grants nothing new.** Through the shell's
    intercepted form: the landed delta's author is the VIEWER's actor, not the pen; a viewer token
    with no write standing gets the store's own refusal; and the identical mutation document sent
    directly to `/:mount/graphql` with that token refuses identically. —
    `test/server/artifact-write.test.ts`
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
    `base64url` envelope renders as a `data:` URI — neither produces a request to the byte-door. —
    `test/gateway/artifact-pack.test.ts`
    + `test/site/artifact-shell.test.ts`.
14. **Withdrawal darkens the emission and the route together.** Negating the renderer binding makes
    `packArtifact` refuse AND `GET /:mount/app/<route>/<entity>` 404 on the next request; erasing
    (§11) the binding does the same and the tombstone refuses its re-entry. —
    `test/gateway/artifact-pack.test.ts`
    (both acts, both levels).
15. **Degraded states branch on `code`, the enumeration is exhaustive, and the page is never blank.**
    The shell harness feeds every code in the mechanics table — `server_not_connected`,
    `selection_required`, `needs_reauth`, `not_granted`, `capability_disabled`, `server_unavailable`,
    `tool_error`, `not_in_manifest`, `blocked_by_policy`, `approval_required`, `bad_request` — and each
    produces a DISTINCT rendering naming its own fix. Specifically: `selection_required` renders
    choose-a-connector copy distinguishable from `server_not_connected`'s onboarding copy (they have
    different fixes and were conflated in the first draft); `tool_error` renders the store's own
    reported message. The connector display name and MCP URL appear in the `server_not_connected` copy.
    `needs_reauth`, `server_not_connected`, and `selection_required` produce ZERO retry calls;
    `server_unavailable` produces at most one. **And a code the table does not list must not fall into a
    shared generic rendering**: an unknown code renders a message that names the code itself, asserted
    so that adding a code to the runtime cannot silently join a catch-all. With `window.claude` absent
    entirely the page still renders its static shell (non-empty body). —
    `test/site/artifact-shell.test.ts`.
16. **The pack door does not exist to a non-operator — in the right uniform shape for each caller.**
    `GET /:mount/artifact/<route>/<entity>` returns, byte-for-byte with no distinguishable status, body,
    or header: to a **token-bearing** non-operator identity, exactly what an unknown verb returns
    (404 `{"errors":["no such surface"]}`); to a **token-less or bad-token** caller, exactly the
    server's existing uniform 401 (`{"errors":["a bearer token is required, and this one opens
    nothing"]}`). These are two deliberate uniformity families — 404 uniform across verbs, 401 uniform
    across mounts — and demanding one response across all three callers would be unsatisfiable against
    `src/server/http.ts`, where a bad or absent token never reaches the verb switch at all. —
    `test/server/artifact-door.test.ts`.
17. **The CLI is a thin client of the door.** `loam artifact pack <mount>/<route>/<entity>
    --connector <name> --out page.html`
    writes bytes byte-identical to the door's body, and refuses with the identical message on every one
    of the six refusals — criteria 2, 9, 11, 12, 13, 20, 27, and 37. — `test/cli/artifact.test.ts`.
18. **A dangling mount degrades, never blanks.** With the connector pointing at a mount that has been
    removed (T78's `removeMount`, or a mount that never existed), the page renders its degraded state
    with the onboarding copy rather than a blank or partially-populated view.
    — `test/site/artifact-shell.test.ts` (harness), and `test/server/dynamic-mounts.test.ts` for the
    404-not-500 half if T78 has landed;
    if T78 has not landed, this criterion is asserted against a never-existent mount and the test
    file NAMES the gap and which rail closes it.
19. **The bundle holds NO authority: total MCP traffic equals the shell's own calls.** The headline rail
    of Recommendation 9, and it counts rather than looks. In the shell harness, `callTool` and
    `watchTool` are instrumented at the single seam and a **fixture bundle that deliberately attempts
    `window.claude.mcp.callTool(server, "loam_mutate", …)`** is mounted. Assertions: the total call
    count equals the shell's own (one `watchTool`, plus any form-driven `loam_mutate` the test performs
    itself) and not one more; the store's delta count is unchanged by the bundle's attempt; and the
    fixture bundle **REPORTS, in its returned markup, which host globals it can see** — asserted to be
    none of `window`, `self`, `indexedDB`, `caches`, `BroadcastChannel`, `fetch`. The report is positive
    on purpose: "assert `window` is undefined inside the realm" is **vacuous in this repo's test
    environment**, where `vitest.config.mjs` sets no `environment` and no DOM package is installed, so
    `window` is undefined in every Node realm and that clause passes with confinement deleted. This
    criterion therefore also fixes the harness: it needs a realm that HAS the globals outside the
    compartment, or it proves nothing about the compartment. The fixture
    must actually try — a passing harness with a bundle that never reaches for a door proves the
    boundary is decorative. **And the count still holds after INTERACTION**: driving three
    `data-loam-read` gestures adds exactly three `callTool`s and no `watchTool`s, so mediation buys the
    bundle no reach — the request surface is the shell's authority, never the compartment's. **This rail
    must fail if the confinement is removed** and the bundle is imported on the page instead. —
    `test/site/artifact-shell.test.ts` (object level: the traffic count and the realm) +
    `test/server/artifact-write.test.ts` (delta level: nothing landed).
20. **A bundle that REFERENCES a host-specific global refuses at pack time — and a real bundle still
    packs.** (a) Packing refuses, naming the offending reference, for each of the three families:
    `window` / `document` / dynamic `import(`; `require(` / `node:` / `Buffer` / `process`; and the
    worker-realm family that survives a teardown — `indexedDB`, `caches`, `BroadcastChannel`,
    `importScripts`, `self`, `globalThis`, `fetch`. (b) **A conforming pure `RenderFn` packs, AND so does
    a real `esbuild`-bundled React renderer** — the shape §23.2 names as the target — whose output
    contains `process.env.NODE_ENV`, a `globalThis` polyfill, and a `typeof document !== "undefined"`
    guard inside dead branches, plus identifiers like `processNote` and `documentTitle`. (b) is the half
    that makes this rail honest: a criterion measuring only true positives stays green while the door
    refuses nearly every real bundle, so the scan must look at FREE IDENTIFIERS and member expressions
    rather than substrings. The test header records that even a reference scan is defeatable by string
    construction and that criterion 19's boundary is the enforcing half — this is the cheap one.
    — `test/gateway/artifact-pack.test.ts`.
21. **The bundle runs under a wall-clock bound on BOTH hosts.** A fixture bundle that spins forever is
    terminated by the shell within the same budget the host uses (`RENDER_TIMEOUT_MS`, exported from
    `src/gateway/render-worker.ts`), and the mount point renders a legible refusal rather than a wedged
    page; the existing host-side 500 for the same fixture is asserted alongside it so the two budgets
    are visibly the same number. The test header NAMES the residual: a browser worker takes no
    `resourceLimits`, so the memory bound has no artifact-side equivalent.
    — `test/site/artifact-shell.test.ts`
    + `test/gateway/renderers.test.ts`.
22. **The watch declares its cache OFF.** The registered `watchTool` options carry
    `cache: { staleTime: 0, gcTime: 0 }` — asserted on the recorded call, since zero `gcTime` is the
    only expression of "keep nothing" the API accepts and the inherited default from `readOnlyHint:
    true` is a five-minute retention. — `test/site/artifact-shell.test.ts`.
23. **No non-data event ever leaves a previous view painted — in the mount point OR in the accumulated
    readings.** For EVERY non-data event the harness can deliver — each error `code` in criterion 15,
    plus a `revalidating: true` replay — (a) the mount point no longer contains the sentinel value from
    the last successful render, and (b) the shell's accumulated `reads` map is
    dropped WHOLE, asserted by re-rendering and finding no drilled-down sentinel either. Both halves are
    asserted by the **absence of the sentinel**, never by the presence of a banner: a banner assertion
    passes while stale content sits underneath it, and this criterion exists because that stale content
    may be post-erasure. Clearing the paint while three drilled-down copies survive in a map is the
    H7 shape — a completeness claim the bytes do not have. A re-boot of the page after the entity's
    deltas are erased paints no pre-erasure value and starts with an empty map. —
    `test/site/artifact-shell.test.ts`
    (object level: the mount point and the map) + `test/gateway/artifact-pack.test.ts` (delta level: the
    erasure landed and the store no longer serves it).
24. **A store that serves a DIFFERENT schema gets a named, actionable message.** With the stubbed
    connector answering `loam_query` as a store that does not serve the lens (and again as one whose
    prop names differ after `legal()` mangling), the mount point contains the lens name and the store's
    own reported error, and contains neither a blank body nor a partial view with `undefined` where a
    consumed field belongs. This is the `tool_error` path, and it is the case a published page meets
    most often. — `test/site/artifact-shell.test.ts`.
25. **The emitted write surface is pinned to the acknowledged `writable` set — and that pin is an
    ACKNOWLEDGEMENT, not an allow-list.** The page carries the set it was packed for; the shell maps a
    submitted form field to `loam_mutate` only if the field is in that set, and a field outside it
    produces zero `loam_mutate` calls. Then: re-registering the schema with a WIDER `writable` does not
    widen the already-emitted page (the same bytes still refuse the new field), while the host route
    honors the wider set — the asymmetry stated as a rail. **Why this does not contradict criterion
    30(d)'s "no shadow allow-list" for reads**, which the test header must state or the two rails read as
    opposites: a WRITE has a pack-time acknowledgement (Recommendation 8 — the operator looked at a pen or
    a narrowed set and said yes), so the page's pin RECORDS a human decision, and widening it should
    require making that decision again. A read has no analogue: there is nothing acknowledged, so a
    page-side read filter would record nothing and merely constrain the app while claiming to constrain
    the viewer. Neither pin is a boundary (criterion 36); one is a receipt. —
    `test/site/artifact-shell.test.ts`
    + `test/server/artifact-write.test.ts`.
26. **The residual is PINNED, not implied: an emitted page outlives its withdrawal.** After
    `packArtifact` succeeds, negating both the `loam.artifact` declaration and the renderer binding
    makes the door refuse and the host route 404 (criterion 14) — and the ALREADY-EMITTED bytes, driven
    in the shell harness against a store that still serves the lens, **still render**. Asserted
    deliberately, so no reader mistakes criterion 14 for covering the third thing, and the test header
    names the follow-on that would close it (a `loam_manifest` read on the MCP door, checked before
    mounting — Recommendation 11). If that follow-on ever lands, this criterion inverts and its
    replacement is named here. — `test/site/artifact-shell.test.ts`.
27. **An unusable connector display name refuses at pack time.** Packing with a `server` name that is
    empty, whitespace-only, or over the length ceiling refuses, naming the constraint; a valid name
    packs. The test header records that a cross-publisher name COLLISION is not refusable — the packer
    cannot see what else a viewer installed — and points at criterion 15's `selection_required` row as
    its runtime face. — `test/gateway/artifact-pack.test.ts`.
28. **The SCHEMA is the request surface: T79 adds no capability vocabulary, and the boundary is the
    store's.** (a) A renderer binding pushed after T79 carries the SAME pointer roles as before it —
    asserted as an exact set over the binding delta's claims, so no `reads`-style role was smuggled in and
    no migration is owed; (b) a gesture naming a lens the viewer's store HAS registered is served, and the
    identical gesture against a store that has not registered that lens returns the STORE's refusal with
    zero fabricated or partial data; and (c) the SAME emitted bytes produce different served sets against
    two mounts whose registered lens sets differ — the positive form of the boundary claim. **What is
    deliberately NOT asserted:** "a gesture naming a field the lens does not serve is refused" — a gesture
    names a lens and an entity and never a field (Recommendation 18), and the projection is `_view`, so
    there is no per-field gesture to refuse; asserting it would have meant hand-composing a document, i.e.
    testing `/graphql` rather than the mediated channel. The test header states the design claim it
    defends: the pair (installed schema, the mount the connector points at) is the whole read boundary. —
    `test/gateway/artifact-reads.test.ts` (delta level:
    the binding's roles) + `test/site/artifact-shell.test.ts` (object level: what each store answers).
29. **The bundle never asks: `RenderFn` is unchanged and no channel crosses the compartment.** The
    fixture app paginates, searches, and drills down, and throughout: (a) the bundle's default export is
    still `(node) => string` — synchronous, its return value a string, asserted by calling it directly
    outside the shell; (b) the worker receives exactly one message per render (`{ bundle, node }`) and
    posts exactly one back (`{ kind }`), asserted on an instrumented port, so there is no request channel
    to widen; (c) the SAME bundle bytes drive both hosts, `esmAddress`-equal; and (d) **the PAGINATING
    half is asserted specifically**, because it is the one that had nowhere to live: the page index rides
    `node.state`, echoed by the shell from the gesture's `data-loam-*` attributes, and the fixture holds no
    module-scope state (criterion 34(a) asserts it could not) and never reads the DOM (it has no
    `document`). A design that gave the bundle an async `request()` would fail (a); a design with no
    `state` member would fail (d) — that is the point of asserting both. —
    `test/site/artifact-shell.test.ts` + `test/gateway/renderers.test.ts`.
30. **A gesture becomes exactly one query, with a fixed projection and no shadow allow-list.** In the
    shell harness: (a) one `data-loam-read` gesture issues exactly ONE `loam_query` whose document is
    `<lens>(entity:) { _entity _hex _view }` — asserted as that exact selection set, with no enumerated
    field list (the page cannot know a gesture-chosen lens's `legal()`-mangled field names) and **no
    `asOf`** (the time axis is reachable through the schema and the shell does not reach for it); (b) the
    answer lands in `reads["<lens>@<entity>"]` on the node the worker next receives, and a second gesture
    at a DIFFERENT entity leaves the first entry intact; (c) a read at an entity the store has nothing for
    delivers a SUCCESS carrying an empty view — never an error code — so the renderer's own "nothing here"
    path is what a viewer sees; and (d) the shell refuses NO gesture of its own accord: driving a lens the
    store will serve produces a query rather than a page-side rejection, asserted so that a future shadow
    allow-list would fail this rail. — `test/site/artifact-shell.test.ts`.
31. **A refusal is legible INSIDE the app, in a HOST-NEUTRAL vocabulary, and the host has the last word.**
    (a) Each MCP code from criterion 15 arriving on a mediated read maps to one of the floor's four codes —
    `not_served`, `refused`, `unavailable`, `needs_connection` — and the next render's node carries
    `reads[key].error` with THAT code and a message, asserted on the node the worker actually received. The
    mapping is the load-bearing half: an MCP code reaching the bundle would be unproducible by the
    server-rendered host, which has no broker, so a bundle branching on `needs_reauth` would behave
    differently on one host behind one content address. (b) a fixture renderer
    that draws `reads` paints the message where the answer would have gone, and the previously rendered
    content is still present (a refused drill-down does not blank the page); and (c) with a fixture
    renderer that IGNORES `reads` entirely, the shell's own status line — outside and after the mount
    point, per criterion 9's DOM-order rule — still names the refusal, so no refusal is invisible. —
    `test/site/artifact-shell.test.ts`.
32. **The capability statement is DERIVED from the schema, cannot be authored, and names every axis the
    schema opens.** (a) The statement names the registration's readable props, its `writable` set, its
    claim templates, the binding's `consumes`, and the tool manifest — asserted against a binding whose
    bundle SOURCE contains the false prose "this app reads nothing", which must neither appear in nor alter
    the statement; (b) **it also names the three axes a fields-only derivation would drop**, each asserted
    present: that a read returns the WHOLE resolved view (the projection is `_view`, wider than
    `schema.props`), that the schema opens those fields' HISTORY (`asOf` / `_forgotten` ride every query
    field), and that writes include the claim templates and not only `writable`. A statement listing only
    props while the request surface carries all three would be the lying label this criterion exists to
    prevent; (c) re-registering the schema with a NARROWER `writable` narrows the statement on the next
    derivation, with no second source of truth to update, and the store refuses the removed field either
    way; and (d) the statement says reads happen against the store the connector points at and writes
    happen as the viewer's own author, and it appears both in the emitted page above the onboarding copy
    and in the pack door's response. —
    `test/gateway/artifact-capability-text.test.ts` (derivation) + `test/site/artifact-shell.test.ts` (its
    place in the page).
33. **A mediated read is an uncached one-shot, never a watch.** Over ten gestures: `watchTool` is called
    exactly ONCE for the whole page's life (the root reading), every mediated read is a `callTool`
    carrying `cache: false`, and no call carries a `cache` object with a non-zero `gcTime`. Asserted on
    the recorded calls, because `cache: false` is stronger than the `gcTime: 0` criterion 22 pins on the
    watch and is available only to the one-shot arm. The test header records why: the per-view watch
    ceiling is 64 and a duplicate registration is `bad_request`, so watch-per-request is a defect that
    surfaces as a bug report about page 65. — `test/site/artifact-shell.test.ts`.
34. **The compartment retains nothing: a fresh realm per render, and no storage anywhere.** (a) A fixture
    bundle that stores its node in module scope and returns the STORED value cannot paint a previous
    render's value — proving the realm did not survive; (b) the worker instance the shell posts to is a
    different instance on each render, asserted by identity; (c) **a bundle that reaches for a store that
    OUTLIVES the realm is refused at pack time** — one fixture per channel (`indexedDB`, `caches`,
    `BroadcastChannel`, `importScripts`), each refused by name, because a worker global scope has no
    `window` and no `localStorage` but does have these, so `terminate()` alone does NOT empty the
    compartment and the earlier draft's byte-scan over one conforming page could never have seen it; (d)
    the SHELL writes no storage either — the emitted bytes reference no `localStorage`, `sessionStorage`,
    `indexedDB`, or `document.cookie`, and a harness whose storage APIs are traps records zero writes
    across a full interactive session; and (e) after an erasure lands and the root watch delivers, the map
    is empty and the fixture bundle's stored copy is unreachable. This is the rail behind "confinement is
    what makes §11 reach the client", and (c) is the half that makes the claim true rather than
    aspirational — it must fail if the shell reuses one long-lived worker AND if the pack-time scan does
    not cover the worker realm. — `test/site/artifact-shell.test.ts` (object level) +
    `test/gateway/artifact-pack.test.ts` (the refusals, and delta level: the erasure landed).
35. **The FLOOR is conformance, asserted on a GESTURE and not only on the first paint.** On the FULL door,
    the host route honors the same gesture as `GET /:mount/app/<route>/<entity>?read=<lens>:<entity2>`: (a)
    the `reads` AND `state` members the bundle receives are structurally equal to the ones the shell
    assembles for the same gesture, and the rendered output is equal, over a fixture bundle that draws
    both; (b) the same gesture against a lens the store does not serve yields the SAME host-neutral code
    (`not_served`, criterion 31) on both hosts — equality of the refusal is asserted through that enum,
    since the MCP broker's codes cannot exist on the server host; and (c) **on the PUBLIC door a `?read=`
    is ignored and the route renders as it does today** — asserted, because a per-lens refusal there would
    be the lens-existence oracle §17's uniform 404 closed, and because each honored `?read=` counts against
    the render budget rather than multiplying resolutions per anonymous GET. The test header names the floor
    explicitly — pure synchronous `RenderFn`, `{ entity, view, hex, reads, state }`, gesture markup, `_view`
    as the projection, the schema as the surface — and names what is ABOVE it per host (the artifact's
    `window.claude` affordances, the React host's own origin and streams), so no reader mistakes floor
    conformance for one runtime. — `test/gateway/artifact-reads.test.ts` (the host
    route, both doors) + `test/site/artifact-shell.test.ts` (the shell's side of the comparison).
36. **The page holds no boundary of its own — and the viewer loses nothing by that.** Driving the shell
    with a TAMPERED page whose embedded coordinates name a lens the app was never built around: the request
    reaches the store and gets the STORE's answer — served if that mount has the lens REGISTERED, refused
    with the store's own message if it does not — and in neither case does the tampered page exceed what
    the same connector gets sending the same document to `/:mount/graphql`. Asserted against both a mount
    that serves the extra lens and one that does not, so the criterion cannot pass by everything being
    refused. The discriminator is deliberately the REGISTERED SET rather than "a token that may or may not
    read it": `hooks.resolve` carries no identity, so a per-token read filter does not exist to assert
    (criterion 8 records the same correction). The test header states the consequence plainly: the boundary
    is the installed schema plus the mount, never the page. —
    `test/site/artifact-shell.test.ts` + `test/server/mcp-tool-honesty.test.ts`.
37. **A host-only affordance cannot reach a confined bundle, and the floor bundle uses none.** (a) A
    fixture bundle that REFERENCES an artifact-only affordance (`window.claude.mcp`,
    a `sendPrompt`-class call, `window.claude.downloads`) is REFUSED at pack time by
    Recommendation 10's reference scan, naming it — so an app cannot silently become
    artifact-only; and (b) the floor fixture, which uses none of them, packs and renders identically on
    both hosts (criterion 35's comparison). The test header records the design decision this defends:
    a host affordance reaches an app by MEDIATION (a gesture the shell honors), never by ambient reach,
    and T79 ships the seam without shipping a prompt verb. — `test/gateway/artifact-pack.test.ts`
    + `test/site/artifact-shell.test.ts`.

## Decided since the premortem

Four decisions from Myk, all 2026-07-25 in chat. The first widened the ticket; the second SHRANK it, which
is the more valuable kind.

**1. CONFINEMENT — DECIDED.** Recommendation 9 as written: the bundle runs in a Web Worker realm where
`window.claude` does not exist, spawned per render, mirroring `src/gateway/render-worker.ts`'s protocol
and lifetime, with the pack-time source scan (Recommendation 10) as its cheap half. *"I'd rather spec out
the complex complete thing than ship a demo we have to walk back later. There will be an elegant solution
we just have to find it!"* Shipping v1 unconfined with the reach merely NAMED is off the table. The
decision widened the ticket rather than only settling it: a sealed compartment is what forced the request
channel to be designed now instead of discovered later, and it is what makes §11 reach a client at all
(§*What forgetting costs*, (d)). Criteria 19, 21, 29, 34, and 37 are its rails.

**2. THE APP MODEL — DECIDED, and it retired a whole capability system.** An app fuses a renderer to a
SCHEMA; both travel as deltas; the friend who installs it registers the schema in their own store, which
serves it over MCP under their own credentials. *"The renderer can do whatever the schema allows, and the
schema is provisioned with read and write access based on the user that has deployed it."* So the request
surface is the app's own schema (Recommendation 14) and T79 adds **no capability vocabulary at all** — no
`reads` role, no entity domains, no shell-side validator, no new refusals. The elegant solution was that
the declaration already existed. Criteria 28, 30, 32, and 36 are its rails, and criterion 28's first
clause is the one that keeps it honest: the binding's pointer roles are asserted UNCHANGED, so nobody can
re-introduce a parallel declaration without a red test.

**3. AN ARTIFACT REQUIRES A HOST STORE + MCP — DECIDED as a precondition, not a limitation.** *"You wanna
run a loam app you gotta have a loam server with MCP configured and your user has to be associated with
that somehow."* The runtime agrees in full: CSP blocks every other host, `window.claude.mcp` is the only
channel, and there is no MCP door on the public branch. The design consequence is a POSTURE — a page with
no connector is in its first run, not in a failure, and renders "connect your store" (§*A Loam app is not
free-floating*).

**4. THE EMITTED PAGE'S RESIDUAL — ACCEPTED.** *"If I open a website and it's open in my browser and you
take down the server, what's on my browser is still there until I close it. Artifacts are kinda like that,
but with a bit more persistence … I'm not too worried about this."* Recommendation 11 as recommended:
accept it, state the asymmetry (the DATA never outlives its source, the CODE does), pin it with criterion
26, ship the cheap `writable` mitigation (criterion 25), and keep the liveness check as a **named
follow-on rather than a blocker**. The one honest difference from a browser tab is now in the prose: an
artifact is a durable RECONSTRUCTION built from the deltas, so a withdrawn renderer can be re-opened and
re-run from an old page unless something checks.

## Open for Myk

Two are new; the rest are confirmations. Everything the premortem left open has now been decided except
these.

1. **The floor is the deliverable, and affordance verbs are follow-ons** (§*Two deploy surfaces*). The
   artifact and React hosts are different DEPLOY SURFACES sharing a floor — pure synchronous `RenderFn`,
   `{ entity, view, hex, reads }`, gesture markup, the schema as the surface — and each offers what the
   other cannot. Confinement means an artifact-only affordance (`sendPrompt`-class, downloads) cannot
   reach a bundle ambiently, so the recommendation is that such affordances arrive by MEDIATION, as one
   more gesture verb the shell honors, and that T79 ships the seam without shipping a prompt verb
   (criterion 37 refuses the ambient path at pack time). The alternative is letting an affordance-using
   app opt out of the floor and be honestly artifact-only. Confirm which.
2. **The demo story is FEDERATION, not a shared link.** The live capability contract says a page declaring
   an `mcp` manifest cannot be shared publicly, so the app travels as deltas — push, federate, accept,
   and the friend's own Claude packs and renders against their own store. This matches the workflow Myk
   described and contradicts a sentence an earlier draft carried; confirming it also decides that the
   capability statement rides the federated OFFER (Recommendation 17) and not only the page.
3. **Read-time parameters are the follow-on this spec most wants** (Recommendation 15). The schema covers
   drill-down, pagination, and keyed search; free-text search is unexpressible because Loam supplies no
   `bindings` from any door, though rhizomatic has `Hole` / `substituteHoles`. The shape is narrow — a hole
   binds a PRIMITIVE, never a Term — so it is values into a query the operator wrote. Confirm it is a
   separate ticket rather than scope here.
4. **One arm plus the floor, not both arms** (Recommendation 13). T79 builds the artifact host and the
   floor; the React host stays a deferred §23.11 unit. Is that the right read of "EITHER … OR"? The
   gesture design strengthens it: because a request is markup, the floor is provable across two hosts
   inside this ticket (criterion 35) rather than promised for a third.
5. **No anonymous MCP door.** Recommended unchanged: an artifact with no connector reads nothing.
   Opening a tokenless MCP surface is a separate trust decision.
6. **Writes allowed, pen refused** (Recommendations 7 and 8). The artifact writes as the viewer, so the
   pen cannot travel and the binding's `writable` narrowing does not bind — both refuse at pack time
   unless acknowledged. The alternative (read-only artifacts in v1) is smaller and cuts the demo's write
   half. Note that the pen obligation changed shape: the page cannot be required to omit the pen NAME
   (unsatisfiable against a verbatim bundle), so the host takes the last word instead — criterion 9.
7. **The refusals that trade scope for honesty** — six (a version-pinned binding, a declared-`bytes`
   field, an undeclared route, a pen or narrowed `writable`, a host-specific global in the source, an
   unusable connector name). Each names a small follow-on where one exists. Confirm the refusals rather
   than the widenings.
8. **Section number** — §30 recommended, since §29 already has two claimants (T64 and T77).
