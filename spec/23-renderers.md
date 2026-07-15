## 23. Renderers — push deltas, get software

A Loam store already carries its own schema, its own doors, and its own law — everything except its own
face. §17 said a surface is a MATERIALIZATION of the registration: GraphQL, REST, OpenAPI are witnesses
to one interface-agnostic truth, and "adding an interface never touches the registration." This section
carries that same law to the screen. **A renderer is a surface whose door is PIXELS** — a UI component,
pushed as deltas, bound to a Schema and a route, and Loam ships a stock React HOST whose router is
DERIVED FROM THE STORE. Push a renderer delta and the route exists: no build, no deploy, no app store
between an idea and the people it is for. The database is the deployment.

Nothing here is a new kind of thing. §17 already named the horizon — "compiled surfaces, capability
projections... a monitor built from the READ-ONLY projection, resolving views and nothing else" — and a
renderer is exactly that, arriving as an executable consumer instead of a compiled artifact. It rides
the **same `SurfaceGenerator` seam** (`src/surface/surface.ts`): the gateway owns STATE and hands a
generator the `Registered` set plus `SurfaceHooks`; a generator owns SHAPE and derives a door. A React
host is the next witness after `buildGqlSchema` and the REST door — `SurfaceGenerator<ReactApp>`. And so
every guarantee §17 fixed holds unchanged at the screen: a renderer may narrow a projection, never widen
one; two doors over one ground cannot disagree; the contract is agreement — the pixels a renderer paints
are a reading of a `ResolvedNode`, and its `hex` is the same value through every door (a renderer's
contract test is that its view's `_hex` matches the door it reads from).

What this opens: the village becomes a PLACE, not a script — a URL where every store renders itself, and
growing a store mid-meeting grows the town in the browser. Federation ships APPS, not just data: join a
confluence and its interfaces arrive with its ground, a peer's board rendering in your host, inert-by-
default like all foreign law (§8/§12/§15 — "data federates; authority never does") until the operator
blesses it. Local-first is live by construction: a renderer subscribes to a View over local ground,
writes go through the §14 verbs, and offline is just the store being a store. And an ecosystem falls out
of the substrate's own mechanics — renderers are signed, versioned (§17), content-addressed, forkable,
supersedable, so provenance, updates, and rollback (the app store's hard problems) are already solved by
the delta model, merely pointed at UI.

This is a **design-stage section**: it fixes the shapes and answers the design questions so a build can
begin from a settled contract, and it BUILDS none of it yet. Questions the design decides are marked
DECIDED; the genuinely open ones carry a reasoned RECOMMENDATION for Myk's review, not settled law.

### 23.1 A renderer at rest — the snapshot doctrine, pointed at UI

A renderer is code, and code lives in the ground as content — the snapshot doctrine (§22.3) settles the
residue once, and this section inherits it verbatim. **A renderer at rest is a delta asserting the
content-addressed bytes of a whole, versioned unit of directly-runnable ESM.** The signature attests
exactly what mounts — one hash, no signed-vs-executed gap, which is the whole of §24's trust story
brought forward: what a host runs is what an author signed. History is supersession, not edits: a new
renderer is a fresh content-addressed unit that supersedes the old, and `supersededBy` lineage is the
version chain (§17's append-only law). A renderer is a new **delta kind** in the Ground vocabulary
(constitution, registration, fact, negation, tombstone, trust, grant, public-declaration, foreign,
derived — and now `renderer`), so the Ground instrument badges it and provenance reads it like anything
else.

**The module contract — ambient vs bundled (RECOMMENDATION).** A renderer cannot bundle the world; some
runtime must be AMBIENT, provided by the host. The rule is the snapshot's: *the bundle IS the attested
artifact*, so ambient must be tiny and VERSIONED — the renderer names the host API it expects, and a
host that cannot honor that version refuses to mount rather than mounting a mismatch. The recommended
ambient surface is deliberately small: **React (a pinned major version) and the Loam client-lens API**
(the capability-scoped handles of §23.2) — nothing else. Everything a renderer needs beyond that it
bundles into its own snapshot unit, so the attested bytes are self-sufficient and two hosts at the same
ambient version mount it identically. The ambient version is part of the compatibility contract (§23.4):
a renderer declares `{ react: <major>, loamClient: <version> }`, and mounting is refused on mismatch,
"proven at push, not hoped at runtime."

### 23.2 The host contract — a renderer speaks lens, the host holds the keys

This is the spine; everything else is downstream of it. A mounted renderer receives **NOT raw store
access, but a narrowed `SurfaceHooks`** — the exact seam §17 already published, projected. Concretely a
renderer is handed three capabilities and no others:

- **A resolved View** — `resolve(schema, entity)` → a `ResolvedNode` (the view, its `_hex`, the as-of
  pins). The renderer reads a lens, never the ground.
- **A live subscription** — `watch(schema, entity)` → the `PatchNode` stream, so the UI re-paints when
  the answer moves. This IS local-first-live: the renderer follows a View over local ground.
- **The write verbs as capability-scoped handles** — `mutate` / `clear` / `remove` / `link` / `sever`
  (§14), each running the gateway's own authorization, admission, and tombstone discipline. The renderer
  compiles a click into one of these calls; it cannot forge a delta, widen a grant, or touch a store the
  handle does not reach.

The mental model (Myk, 2026-07-14): **for all a renderer knows, it is an ordinary React app talking to a
GraphQL service that happens to be bundled with it** — it does not know it is inside a Loam host, it just
calls the client it was handed and renders the result. That is the whole trick: the "service" is the
projected `SurfaceHooks`, and swapping a live door for a pinned one, or a full projection for a read-only
one, is invisible to the component. The renderer holds no keys and no reactor. The HOST holds them and
injects capability-scoped handles — the object-capability discipline (§6) at the screen: a renderer's
authority is exactly the set of handles it was given, nothing ambient. A read-only host injects `resolve` + `watch` and no write verbs — the
`"read"` projection of §17, "a smaller world, not a bypass." A full host injects the write verbs too. So
the host contract is not new machinery: **it is `SurfaceGenerator<ReactApp>` over `SurfaceHooks`, scoped
by `SurfaceProjection`.** The stock React host is a running app whose router is DERIVED from the store's
renderer bindings (§23.5): it reads the surviving renderer deltas, mounts each in a compartment, and
injects the handles that renderer's binding is scoped to. Push a renderer, the route appears; strike it,
the route goes dark — the same live rebind the gateway already does for schemas.

### 23.3 Whose pen writes — the fifth write-path label (RECOMMENDATION)

§19's write-path labels name how a delta reached the ground: the **DOOR** (a mutation compiled to a
claim), the **PEN** (a raw signed claim), the **WIRE** (federated), the **DERIVED** (a runner's
emission). A click in a renderer is a fifth path, and honesty (the learner always knows which pen wrote)
demands it be labeled: the **RENDERER** path — a write mediated by mounted UI. But a label is not an
identity, and the sharp question is: a click in a foreign renderer becomes a delta signed by WHOSE key?

Two answers, and the recommendation is that BOTH exist, chosen per mount:

- **The user's own pen (default, for a trusted renderer).** The renderer is a lens over the USER's
  authorship — exactly §12's non-custodial browser write, where "the delta's own verified author is the
  authority" and the UI is transport. The host signs the compiled write with the user's key; the delta's
  author is the user; the renderer named the shape but authored nothing. This is the local-first case:
  your face on your ground.
- **A per-renderer granted author (for a foreign or sequestered renderer).** The operator grants a
  DISTINCT identity write standing for that renderer, and the host signs its writes with that key. Now
  provenance shows the mediating code (a `foreign-board` author, not you), and revocation is per-renderer
  — strike the grant and the renderer can write nothing, its past writes still attributed to it. This is
  §6's two-authority discipline arriving at the screen: blessing the code and granting its pen are
  DIFFERENT keys, and §24's quarantine rides exactly this (a probationary renderer writes under a
  revocable grant into a sequestered pool).

So the recommendation: the write-path label is `renderer`; the SIGNING identity is a per-mount policy —
default the user's own pen (non-custodial), with an optional per-renderer granted author for any renderer
the operator has not made its own. A host must SHOW which pen a mounted renderer writes under (the trust
UI), so a user never signs with their own key inside a face they did not author without knowing it.

**And a SANDBOXED renderer's writes are scoped to the sandbox, discardable wholesale (Myk, 2026-07-14).**
When a renderer is quarantined, its writes do not land in the canonical ground at all — the per-renderer
granted author writes into the SANDBOX POOL (§23.9/§24), a separate store, and the entire point is that
the operator can simply DISCARD the whole thing: drop the sandbox and everything the quarantined renderer
authored vanishes with it, no negation-by-negation cleanup, no residue in canonical history. This shapes
how the sandbox is built: it must be a real, separate pool the writes actually land in (a store the
operator can drop), never a mere mark on canonical deltas that a reader is trusted to honor — you cannot
discard a mark. Promotion out of the sandbox (§24) is then the deliberate act that moves specific outputs
into canonical authorship; absent it, closing the sandbox is a clean erase-by-construction.

### 23.4 Binding a renderer, and proving it at push time

A renderer binding is a small, three-part declaration — *this renderer (content hash), consuming this
Schema at this version, served at this route* — the read-side twin of a registration (§21's binding).
It carries no UI; it names the content-addressed renderer unit, the schema pin, the route, and the
ambient versions it expects. And like every §17 door, its compatibility is **proven at PUSH time, not
hoped at runtime**: the door checks the declaration against the registered surface (the `SurfaceGenerator`
seam) and REFUSES a mismatch, so a renderer that names a schema the store does not serve never mounts.

**The compatibility relation (RECOMMENDATION).** A renderer consumes a VIEW SHAPE — a set of fields and
their types. The pin fixes that shape: a renderer names either a LIVE schema (`Film`, tracking the latest
lens) or a PINNED VersionedSchema (`Film@<hash>`, §21, frozen). Push-time verification, in ascending
strength, and v1 recommends the first two:

1. **Existence** — the named `(schema, version)` must exist in the registered surface (a live name binds
   to the latest registration; a `name@hash` binds to that surviving registration version,
   `readRegistrationVersions`). A renderer naming an unregistered schema or a non-existent version is
   refused.
2. **Field coverage** — the renderer declares the fields it reads, and each must be a property the
   schema's Schema names (or a bytes/resolver-typed field, §22/§23.7). A renderer that reads a field the
   lens cannot fill is refused, rather than painting `undefined` at runtime.
3. **Structural type agreement (deferred)** — checking that each consumed field's declared type matches
   the schema's output type (§22.6) exactly. A later hardening slice; v1 stops at coverage.

Push-time verification is best-effort by design, not a proof of runtime safety: this is a LIVING system
(Myk, 2026-07-14), the ground goes on moving under a mounted renderer, and no push-time check can
guarantee a future read never surprises a component. The goal is to catch the breakage we CAN catch
cheaply — an unregistered schema, a field the lens cannot fill — and refuse it at the door, so the common
"renderer references what the store does not serve" class fails loudly at push instead of silently at
runtime. We do what we can and are honest that it is not everything.

A renderer pinning `Film@<hash>` gets §21's guarantee for free: the VersionedSchema is a content-
addressed snapshot that never supersedes, so "renderer pinned to schema v3 works forever" is not a
feature the renderer implements — it is a property it inherits from the rung below. (This is precisely
where §22's deferral comes due: for a pinned renderer's resolvers to be frozen too, a resolver's content
must fold into the `name@hash` VersionedSchema — the `VersionedHyperSchema`/resolver-in-snapshot folding
§21 and §22 deferred "to when §23 needs the whole reading frozen." §23 is that need. See §23.8's build
note.)

### 23.5 The router discipline

A renderer claims a ROUTE — a path the host's router mounts it at. Three questions, three
recommendations:

- **Who owns the namespace.** The OPERATOR, by the same law as registrations: in a governed store only
  operator-authored renderer bindings bind (a foreign renderer merges as data and mounts nothing until
  blessed). Routes live under the mount — `/:mount/app/<route>` — and the operator's law is the only law
  that claims one. Federation brings foreign routes that are inert until blessed, and when blessed into a
  probation frame (§24), they mount visibly sequestered.
- **Renderers are PINNED, like schemas, with a latest route (Myk, 2026-07-14).** A renderer version is a
  content-addressed thing, and a route may PIN a specific version (`/:mount/app/board@<hash>`) — frozen,
  answering that exact renderer forever, the exact mirror of a `name@hash` schema pin (§21) — OR be a
  DEFAULT route (`/:mount/app/board`) that always serves the MOST-RECENT pin, tracking evolution the way
  a bare schema name tracks the latest registration (§17). So the two access modes of the version door
  arrive at the screen: pin-and-freeze for a consumer who wants stability, follow-latest for the default
  face. Re-pushing a renderer mints a new pin and moves the default route to it; striking the latest pin
  moves the default route back to the prior survivor; a hard-pinned route is unmoved by either.
- **Many faces per schema.** A Schema is a lens, and a lens has no reason to have exactly one face: many
  renderers may bind the same schema at different routes (a `Film` card, a `Film` full page, a `Film`
  admin form), each its own versioned unit. The schema is the shared ground; the renderers are readings
  of it, and they multiply as freely as lenses do.

### 23.6 Versioning under §17 law

Renderers are born versioned and append-only, no new machinery: a renderer binding is a delta, its
content address is its true name, the latest surviving binding per route is served, and older versions
stay answerable by hash — §17's whole law, unchanged. Evolution mints a version; it never unseats one.
Withdrawing a shipped-broken renderer is the operator striking its binding (lawful negation), the same
instrument as everywhere; the route stops being served, the ground remembers it existed.

**An app is a live view over SURVIVING deltas — it never outlives its source (DECIDED, Myk 2026-07-15).**
This is the governing principle, and it resolves the tension cleanly. A renderer is not a running instance
that persists on its own; it is, conceptually, a view into some set of deltas, re-derived from the current
surviving ground every time it is served. So **if the deltas are gone, so is the app** — immediately, by
construction, never "still running until a restart." (That we do not literally rehydrate the bundle on
every request is an OPTIMIZATION, never a change to the semantics: the served state always reflects the
surviving ground, and a host that has cached a mounted app must drop it the moment its source stops
surviving.) The alternative — an app that keeps answering after its law was struck or erased — is exactly
the odd, stale situation this principle refuses.

Three acts remove the source, and all three stop the serving:

- **WITHDRAW (negation of the binding).** Striking a renderer's binding, or the schema version it pins,
  removes it from the SURVIVING lawful set — so it stops being served, exactly as §17/§21 already withdraw
  a schema version (a struck version is 410, not "still answered from its snapshot"). The default/latest
  route (§23.5) falls back to the prior survivor; a route pinned to the struck version goes dark. The bytes
  are not purged (the ground still remembers THAT it existed, §21), but "remembered" is not "served." This
  is consistent with §21 by construction: "a pin answers forever" means a SURVIVING snapshot never
  auto-supersedes under evolution — not that it outlives a deliberate withdrawal.
- **ERASE (§11), the strongest, reaches the bytes themselves.** Purge removes the content and the
  tombstoned id is refused re-entry forever; the renderer 404s, a purged asset it references 404s at the
  byte-door. Withdrawal stops serving; erasure removes the possibility of ever serving again.
- **QUARANTINE-DROP discards the sandbox wholesale (§23.9).** A quarantined renderer and its writes never
  entered canonical history, so dropping the sandbox pool removes them and their app stops being served —
  no negation, no residue. This is the clean discard §23.3 leans on, and it is the same principle: the
  app's deltas are gone, so the app is gone.

### 23.7 Bytes in views — the self-describing envelope (DECIDED, Myk 2026-07-14)

A renderer's assets — an image, a font — are bytes, and a schema that resolves a bytes target (§22's
resolver output type, the rhizomatic `bytes` Target kind adopted in T8) yields raw bytes in the resolved
View. Loam's view serializers pass a View through as JSON, and raw bytes are not JSON, so the host
contract fixes exactly how a bytes value crosses a door. **This is settled law, transcribed here:**

- **A bytes value in a resolved view is a CONTENT-ADDRESSED REF by default, INLINE base64url for small
  values below a size threshold** — the snapshot doctrine economics ladder (inline → ref → chunked),
  chosen per value by size. Ref-default because the bytes are already content-addressed, so the ref is
  FREE and buys immutable cache-forever, dedup, small views, and native renderer ergonomics; inline saves
  a round-trip only when the value is tiny.
- **A self-describing envelope: `{ mime, ref, base64url? }`.** `ref` (the content hash) is ALWAYS present
  — the stable identity, the `/bytes` fetch key, and the consumer cache key. The inline field is named
  for its ENCODING: `base64url` — unpadded, url-safe, exactly rhizomatic's `b64uEncode`/`b64uDecode` and
  the same encoding the delta wire uses (NOT standard padded base64, which breaks a naive decoder) —
  present ONLY when inlined small, so the field name self-describes the decode. The discriminant is
  `base64url` presence, which tells the consumer both inline-vs-ref AND how to decode; the logic collapses
  to `data = v.base64url ? b64uDecode(v.base64url) : fetch(mount+'/bytes/'+v.ref); cacheKey = v.ref` —
  inline is a pure optimization, never a different object, and the content address is always available to
  key on. A future second encoding is an ADDITIVE key (e.g. `hex?`), never a breaking change.
- **Two levels of knowing.** The field is TYPED as bytes by the DOOR — this rides §22's resolver-output-
  type declaration, so "is it bytes" is a schema fact (a `bytes` output type extending §22.6's enum
  additively; GraphQL types it a `BytesValue`, OpenAPI `format: binary`). "Inline or ref" is the one
  value-level check the consumer makes.
- **The byte-door: `GET /:mount/bytes/<ref>?from=<lens>/<entity>`** returns the raw bytes with `mime` as
  `Content-Type`, inheriting §17 read discipline and §11 erasure. The read discipline is **PROOF-OF-READ**
  (Myk, 2026-07-15, over a reachability-scan and a token-broad model): a bare `ref → bytes` endpoint would
  be exactly the content-address existence oracle §17 already closed, so the fetch must NAME the lens and
  entity it got the ref from, and the door RE-RESOLVES that view under the caller's own access (the same
  door discipline a normal read runs — the anonymous door only over a publicly-declared lens) and serves
  the bytes only if the resolved view actually contains a `BytesView` whose content address is `<ref>`.
  Every failure — unknown ref, wrong `from`, a lens the caller may not read — collapses to a UNIFORM 404,
  so a stranger learns nothing. No oracle, no store scan (the re-resolution IS the lookup), and the
  consumer always has the lens+entity because it just rendered them. §11 erasure then falls out for free:
  a purged source delta is no longer in the live re-resolved view, so the ref 404s by construction — the
  door never caches the bytes. (This is the settled contract the T9 build ticket implements.)

### 23.8 The public-door tension — a declaration is not a probe (DECIDED, Myk 2026-07-15)

§17 deliberately narrowed the anonymous door: the PUBLIC projection serves only the LATEST version per
declared name, because an anonymous `@hash` probe was a registration-existence oracle across the whole
ground, and "history is not anonymous." But a renderer PINS a VersionedSchema, and village-as-a-URL wants
strangers reading a rendered route that is, by construction, pinned. The two must be reconciled, and the
reconciliation is a distinction §17 half-stated: **a probe is DISCOVERY; a declaration is PUBLICATION.**
The anonymous door refuses `@hash` probes because a stranger learns what versions exist. But when the
OPERATOR names a version in a public declaration, the operator CHOSE to reveal exactly that version —
that is not the stranger probing history, it is the operator publishing a version. So:

**The §12/§17 amendment (DECIDED, Myk 2026-07-15).** The `loam.public` declaration's vocabulary grows from `[schemaName]`
to `[schemaName | schemaName@version]`. A bare name still means "the latest version, served anonymously"
(unchanged). A pinned `name@version` means "exactly this version, served anonymously — because I
declared it." The anonymous door serves a pinned version IFF the operator publicly declared that pin;
every other `@hash` remains a 404 to the stranger (history stays un-probable). A public renderer route
thus reads a pinned schema anonymously without reopening the existence oracle: the operator's public
declaration is the authorization, per-version, exactly as it is per-name today. This is a genuine
amendment to §12 and §17 and is Myk's to accept.

**Build note — the resolver-in-snapshot folding comes due here.** §22 deferred folding a resolver's
content into the `name@hash` VersionedSchema "until §23's renderer-pin needs the whole reading frozen."
A public renderer pinned to `Film@<hash>` must resolve identically forever, resolvers included — so this
section's build slice is where the fold lands: the VersionedSchema snapshot grows to freeze the lens's
resolvers alongside its `props`/`default`, and `name@hash` becomes the address of the WHOLE reading. This
is a Loam-layer change (rhizomatic untouched), symmetric to §21's deferred `VersionedHyperSchema`, and it
is a prerequisite of the pinned-public-renderer guarantee, not an optional nicety.

### 23.9 Trust — two distinct disciplines, not one (refined by Myk, 2026-07-14)

The sharpest edge, and the review's precision matters: a renderer is untrusted on TWO independent axes,
and the design must not conflate them.

**Axis one — DELTA ISOLATION (the sandbox/quarantine's actual purpose).** The point of a sandbox is to
keep deltas from an UNTRUSTED SOURCE out of the canonical store history — a foreign renderer, its writes,
its outputs must not merge into your primary ground. This is a DATA property, not a code-execution one.
Three things follow, and the third is the one the first draft missed:

- **A separate pool, not a mark.** The sandbox is a real separate store (§24's decided posture), so a
  quarantined renderer and its writes land THERE, never in canonical history — and the operator can DROP
  it wholesale (§23.3). Isolation that rests on canonical deltas carrying a "sandboxed" mark every reader
  must honor is not isolation; a separate pool is.
- **FULL INTEROP by opt-in (Myk).** A sandbox is NOT a black box. While it is active, any query may OPT IN
  to including it within its own scope — read across the canonical ground AND the sandbox together,
  deliberately, for that query. The default scope is canonical-only (the sandbox pollutes nothing by
  omission); widening to include a sandbox is a per-query choice, the exact dual of federation's read-time
  trust (§8 — "whether a peer's facts shape a local view is a read-time trust choice"). So you can dry-run
  a stranger's whole app against your real ground and SEE what it computes, precisely because the
  interop is there for the asking — you just never merge it without meaning to.
- **Discard is erase-by-construction.** Drop the pool and everything untrusted vanishes with it, no
  negation-by-negation cleanup. Promotion (§24) is the deliberate opposite: move specific outputs into
  canonical authorship.

This refines §24's "one-way glass": the glass is not opaque — a query may look THROUGH it on purpose. What
stays one-way is the MERGE: nothing crosses into canonical history without a deliberate promotion.

**Axis two — CODE CONFINEMENT (running the renderer's bytes safely).** Separate concern: a renderer
executes code, and the running code must not reach ambient authority. Here §6's discipline applies
directly — **object-capability confinement, `isolated` bodies in a SES / Worker / wasm compartment,
required for federated code.** The host mounts every renderer in an ocap compartment whose ONLY
capabilities are the `SurfaceHooks` handles it injects (§23.2): no ambient store, no ambient network, no
DOM beyond its mount point. A renderer reaches the world only through its capability-scoped handles, so it
does exactly what its projection allows and nothing more, and §6's divergence budget (a lifetime trigger
count) and §12's per-door resource caps keep a mounted stranger's cost confined to the stranger's frame.

**The two compose.** A quarantined federated renderer runs CONFINED (axis two — it can touch only its
handles) AND writes ISOLATED (axis one — its deltas land in the opt-in-queryable, discardable pool). The
floor beneath both is inert-by-default (§8/§12/§15): in a governed store only operator-authored renderer
bindings bind, so a foreign renderer mounts nothing until blessed — "data federates; authority never
does," now at the screen. Blessing is promotion out of quarantine (§24), not a boolean flipped in the
dark, and §6's two-authority discipline holds: blessing the renderer and granting its pen are different
keys.

This is the sanctioned panel-review surface: capability-security is one of §23's three prosecution angles
(§23 provenance), because a renderer is the first place Loam executes a foreign author's code with a
user's face around it. (This section also FEEDS §24: the opt-in-interop refinement above is an input to
the quarantine's own design — §24's separate-store posture gains a read-time "include this sandbox in
scope" query control.)

### 23.10 The economics arrive early

A bundled UI riding in a delta is store-sized data, and the browser peer's ~5 MB origin quota (§15) meets
renderer snapshots immediately — so the snapshot doctrine's later rungs (content-addressed ref, Merkle-
chunked tree) graduate from "later economics" to §23 v1 design concerns, and the design budgets for them
rather than discovering them in the demo. The ladder is the snapshot doctrine's (§22.3): inline bytes →
content-addressed ref → chunked tree, all snapshot semantics, only storage cost differing, content
addressing already deduping unchanged units across versions.

- **The renderer CODE bundle is text ESM.** Small renderers ride inline in the binding (the ladder's
  first rung); a large bundle climbs to a content-addressed ref (the byte-door serves it, §23.7). v1's
  threshold is the same size-choice the bytes envelope makes per value.
- **Binary assets ride the `bytes` Target kind** (adopted, T8) — small inline as base64url, large as a
  content-addressed ref through the byte-door, exactly the §23.7 envelope. §23 does NOT treat the bytes
  primitive as a blob store: it is the inline rung only, and big assets climb the ladder like everything
  else. **Past a strict ceiling, binaries do NOT ride deltas AT ALL (Myk, 2026-07-14)** — a fat binary in
  a delta makes federation challenging (every peer syncing the whole payload, `deltasSince` moving
  megabytes) and is prone to ABUSE (a delta stream is not a CDN, and a signed grow-only log is a bad place
  to smuggle bulk). So the inline rung is deliberately SMALL, the content-addressed ref is the working
  default, and above the ceiling the bytes live out-of-band behind their ref (the byte-door fetches them),
  never inline in a delta that federation must carry. The delta carries the IDENTITY (the ref); the bytes
  travel on their own terms.
- **The browser peer stays a leaf** (§15 — a browser store is a leaf or aggregator, never a hub, and
  cannot BE pulled), so a renderer-heavy store on the browser peer meets the quota wall the same way any
  data does: reads keep answering, writes refuse loudly, and the remedy is export or a bigger driver. The
  design does not pretend the 5 MB wall is not there; it names the ladder as the way to live within it.

### 23.11 What v1 builds, and what it only describes

This section describes the whole; the build slice that follows it is deliberately narrow, and the
recommendation for that slice:

- **BUILD:** the host contract (`SurfaceGenerator<ReactApp>` over projected `SurfaceHooks`); a stock
  READ-ONLY React host whose router derives from renderer bindings; renderer-at-rest as an inline text-
  ESM unit; the route binding + push-time verification (existence + field coverage, §23.4); the byte-door
  and the bytes envelope (§23.7); and the resolver-in-snapshot fold that the pinned-renderer guarantee
  requires (§23.8 build note).
- **DESCRIBE, defer to their own slices:** write-enabled renderers and the pen story (§23.3) — after the
  read host proves out; the full ocap sandbox hardening (SES/Worker isolation, §23.9) — a capability-
  security slice; the public-declaration amendment (§23.8) — Myk's §12/§17 acceptance first; chunked
  economics (§23.10) — when a bundle exceeds the inline rung; and the §24 quarantine trust UI — §24's own
  ticket, which this section is the input to.

**Boundaries, in the §13 register.** A renderer is a surface, not law: mounting one never widens what a
door may lawfully answer (§17), a read-only face is a smaller world and not a bypass, and a foreign
renderer is inert until blessed (§8/§12). A pinned renderer fixes a READING, not the ground: "works
forever" means the lens is stable, not that the data stopped growing (§13 — views are perspectival). And
the host holds the keys, always: a renderer's authority is exactly the handles it was injected, so "push
deltas, get software" never means "push deltas, get authority" — the pen is the user's or a revocable
grant's, never the code's to seize.

**Provenance.** Design drafted (Claude, 2026-07-14); **reviewed and refined by Myk the same day**; the
direction is accepted and these decisions are now settled (pending the build):

- **Host contract** — projected `SurfaceHooks`; a renderer is, for all it knows, a React app against a
  bundled GraphQL service (Myk).
- **Whose pen writes** — the `renderer` write-path label; default the user's own pen, and a SANDBOXED
  renderer's writes are scoped to the discardable sandbox pool, never canonical (Myk).
- **Push-time verification** — existence + field coverage, best-effort by design (a living system can only
  catch so much) (Myk).
- **Router discipline** — renderers pinned like schemas, with a default route serving the most-recent pin
  (Myk).
- **Struck-version behavior** — DECIDED (Myk, 2026-07-15): an app is a live view over SURVIVING deltas and
  never outlives its source; withdraw / erase / quarantine-drop all stop the serving. No app runs after
  its law is gone. (This corrected the draft's "hard pin outlives withdrawal," which had contradicted
  §21's own 410-on-withdrawal.)
- **Public-door amendment** — a declaration is publication, not a probe; a public declaration may name
  pinned versions (Myk: "sounds right"). A genuine §12/§17 amendment.
- **Trust** — TWO distinct axes (Myk's key precision): delta-isolation (a separate, opt-in-queryable,
  discardable pool — the sandbox exists to keep untrusted deltas out of canonical history WHILE allowing
  full opt-in interop) and code-confinement (§6 ocap). This refines §24's one-way glass and is an input to
  §24's own design.
- **Economics** — the snapshot ladder; a strict ceiling past which binaries do NOT ride deltas at all
  (federation cost + abuse) (Myk).
- **Bytes-in-views** — DECIDED earlier (Myk, 2026-07-14): the `{ mime, ref, base64url? }` envelope + byte-door.

Realizes ADLC ticket T4. Depends on §21 (a renderer pins a VersionedSchema) and §22 (the snapshot
doctrine). **Review posture for the BUILD (the sanctioned panel exception, CLAUDE.md):** a three-angle
panel — substrate-semantics · capability-security · correctness-API — not one generalist, because §23 is
where Loam first executes a foreign author's code with a user's face around it.

**v1 BUILD LANDED** [#99](https://github.com/bombadil-labs/loam/pull/99) — the §23.11 read-only slice. A
renderer is a content-addressed ESM bundle pushed as a delta (`src/gateway/renderers.ts`), bound to a
route + schema + optional §17 vN pin, with a `renders` key under `loam.renderer` — read live by
`readRenderers` (latest-per-route, lawful slice only), exactly as `readRegistrations` derives the surface.
`Gateway.publishRenderer` proves it at push (operator-only; the schema registered; a pinned version
exists; every consumed field is a real property; the bundle loads to a function); `Gateway.serveRoute`
resolves the node under the door's discipline and executes the bundle to HTML. The door is
`GET /:mount/app/<route>/<entity>` (`src/server/http.ts`), on both the full and anonymous doors — the
anonymous door serving only a publicly-declared lens's latest version (§17). The bundle rides the shared
content-addressed ESM loader (`src/gateway/esm.ts`, now shared with §22 resolvers). **v1 pins a schema by
its §17 vN**, which already freezes the reading — resolvers included (§22, version-level) — so the
resolver-in-snapshot fold and name@hash schema-snapshot pinning defer cleanly to the slice that first
pins by schema content-hash. **Deferred to their own slices (spec/23 §23.11):** the live browser React
host + client hydration + subscription; write-enabled renderers + the pen (§23.3); the ocap SES/Worker
sandbox hardening (§23.9); the byte-door + bytes-in-views (§23.7); the §12/§17 pinned-public amendment
(§23.8); chunked economics; and the §24 quarantine trust UI. v1 executes the operator's OWN bundles in a
governed store (only operator law binds, §7); untrusted-code confinement is that named §23.9/§24 work.
Village act `demos/village/phase23.mjs` (PUSH DELTAS, GET SOFTWARE, 4/4). **Panel-reviewed** (the
sanctioned three-angle exception): substrate-semantics, capability-security, correctness-API. Fixes
folded from the panel: a pin freezes the version's CONTENT ADDRESS not the shifting numeric vN alias, and
field-coverage is checked against the PINNED version's schema (so the §23.4 guarantee holds for the
reading actually resolved); every serve refusal is a UNIFORM 404 (no existence oracle), an unloaded
bundle is UNMOUNTED (404) not a 500, and `prepareRoute` pre-loads on the serve path. The panel's headline
residual — a bundle runs SYNCHRONOUSLY with no timeout, on the anonymous door with an attacker-chosen
entity — is the deferred §23.9/§24 sandbox work, documented in `serveRoute` and accepted as v1's
operator-authored-in-a-governed-store trust model.

**§23.7 BYTE-DOOR + BYTES-IN-VIEWS — v1 BUILT** [#102](https://github.com/bombadil-labs/loam/pull/102)
(realizes ticket T9). A `bytes` leaf in a resolved view now serializes to the self-describing envelope
`{ mime, ref, base64url? }` at every view→JSON seam — the gql `ViewValue`/`BytesValue` scalars, the REST
`nodeBody`, and the renderer host itself (`serveRoute` hands the renderer the same envelope, so a bundle
paints `<img src="/:mount/bytes/${ref}?from=…">` without ever touching a `Uint8Array`). One shared helper
`src/gateway/bytes.ts` (`bytesEnvelope`, `findBytesByRef`, `INLINE_MAX = 512`, `bytesRefOf`) is reused by
all three plus the door; `ref` is `contentAddress` over the RAW bytes (equal to rhizomatic's bytes-target
identity, asserted in a test), `base64url` is rhizomatic's unpadded url-safe encoding, present only below
the inline threshold. `ResolverOutputType` gains `bytes` (§22.6) so a field is ADVERTISED as bytes —
GraphQL `BytesValue`, OpenAPI `format: binary`. The byte-door is `GET /:mount/bytes/<ref>?from=<lens>/<entity>`
(`Gateway.serveBytes`, wired on both doors in `src/server/http.ts`): PROOF-OF-READ — it re-resolves the
named lens+entity under this door's own discipline (public → a declared lens only) and serves the bytes
only if that live view actually contains a `BytesView` whose content address is `ref`. Every miss —
unknown ref, wrong `from`, a lens this door may not read — is a UNIFORM 404, so a stranger learns nothing;
the re-resolution IS the lookup (no store scan). §11 erasure falls out for free: the door never caches, so
a purged source delta drops from the live view and the ref 404s by construction. Additive/non-breaking (a
store with no bytes is unchanged) → no §20 migration. Tests `test/gateway/bytes.test.ts` (11) +
`test/server/byte-door-http.test.ts` (4); village act `demos/village/phase-bytes.mjs` (A FACE MADE OF
BYTES, 3/3): a Portrait renderer paints an `<img>` at the byte-door, the raw image bytes return over HTTP,
and erasing the avatar darkens the door. Capability-security review: the door reuses `serveRoute`'s exact
`surface(door)` + resolve discipline, so it opens no read path GraphQL/REST don't already (the mount is the
read boundary, §7); the fs/net confinement of executable consumers remains the §23.9/§24 work.

**Queued build slices — design firmed (Myk, 2026-07-15), authored as coldstart-clean tickets so a fresh
session can build each end-to-end.** (1) **T9 — the byte-door + bytes-in-views (§23.7)** — BUILT (above).
(2) **T10 — pinned-public (§23.8)**: a
`loam.public` declaration may name `Name@vN`, frozen to the version's content address, so the anonymous
door serves a pinned renderer route because a declaration is publication, not a probe. (3) **T11 — the
renderer sandbox + timeout (§23.9)**: each render runs in a Node `worker_threads` Worker with a HARD
timeout (terminate on overrun) + `resourceLimits` — closing the panel's wedge-the-process residual; the
honest scope is that a Worker bounds the HANG/crash/memory, while no-fs/no-net object-capability isolation
(SES-in-worker or isolated-vm) is a further hardening, deferred. (4) **T12 — write-enabled renderers
(§23.3)**: the headless granted-author path — a rendered `<form>` POSTs and the store signs the delta
under a per-renderer GRANTED AUTHOR (§6's runner-identity custody: provision the pen, grant it standing,
revoke by striking the grant); the user's-own-pen variant defers to the browser-host slice. The live
browser React host itself remains a design-stage unit (hydration, the client bundle, the live subscription
transport) — a design pass before a build.
