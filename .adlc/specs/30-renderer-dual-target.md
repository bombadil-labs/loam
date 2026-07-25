# T79 — The dual target is a HOST, not a renderer: a Loam app publishes as a Claude Artifact that speaks to the viewer's own store

**Ticket.** T79. **Depends on** §23 (renderers), §17 (surfaces), §12 (the open door), §6 (two keys),
§7 (the mount is the read boundary). **Edge:** T78 (dynamic mounts) — needed for the demo path, not
for this contract (see *Sequencing*). Design-stage: this spec carries reasoned recommendations; **the
decisions are Myk's at the PR**, because it lands on the publication and capability surfaces.
**Proposed section number: §30** — `spec/30-artifact-host.md`. (§29 is claimed by BOTH T64
*slating-and-graveyards* and T77 *the hub*; that collision is pre-existing and worth resolving
separately, but T79 should not become a third claimant.)

An independent premortem read this design cold against the code and returned six confirmed
narratives. Two of them changed what the ticket BUILDS rather than what it asserts, and both are now
Myk calls: **the bundle's realm** (§*Confinement* — the artifact target is the first host where a
renderer holds authority at all, so the bundle must be confined; Recommendation 9) and **the emitted
page's residual** (an already-published page is the one thing withdrawal cannot reach; Recommendation
11). The other four narrowed or repaired criteria that were hollow, contradictory, or unsatisfiable as
first written; each is noted where it landed.

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
**(Myk)** — this changes what the ticket builds, so it is his call. The argument for paying now:

`RenderFn` is `(node: RenderNode) => string`, pure and synchronous. That signature is the whole reason
confinement is cheap *here* and would be expensive almost anywhere else — there is nothing to plumb
across the boundary but one structured-cloneable value in and one string out. Confinement is a dozen
lines, not an architecture.

- **Recommended: a Web Worker.** A module worker's global scope has no `window` and no `document`, so
  `window.claude` is not filtered — it is **absent by construction**. `postMessage({ node })` in, a
  string back, written into the mount point exactly as the server writes it into a response body. And
  it is the same motion `src/gateway/render-worker.ts` already performs: the two hosts converge on one
  shape — source in, node in, bounded time, string out — which is the structural symmetry
  Recommendation 1 has been claiming all along. Confinement also hands us the time bound for free (a
  worker can be terminated), which is half of the divergence the next section is about.
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

## One address, two envelopes

Recommendation 1's claim — one bundle, one content address, two hosts — is right, and criterion 1 as
first drafted defended it in a way that would have **hidden** its most likely failure. Proving the
BYTES are identical is exactly the fact that conceals a behavioral divergence, because byte-equality
never asserts that the two hosts produce the same rendering. One address is not one envelope:

| | host target | artifact target |
|---|---|---|
| realm | `{eval:true}` CommonJS Worker — `require`, `Buffer`, reachable `node:*` | a browser realm: `document`, `window.claude`, no Node builtins |
| time | `RENDER_TIMEOUT_MS` = 500 ms, terminate on overrun | none, as first drafted |
| memory | `resourceLimits`, 128 / 32 MB | none, and no browser equivalent |
| the node | `bytesEnvelope(node.view)`, a real `node.hex` | assembled from `result.payload` |

Two instances are ready to bite, today, without anyone writing an unusual bundle:

1. **`node.hex` is a META field.** `RenderNode` is `{ entity, view, hex }` — and two of its three
   members come from `gql.ts`'s meta set (`_entity`, `_hex`), not from `consumes`. Criterion 5's
   "every field in `consumes` and nothing outside it," read literally by a builder, hands the bundle an
   empty or fabricated hex. A bundle using it as an ETag, a cache key, or a change detector then
   misbehaves on **one host only** — the divergence that is hardest to find, because the code is
   provably the same code.
2. **`Buffer`, or 501 milliseconds.** A bundle that uses a Node builtin, or that renders in 600 ms,
   works fine in the artifact and 500s on the host route. The operator ships an app that only works
   where they happened to test it.

Three resolutions, and they compose:

- **Criterion 1 compares OUTPUT.** The shell's rendered mount-point markup equals the host route's
  HTML body for one entity, over a fixture bundle that reads `consumes` fields AND `hex`. Bundle
  byte-equality stays — it is §23.1's attestation — and stops being the whole claim.
- **Criterion 5's field list is `consumes` PLUS the meta fields the `RenderNode` contract requires**:
  `_entity` and `_hex`, named, and nothing else. "Nothing outside it" was right in spirit and wrong by
  exactly two fields, and reading it literally is what would have emptied the hex.
- **Recommendation 10 — a fifth pack refusal: a bundle whose SOURCE names a host-specific global.**
  Two families, both statically decidable from source the packer already holds: browser reach
  (`window`, `document`, `globalThis`, a dynamic `import(`) and Node reach (`require(`, `node:`,
  `Buffer`, `process`). A conforming `RenderFn` needs none of them; it is a pure function of its
  argument. This is the cheap pack-time half of confinement, and it is also what makes criterion 1's
  output-equality **achievable rather than aspirational** — a bundle that packs is a bundle that
  behaves the same on both hosts.

  Said honestly: a source scan is defeatable by string construction (`globalThis["win"+"dow"]`), so it
  is the cheap half and never the enforcing one — Recommendation 9's boundary is. **Both, not either**,
  which is the same discipline the other refusals already run: prove what is decidable, confine what
  is not.

Time parity comes with the worker: the shell carries the same wall-clock budget, and
`render-worker.ts` exports `RENDER_TIMEOUT_MS` precisely so a host may adopt or tighten it. **Memory
has no browser equivalent** — a worker takes no `resourceLimits`. That residual is named here rather
than papered over; the tab, not the store, is what a memory-hungry bundle can hurt.

## The page a stranger holds

**Recommendation 11 — ACCEPT the residual in v1, name it as a property of this target, pin it with a
rail, and mitigate the one half that is cheap. (Myk)** — the alternative changes scope, so it is his
call. The argument:

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

**Six refusals** — four the first draft named, plus the two the premortem earned. Each is a case where
the artifact host genuinely cannot honor something the host target promises, or where the two hosts
would diverge behind one content address, and where quietly degrading would break a §23 guarantee.

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
  holds the coordinates, calls `watchTool`, assembles a `RenderNode` (`{ entity, view, hex }`) from
  `result.payload`, posts it to the confined bundle, and writes the returned string into its mount
  point. **One watch per (lens, entity)** — well inside the 64-per-view limit, and coalesced by the
  shell. Because the shell is the ONLY holder of an MCP handle, it is also the only place traffic can
  be counted, which is what makes Recommendation 9's rail assertable at all.
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
withdrawal reach an already-emitted page. The React host itself (§23.11's deferred unit, though this
spec fixes the seam it will use). Non-custodial client signing — the viewer's *key* never enters this
design, only their *identity*, and §23.3's user's-own-pen variant still waits on the browser host.
Chunked bundle economics (§23.10) and what happens when a bundle exceeds an artifact page's practical
size. Multi-entity or entity-choosing pages: the page's identity is `(route, entity)`, exactly as the
host route's is. Rating, discovery, and the manifest conventions a published artifact might carry
(T77). And the §29/§30 numbering, which is a landing-time detail.

**Three residuals stated rather than closed**, each named where it lives so nobody discovers it as a
surprise: a browser worker takes no `resourceLimits`, so the artifact host has **no memory bound** (the
tab is what a hungry bundle can hurt, not the store); the pack-time source scan is **defeatable by
string construction**, which is why it is the cheap half of confinement and never the enforcing one; and
a **cross-publisher connector-name collision** is invisible to the packer, so it is documentation plus
the `selection_required` degraded state rather than a refusal.

## Acceptance criteria (T79's build transcribes these; each names its verification)

1. **One bundle, two hosts, one content address — AND one rendering.** After packing a declared route:
   the bundle bytes recovered from the emitted page content-address EQUAL `binding.bundle`'s
   (`esmAddress(recovered) === esmAddress(binding.bundle)`), and the same binding still serves its
   HTML unchanged at `GET /:mount/app/<route>/<entity>`. No `target` role exists in the binding's
   claims (the delta's pointer roles are asserted as the pre-T79 set). **And the two hosts AGREE on
   output**: over a fixture bundle that reads both `consumes` fields and `hex`, the shell's rendered
   mount-point markup equals the host route's HTML body for the same entity. Byte-equality alone would
   pass while the two hosts rendered differently — that is the divergence this criterion exists to
   catch, so the output comparison is the load-bearing half. — `test/gateway/artifact-pack.test.ts`
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
5. **The read is LIVE, it is a watch, and it asks for exactly the contract's fields.** In a harness
   with a stubbed `window.claude.mcp`: loading the page registers exactly one `watchTool` against
   `(server, "loam_query")`, whose document names the binding's lens and **every field in `consumes`
   plus exactly the meta fields the `RenderNode` contract requires — `_entity` and `_hex` — and nothing
   else**; delivering a second `{type:"data"}` event with a changed value re-renders the mount point to
   the new value. The meta fields are named explicitly because `RenderNode` is `{ entity, view, hex }`
   and two of its three members are meta rather than consumed: a document restricted to `consumes`
   alone would hand the bundle an empty `hex`, and a bundle using `hex` as a cache key would then
   misbehave on this host only. — `test/site/artifact-shell.test.ts`.
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
   data. Neither token appears in the page. — `test/site/artifact-shell.test.ts` +
   `test/server/mcp-tool-honesty.test.ts`
   (the two identities' answers over real HTTP).
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
    of the six refusals — criteria 2, 9, 11, 12, 13, 20, and 27. — `test/cli/artifact.test.ts`.
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
    itself) and not one more; the store's delta count is unchanged by the bundle's attempt; and inside
    the bundle's realm `window` and `window.claude` are **undefined** rather than filtered. The fixture
    must actually try — a passing harness with a bundle that never reaches for a door proves the
    boundary is decorative. **This rail must fail if the confinement is removed** and the bundle is
    imported on the page instead. — `test/site/artifact-shell.test.ts` (object level: the traffic count
    and the realm) + `test/server/artifact-write.test.ts` (delta level: nothing landed).
20. **A bundle that names a host-specific global refuses at pack time.** Packing refuses, naming the
    offending token, for each of `window`, `document`, `globalThis`, a dynamic `import(`, `require(`,
    `node:`, `Buffer`, and `process` in the bundle source; a conforming pure `RenderFn` fixture packs
    successfully. The test states in its header that a source scan is defeatable by string construction
    and that criterion 19's boundary is the enforcing half — this is the cheap one.
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
23. **No non-data event ever leaves a previous view painted.** For EVERY non-data event the harness can
    deliver — each error `code` in criterion 15, plus a `revalidating: true` replay — the mount point
    no longer contains the sentinel value from the last successful render. Asserted by the **absence of
    the sentinel**, never by the presence of a banner: a banner assertion passes while stale content
    sits underneath it, and this criterion exists because that stale content may be post-erasure. A
    re-boot of the page after the entity's deltas are erased paints no pre-erasure value. —
    `test/site/artifact-shell.test.ts`
    (object level: the mount point) + `test/gateway/artifact-pack.test.ts` (delta level: the erasure
    landed and the store no longer serves it).
24. **A store that serves a DIFFERENT schema gets a named, actionable message.** With the stubbed
    connector answering `loam_query` as a store that does not serve the lens (and again as one whose
    prop names differ after `legal()` mangling), the mount point contains the lens name and the store's
    own reported error, and contains neither a blank body nor a partial view with `undefined` where a
    consumed field belongs. This is the `tool_error` path, and it is the case a published page meets
    most often. — `test/site/artifact-shell.test.ts`.
25. **The emitted write surface is pinned to the acknowledged `writable` set.** The page carries the
    set it was packed for; the shell maps a submitted form field to `loam_mutate` only if the field is
    in that set, and a field outside it produces zero `loam_mutate` calls. Then: re-registering the
    schema with a WIDER `writable` does not widen the already-emitted page (the same bytes still refuse
    the new field), while the host route honors the wider set — the asymmetry stated as a rail. —
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

## Open for Myk

The first two are new, they came out of the premortem, and they are first because they change what the
ticket BUILDS rather than what it asserts.

1. **CONFINE the bundle** (Recommendation 9) — a Web Worker realm with no `window.claude`, mirroring
   `render-worker.ts` server-side, plus the pack-time source scan (Recommendation 10) as its cheap half.
   This is the recommendation. What it costs: the shell grows a worker boundary and a one-message
   protocol — small, because `RenderFn` is already one value in and one string out, but not free. What
   it buys: the artifact target is the **first host where a renderer holds authority at all**, and
   unconfined, one line of operator-authored bundle code writes as the viewer across `gql.ts`'s entire
   mutation root — on a shared multi-tenant mount, into fields no acknowledgement covered. The
   alternative Myk may prefer is shipping v1 unconfined with the reach NAMED in the section and
   restricted to single-tenant mounts; this spec does not recommend it, because §7's shared-mount case
   is the common one and a named hazard in a spec is not a boundary in a page.
2. **ACCEPT the emitted page's residual, or build the liveness read** (Recommendation 11). Recommended:
   accept it in v1, state the asymmetry as a property of this target (the DATA never outlives its
   source; the CODE always does), pin it with criterion 26, ship the cheap `writable` mitigation
   (criterion 25), and name the follow-on — a `loam_manifest` read on the MCP door that the shell checks
   before mounting. The alternative is building that read now, which means deciding what a viewer's
   token may learn about the operator's publication law, and that is a disclosure decision of the same
   weight as refusal 1's pinned read rather than a line of plumbing.
3. **One arm plus the seam, not both arms** (Recommendation 13). T79 builds the artifact host and the
   client-host seam; the React host stays a deferred §23.11 unit. Is that the right read of "EITHER …
   OR"?
4. **No anonymous MCP door.** Recommended unchanged: an artifact with no connector reads nothing.
   Opening a tokenless MCP surface is a separate trust decision.
5. **Writes allowed, pen refused** (Recommendations 7 and 8). The artifact writes as the viewer, so
   the pen cannot travel and the binding's `writable` narrowing does not bind — both refuse at pack
   time unless acknowledged. The alternative (read-only artifacts in v1) is smaller and cuts the
   demo's write half. Note that the pen obligation changed shape: the page cannot be required to omit
   the pen NAME (unsatisfiable against a verbatim bundle), so the host takes the last word instead —
   criterion 9.
6. **The refusals that trade scope for honesty** — now six rather than four (a version-pinned binding, a
   declared-`bytes` field, an undeclared route, a pen or narrowed `writable`, a host-specific global in
   the source, an unusable connector name). Each names a small follow-on where one exists. Confirm the
   refusals rather than the widenings.
7. **Section number** — §30 recommended, since §29 already has two claimants (T64 and T77).
