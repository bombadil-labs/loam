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

The renderer holds no keys and no reactor. The HOST holds them and injects capability-scoped handles —
the object-capability discipline (§6) at the screen: a renderer's authority is exactly the set of handles
it was given, nothing ambient. A read-only host injects `resolve` + `watch` and no write verbs — the
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
- **Collisions.** A route is claimed by a renderer binding; the LATEST surviving binding per route wins,
  exactly as the latest registration per schema entity wins (§21). Re-pushing a renderer at the same
  route is evolution; striking it darkens the route. Two live bindings for one route is the same
  latest-wins resolution the surface already runs — no new arbitration.
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

**What happens when the pinned SCHEMA version is struck (RECOMMENDATION).** A renderer pins a
VersionedSchema, and §21 is emphatic that a snapshot never supersedes — "pin any of them and it answers
forever; the ground remembers all of them." So striking a schema version does not delete its snapshot;
it strikes the schema's REGISTRATION (stops the operator serving that version through the schema's own
doors). The recommendation keeps the two consistent: a renderer pinned to a struck version continues to
RESOLVE against the frozen snapshot on the FULL (operator) door — the pinned reading is content-addressed
and cannot be unsaid — while the host surfaces that the underlying registration was withdrawn (a "reading
a retired lens" banner, honest per §13). Striking a schema version stops NEW bindings to it and its
public reveal (§23.8), never a pin already taken. Erasure (§11) is the stronger promise and reaches
everything: a renderer whose bytes are purged 404s like any other content; a purged asset it references
404s at the byte-door.

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
- **The byte-door: `GET /:mount/bytes/<ref>`** returns the raw bytes with `mime` as `Content-Type`,
  inheriting §17 read discipline (serve only what the caller may LAWFULLY read — a raw-hash endpoint on
  the anonymous door would be exactly the existence oracle §17 already closed, so the byte-door authorizes
  against the same tokens and public declarations as every other read) and §11 erasure (a purged asset
  404s — the tombstoned id is refused re-entry forever).

### 23.8 The public-door tension — a declaration is not a probe (RECOMMENDATION)

§17 deliberately narrowed the anonymous door: the PUBLIC projection serves only the LATEST version per
declared name, because an anonymous `@hash` probe was a registration-existence oracle across the whole
ground, and "history is not anonymous." But a renderer PINS a VersionedSchema, and village-as-a-URL wants
strangers reading a rendered route that is, by construction, pinned. The two must be reconciled, and the
reconciliation is a distinction §17 half-stated: **a probe is DISCOVERY; a declaration is PUBLICATION.**
The anonymous door refuses `@hash` probes because a stranger learns what versions exist. But when the
OPERATOR names a version in a public declaration, the operator CHOSE to reveal exactly that version —
that is not the stranger probing history, it is the operator publishing a version. So:

**RECOMMENDED §12/§17 amendment.** The `loam.public` declaration's vocabulary grows from `[schemaName]`
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

### 23.9 Trust for executable consumers — the sharpest edge

A renderer runs code a host did not write, and federation makes that acute: a confluence ships apps, and
a peer's renderer is executable law. The floor is the one the whole substrate already stands on —
**inert-by-default** (§8/§12/§15): a foreign renderer's deltas cross (union is union), its testimony is
all present, and its law stays inert. In a governed store only operator-authored renderer bindings bind,
so a foreign renderer mounts NOTHING until the operator blesses it — "data federates; authority never
does," now at the screen.

Blessing does not start from zero. **§6 already names the discipline: object-capability confinement —
`isolated` bodies in a SES / Worker / wasm compartment, required for federated code.** Renderers inherit
that doctrine at the screen; they do not invent a parallel sandbox. Concretely:

- **The host mounts every renderer in an ocap compartment** whose ONLY capabilities are the `SurfaceHooks`
  handles the host injects (§23.2). No ambient store, no ambient network, no DOM beyond its mount point —
  a renderer reaches the world only through the capability-scoped handles, so a foreign renderer can do
  exactly what its projection allows and nothing more. A read-only projection cannot write; a full
  projection writes only through the door discipline, under the pen its binding is scoped to (§23.3).
- **Quarantine-first is the posture for federated renderers (§24).** A foreign renderer lands inert,
  and the trust UI mounts it in a visibly SEQUESTERED frame — "this is probation; its writes go into a
  staging pool, not your ground" — until the operator promotes it. Blessing is a promotion out of
  quarantine (§24's one-way glass), not a boolean flipped in the dark; the two-authority discipline (§6)
  holds — blessing the renderer and granting its pen are different keys.
- **The budget is §6's, and §24 tightens it.** Executable code carries a divergence guard (§6's lifetime
  trigger count); a renderer's compute, its subscription fan-out, and its asset appetite are resource-
  disciplined so a mounted stranger's cost stays confined to the stranger's frame — the same "confine a
  stranger's resource cost to the stranger's door" §12 already runs for public watches.

This is the sanctioned panel-review surface: capability-security is one of the three angles §23's
prosecution must run (§23 provenance), because a renderer is the first place Loam executes a foreign
author's code with a user's face around it.

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
  else.
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

**Provenance.** Design drafted (Claude, 2026-07-14); **awaiting Myk's acceptance — not landed.** Realizes
ADLC ticket T4; describes the full renderer model and builds none of it yet. Questions decided arrive
DECIDED (bytes-in-views, Myk 2026-07-14); the open ones — the host contract shape, whose pen writes, the
module contract, the router discipline, the struck-version behavior, the push-time compatibility relation,
the public-declaration amendment, and the trust/sandbox posture — are carried as reasoned RECOMMENDATIONS
for Myk's review. Depends on §21 (a renderer pins a VersionedSchema) and §22 (the snapshot doctrine, and
the resolver-in-snapshot fold that lands here). **Review posture (the sanctioned panel exception,
CLAUDE.md):** a three-angle panel — substrate-semantics · capability-security · correctness-API — not one
generalist, because §23 is where Loam first executes a foreign author's code with a user's face around it.
