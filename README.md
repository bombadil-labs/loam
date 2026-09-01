# Loam

Beneath everything that grows, there is ground.

Loam is a general database built on [rhizomatic](https://github.com/bombadil-labs/rhizomatic) — a
portable format for signed, content-addressed deltas whose merge is union: order-blind,
idempotent, conflict-free. Rhizomatic is the format and the reactive core; Loam is the wrapper
that makes it a deployable, GraphQL-fronted, persistent, multi-tenant, federatable server.

Its shapes are grown, not imposed — you declare a hyperschema and a schema (a shape, and how to read it), and the medium resolves
your data into views, maintains them live, and remembers everything. Nothing is deleted; the
store only ever learns. Two Loam instances that meet simply merge. Trust is a lens the reader
holds, not a verdict the ground hands down.

The design is in [SPEC.md](SPEC.md), the working record in [JOURNAL.md](JOURNAL.md), and the backlog
of unbuilt work as ADLC tickets in `.adlc/tickets/`. This page is the manual;
[how the repo is organized](#how-the-repo-is-organized) is spelled out below.

**New here? Take [the interactive tutorial](https://bombadil-labs.github.io/loam/tutorial.html)** — it hands
you a real store running in your browser (no signup, no server, nothing to install until the
last step) and teaches Loam by growing one: fifteen lessons from "you are the operator" to
carrying your store out of the tab and serving it from your own machine, the same store proven
hash for hash.

**Evaluating the repo — human or agent?** Start in [`demos/`](demos/README.md): the tutorial's
source lives there, and beside it the **village** — five federated stores, an adversary, and a
ledger mapping every demonstrated behavior to the machinery that proves it, end-to-end over
real HTTP.

---

## Install

Loam is a Node package (Node ≥ 24) that ships both a library and a `loam` CLI.

```sh
npm install @bombadil/loam
```

It depends on `@bombadil/rhizomatic` (the substrate), `graphql`, and `better-sqlite3` (the durable
store driver — a native addon with prebuilt binaries for common platforms).

**Running from a clone.** If you were handed this repository rather than the package, build it
first — the `loam` command lives at `dist/cli/bin.js` and does not exist until you do:

```sh
npm ci && npm run build
node dist/cli/bin.js --help
```

Add `npm link` if you would rather type `loam` than the path. Everything below says `loam`; from a
clone, read that as `node dist/cli/bin.js`.

## The model in one breath

- A **delta** is a signed, content-addressed fact. A **store** is a grow-only set of them.
- A **HyperSchema** gathers the deltas relevant to an entity into a **Hyperview**; a **Schema**
  resolves that hyperview into a **View** — the answer. One hyperschema, many schemas; one schema,
  many entities.
- The **Gateway** fronts one store: it derives a GraphQL surface from the (schema, policy) pairs
  you register, and serves `query`, `mutate`, and `subscribe` over it.
- **Capabilities** govern writes: nothing is written except by a verified author a surviving
  grant permits. The **operator** (the gateway's signing seed) roots the chain.
- **Federation** is union at the substrate: peers exchange verified deltas; trust is the reader's
  policy lens, never a write denial.

## Quickstart — the CLI

```sh
# create a home directory and mint an operator identity (the seed is written 0600, never printed).
# At a terminal this is guided — it also asks for a first user and stocks the shelf (§54); piped
# and flagless it stays the bare two-file init.
loam init --home ./my-store

# give the store a shape. `--stock` registers one Loam ships, so day one needs no hand-written
# gather term: the shelf is event, note, org, person, post, and the shallow-person reading
# they nest (`loam register --help` describes each).
loam register --stock note --home ./my-store

# inspect a store
loam store --home ./my-store

# serve it over HTTP with a bearer token. `serve` holds the terminal until you stop it, so run it
# in the background — the curl below reads $TOKEN from this same shell.
export TOKEN=$(openssl rand -hex 16)
loam serve --http --home ./my-store --token "$TOKEN" --port 4321 &
```

Then write a note and read it back. Nothing was configured but the registration — the GraphQL
surface is generated from it:

```sh
curl -s localhost:4321/default/graphql \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"query":"mutation { note(entity: \"note:groceries\", title: \"milk\") { title _hex } }"}'

curl -s localhost:4321/default/graphql \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"query":"{ note(entity: \"note:groceries\") { title } }"}'
```

Run `kill %1` when you are done. The quickstart backgrounds a server on port 4321; the suite
binds only ephemeral ports, so a forgotten server breaks nothing — it just keeps serving. To use
a second terminal instead, export the same `TOKEN` there — `serve` never prints it.

A stock schema is an **ordinary registration**, never a shortcut past one: it crosses the same
door, meets the same validation, and lands the same deltas as a file you wrote. Outgrow the shelf
and you register your own by path — `loam register my-schema.json --home ./my-store`.
[Schemas are data](#schemas-are-data) spells that file out stage by stage. The shelf itself is
exported as `STOCK_SCHEMAS` if you would rather start from a working shape than a blank file —
it is frozen through, so copy an entry (`structuredClone`) and edit the copy.

One thing the shelf does not decide for you: a stock shape reads **every author's claims, and
every author's strikes**. Its gather selects on the pointer alone — no `authoredBy` — and masks
negations with `drop`, so on a store that federates, a peer can both retract a field and set one.
Every stock prop is `pick byTimestamp desc`, so a peer's `Note.title` with a later timestamp wins
your view and keeps winning. Both halves need answering, and a trust mask alone answers only the
strikes: pass `authoredBy` to the gather so the outer select admits your operator only, or order
the props `byAuthorRank` so a stranger cannot outrank you. A store that federates writes its own
body. This is why the shelf is a starting point rather than a deployment.

`loam serve` self-initializes: a fresh home mints (or, via `LOAM_SEED`, imports) an operator
identity, so a container serves with nothing but a token. Configuration is by flag or environment:

| flag           | env          | meaning                                        |
| -------------- | ------------ | ---------------------------------------------- |
| `--home DIR`   | `LOAM_HOME`  | the store's home directory (default `.loam`)   |
| `--token TOK`  | `LOAM_TOKEN` | the bearer token (required to serve)           |
| `--port N`     |              | HTTP port (default 4321; `0` for ephemeral)    |
| `--store PATH` |              | override the store file path                   |
| `--seed HEX`   | `LOAM_SEED`  | import an operator seed instead of minting one |

Four more flags open the store beyond loopback. They are off by default, and each one widens reach,
so they are listed apart from the table above rather than buried in it:

| flag                      | meaning                                                              |
| ------------------------- | -------------------------------------------------------------------- |
| `--host ADDR`             | the bind address (default `127.0.0.1` — loopback only; `0.0.0.0` opens the LAN) |
| `--archive DIR`           | mirror every delta into a cold store inside the home                 |
| `--public-url URL`        | the outside address this store is reached at — opens connector discovery |
| `--oauth-allow-redirect O`| comma-separated origins a connector may redirect to (needs `--public-url`) |

## The commands

`loam <command> --help` describes any of these in full. The quickstart uses four of them; the rest
exist and are easy to miss.

| command    | what it does                                                                |
| ---------- | --------------------------------------------------------------------------- |
| `init`     | create a home — and at a terminal, a first user and a stocked shelf with it  |
| `serve`    | boot a store and serve it (GraphQL + SSE + MCP over HTTP)                    |
| `register` | define a schema from a file and register it in the home's store              |
| `pull`     | land a peer's deltas — a live URL or a frozen offer file                     |
| `federate` | open, list, adjust and sever federation channels                             |
| `store`    | inspect a store                                                              |
| `migrate`  | read an offer, re-express it in the current format, write it back            |
| `user`     | provision a login user and manage role assignments                           |
| `grant`    | read the ledger of every author with standing; grant and revoke              |
| `client`   | mint and revoke non-interactive client credentials — a key, its grants, and a bearer in one motion |
| `pen`      | provision a renderer pen: mint its seed, grant it write standing             |
| `artifact` | ask whether a route may be published as an artifact, and what it could do    |
| `repair`   | list and settle a store's quarantine                                         |
| `slate`    | read the erasure slates staged over this store                               |
| `erase`    | forget one delta at the bytes, on every tier, and leave a receipt             |
| `tombstones` | read the receipts: which ids this store forgot, for whom, and why           |

## The HTTP API

A served store answers these doors per mount, behind a `Bearer` token:

- **`POST /:mount/graphql`** — `{ query, variables? }` → `{ data, errors }`. Both queries and
  mutations; the mutation acts as the token's identity. Every query field takes `asOf` (a
  millisecond timestamp) and every view carries `_asOf` and `_forgotten` — the past as it stood,
  confessing its lawful redactions (SPEC §26).
- **`GET /:mount/subscribe?query=…`** — a `text/event-stream` (SSE). The query must be a
  `subscription` operation (`subscription { plant(entity: "…") { height _hex _fromHex _changed } }`):
  an initial snapshot, then one `data:` frame per change (`_fromHex → _hex`, `_changed`, and the
  fields).
- **`POST /:mount/mcp`** — an MCP JSON-RPC surface (`initialize`, `tools/list`, `tools/call`)
  exposing `loam_query`, `loam_mutate`, `loam_register`, `loam_whoami`, `loam_docs`, and the
  four `loam_federate_*` channel tools.
- **`GET /:mount/whoami`** — who this door resolves the caller to be, and what standing the
  ground currently grants them (SPEC §56). Answers the anonymous too, uniformly, saying in words
  that reads are masked — an empty view for an unrecognized caller is not an empty store.
- **`POST /:mount/register`** — `{ hyperschema: { name, alg?, body }, schema, roots, entity? }` →
  `{ registered, lens, entity, bound }` (operator token only). The hyperschema-schema mutation mechanism, served:
  the definition and its registration land as deltas, and the surface serves the new type
  immediately. Republishing at the same entity evolves it. (An endpoint rather than a GraphQL
  mutation because an empty store has no GraphQL surface to mutate through — this is how it
  gains one.)
- **`POST /:mount/append`** — `{ deltas: [wire deltas] }` → `{ accepted, duplicates }`. The
  **non-custodial door**: a client signs its own deltas and presents them; the token
  authenticates transport only, and each delta is authorized by its own verified author's
  standing. The server never holds the key.
- **`/:mount/rest/<v1|@hash>/<Schema>/<entity>`** — the REST/OpenAPI door, generated from the
  same registrations as GraphQL (the `surface/` generator seam).
- **`GET /:mount/federate`** — the store's published deltas as wire JSON (operator token only).

A junk token is `401`; an unknown mount is `404` (only to the authenticated — an unauthenticated
caller cannot tell a real mount from a missing one). A missing token is `401` too, with two
deliberate exceptions: `whoami` answers the anonymous with its masked-reads sentence, and a mount
whose operator opened a public read surface (SPEC §12) serves anonymous reads on it.

```sh
curl -s localhost:4321/default/graphql \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"query":"{ note(entity: \"note:groceries\") { title _hex } }"}'
```

## Connectors — reaching a store from an MCP client

`POST /:mount/mcp` serves MCP with a bearer token, which is enough for a local client. A hosted
client such as Claude cannot hold a bearer token, so it authenticates through the store's own OAuth
authorization server. Two flags open that door:

```sh
loam serve --http --home ./my-store --token "$TOKEN" \
  --public-url https://store.example \
  --oauth-allow-redirect https://claude.ai
```

`--public-url` is the address the outside world reaches, and it must be the address the client
dials — the store publishes it in its discovery documents, so a mismatch stops the handshake before
authentication. `--oauth-allow-redirect` names the origins a connector may return to after consent.
Together they open discovery, dynamic client registration, consent, and token exchange; without
them the store serves MCP to bearer tokens only.

The store must be reachable over **HTTPS**, terminated in front of Loam — a tunnel, a reverse
proxy, or a funnel. Serve behind the terminator and name the public address with `--public-url`.

Two practical notes, both learned the hard way. Claude's custom connectors dial **port 443**
regardless of the port in the URL, so the public address must be reachable there. And a store with
users refuses a non-loopback bind without HTTPS, because the login session cookie is `Secure` and a
browser discards it otherwise — the refusal is deliberate and says so.

**What a connector token can reach, stated plainly.** A connector's token resolves against the
**whole mount**. Loam has no read verb today: reads are not scoped per user, so a connector
authorized against a store reads every lens and every delta that mount serves, and the same token
opens `/graphql`, `/subscribe`, `/rest`, and `/append`. Grants scope **writes**, not reads. So
inviting someone to connect to your store is inviting them to read all of it. Give a guest their own
store and federate, rather than a connection to yours, unless you mean to share everything.

## Embedding the library

Everything the CLI and server do is a small API you can drive directly.

```ts
import { Gateway, MemoryBackend, SqliteBackend, entityGatherBody, serve } from "@bombadil/loam";

// A store, governed by an operator seed. Omit the seed for an ungoverned local store.
const gateway = await Gateway.open(new SqliteBackend("./store.sqlite"), { seed: operatorSeedHex });

// Register a (HyperSchema, Schema) over the roots you want held live. The schema's body is a
// rhizomatic term; the policy's props name the GraphQL fields and their shapes.
// `entityGatherBody()` is the ordinary one — everything pointing at the root, bucketed by context.
// It is a named constructor for the term "Schemas are data" spells out stage by stage below; reach
// for `expandedGatherBody({ role, schema, reading })` when a field expands into a child's own view.
gateway.register(
  {
    name: "Plant",
    alg: 1,
    body: entityGatherBody(),
  },
  {
    props: new Map([["height", { kind: "pick", order: { kind: "byTimestamp", dir: "desc" } }]]),
    default: { kind: "pick", order: { kind: "byTimestamp", dir: "desc" } },
  },
  ["plant:fern"],
  undefined, // claim templates, if the schema declares write shapes
  ["height"], // writable: fields are read-only until named here (§21)
);

// Query returns a content-addressed snapshot: same deltas, any order, any machine → same _hex.
const result = await gateway.query(`{ plant(entity: "plant:fern") { height _hex } }`);

// Serve it (multiple mounts, each a separate store; tokens map to identities).
const server = await serve({
  mounts: { default: gateway },
  tokens: { [tokenHex]: { operator: true } },
  port: 4321,
});
```

`Gateway.boot(backend, genesis)` opens a store already governed and registered from a genesis
delta-set (`assembleGenesis({ operatorSeed, registrations, grants })`). `register` binds in this
process only; `publishRegistration` (and the genesis) lands the schema **as deltas**, so a
reopened store grows its surface back with no re-registration code.

## Schemas are data

A schema is not configuration — it is DEFINED by deltas, like everything else. Registering a
schema lands two of them:

- a **definition** — rhizomatic's hyperschema-schema claims (`publishHyperSchemaClaims` shape: name,
  alg, and the body as canonical CBOR) filed at a hyperschema entity, `hyperschema:<Name>` by default;
- a **registration** — a reference under `loam.registration`: a `hyperschema` pointer to that
  entity, the `schema` (the resolution program) as canonical JSON, and the roots. No schema body
  rides it.

The GraphQL surface is **generated**: on boot (and after every publish) the gateway
meta-resolves each referenced entity via `loadSchema` over the surviving definitions. The
consequences are the whole point:

- **Evolution is append.** Republish a definition at the same entity and the surface serves the
  new shape. The schema's identity is the _entity_, not the name. Two of the three doors serve it
  **live, with no restart** — `publishRegistration` and `POST /:mount/register`, both of which go
  through the running gateway. **`loam register` does not.** It writes the deltas to the store
  file, and a server already running answers from the memory it booted with, so it keeps serving
  the old shape until you restart it. The CLI says so when it sees a live server.
- **Deprecation is negation.** Negate a definition and its registration is unbound; the type
  drops from the surface. Nothing is deleted; the store only learns.
- **Foreign law stays inert.** In a governed store only operator-authored definitions and
  registrations bind — a peer's federated definition merges as data and reshapes nothing, the
  same discipline that keeps foreign grants powerless.
- Streams subscribed before an evolution keep watching the shape they subscribed to; new
  subscriptions see the new shape.

The `loam register` file — the **exact same shape** `POST /:mount/register` and the MCP
`loam_register` tool take, so a registration is one object you can drop into a file, POST, or hand
the tool. It mirrors the parts: a **HyperSchema** (the gather) and a **Schema** (the resolution).

```json
{
  "hyperschema": {
    "name": "Plant",
    "alg": 1,
    "body": {
      "op": "group",
      "key": "byTargetContext",
      "in": {
        "op": "select",
        "pred": { "hasPointer": { "targetEntity": { "var": "root" } } },
        "in": { "op": "mask", "policy": "drop", "in": "input" }
      }
    }
  },
  "schema": {
    "props": { "height": { "pick": { "order": { "byTimestamp": "desc" } } } },
    "default": { "pick": { "order": { "byTimestamp": "desc" } } }
  },
  "roots": ["plant:fern"],
  "writable": ["height"]
}
```

**Anatomy of a registration.** Four parts — the whole read pipeline lives in the first three, and
the fourth is the only door out:

- **`hyperschema`** — the gather program:
  - **`name`** — the GraphQL field it generates (`{ plant(entity: …) }`) and the default entity
    (`hyperschema:Plant`). Identity is the entity, not the name — rename freely by republishing at it.
  - **`alg`** — the L2 **algebra version** the `body` is written against (_not_ a signing algorithm).
    There is one algebra today, so this is always `1`; it exists so a v1 body keeps its v1 meaning
    if the algebra ever grows a v2.
  - **`body`** — a rhizomatic **gather term**, evaluated once per root. It selects and buckets the
    relevant deltas; a pure function of the ambient root, so it resolves the same on every machine.
- **`schema`** — the resolution program (a **Schema**): a per-property reduction — each prop names a
  GraphQL field and says how to fold that bucket's deltas into one value. Each prop's rule is a
  **Policy**; the map of them is the Schema. A Policy's JSON holds exactly one of five kinds:
  - **`pick`** — the newest (or, per `order`, the first) surviving entry:
    `{ "pick": { "order": { "byTimestamp": "desc" } } }`.
  - **`all`** — every surviving entry, in order:
    `{ "all": { "order": { "byTimestamp": "desc" } } }`.
  - **`merge`** — the bucket reduced by an addend function — `max`, `min`, `sum`, `count`,
    `and`, `or`, `concatSorted`:
    `{ "merge": "sum" }`.
  - **`conflicts`** — the surviving entries whose authors disagree, in order:
    `{ "conflicts": { "order": { "byTimestamp": "desc" } } }`.
  - **`absentAs`** — a constant to stand in when the bucket is empty, then the Policy for when it
    is not: `{ "absentAs": { "const": 0, "then": { "pick": { "order": { "byTimestamp": "desc" } } } } }`.
  An `order` is `{ "byTimestamp": "desc" | "asc" }`, `{ "byAuthorRank": [ … ] }`,
  `{ "byPred": { "pred": …, "then": … } }`, `{ "chain": [ … ] }`, or the bare `"lexById"`.
- **`roots`** — the entities held **live**: the gather runs for each, and its view stays current
  as deltas arrive.
- **`writable`** — the fields that accept a **surface write**. Immutable by default (SPEC §21): a
  field is read-only until named here, and omitting the list entirely leaves the whole schema
  read-only — which is why the example names `height`, the field its mutation writes.

The `hyperschema.body` reads inside-out, each stage feeding the next:

1. **`mask` / `drop` over `input`** — `input` is the store's whole delta set; `drop` applies
   retractions and passes on only the deltas still standing. (Nothing is erased — a retraction is
   just another delta the mask honors.)
2. **`select` … `hasPointer { targetEntity: { var: root } }`** — keep only deltas that carry a
   pointer **at the current root** (`plant:fern`). `{ var: root }` is the ambient entity the gather
   is running for.
3. **`group` / `byTargetContext`** — for each surviving delta, file it under the **context** label
   of the pointer that targets the root. A delta pointing at `plant:fern` with context `height`
   lands in the `height` bucket. The result is a hyperview: one root, its buckets.

Then the **Schema** folds each bucket. `height` and the `default` both `pick` the entry with the
newest timestamp (`order: byTimestamp desc`), so `plant(entity: "plant:fern") { height }` returns
the latest recorded height and drops the rest. Add a `width` prop and you'd surface that bucket
too; leave it out and the bucket stays gathered but unread.

`loam register` writes to the home's store directly, so run it before `loam serve` (the store is
single-writer); a running server takes the same registration over `POST /:mount/register`.

## Writes are claims

A relation is one delta with many pointers — "Miles hosted a screening of The Matrix with Wren
and Sally on July 4" is ONE fact filing simultaneously into four entities' views. The schema
declares its write shapes as **claim templates** (data, traveling in the registration beside
the read program), and each template becomes a GraphQL mutation that emits exactly one signed
delta:

```jsonc
// in the register file/body, beside hyperschema/schema/roots:
"mutations": {
  "hostScreening": {
    "pointers": [
      { "role": "host",  "at": { "arg": "host" },   "context": "events_hosted" },
      { "role": "film",  "at": { "arg": "film" },   "context": "screenings" },
      { "role": "guest", "at": { "arg": "guests" }, "context": "events_attended", "each": true },
      { "role": "date",  "value": { "arg": "date" } }
    ]
  }
}
```

```graphql
mutation {
  hostScreening(host: "person:miles", film: "film:the-matrix",
                guests: ["person:wren", "person:sally"], date: "2026-07-04") { delta }
}
```

Because templates travel with the schema, everyone who adopts a published schema **emits
byte-compatible facts** — the schema is a protocol, not just a lens. Each template is
trial-proven at registration: a mutation whose writes its own reads could never see is refused.
For shapes no template anticipated there is the generic **`_claim(pointers: […]) { delta }`**;
for clients that keep their own keys there is `POST /:mount/append`. The old primitive-prop
mutations (`plant(entity:…, height: 4)`) remain as convenient sugar.

**Removing a value is retraction, not `set(null)`** (SPEC §14). Writing is the dual of reading: a
field is a bucket resolved per-Policy, so to clear one you negate your OWN contributions to it and
it re-resolves — the next `pick` steps up, an `all` list loses your tag, a `merge` withdraws your
addend, and a field only you spoke for goes absent (rendered per its `absentAs`, so the null-ness
lives in the lens, never on a reference). GraphQL exposes `clear<Type>(entity, fields: […])`; the
REST door maps it to `DELETE /:mount/rest/vN/<Schema>/<entity>`. Retract-your-own is the whole
reach: a clear never touches another author's claim — to keep others' claims out of a view you
narrow the schema Policy, not the ground.

To withdraw ONE value rather than a whole field there is `remove<Type>(entity, field, values: […])`
(REST: a `DELETE` with an object body `{ field: [values] }`) — the one tag you added, a specific
`merge` addend, the rest of the field left standing. Which fields accept a write at all is the
registration's **`writable`** list, and the posture is **immutable by default** (SPEC §21): only the
fields it names accept a surface write, and the rest are read-only — assert, clear, and remove refuse
them with a reason, and a read-only prop is offered as no mutation argument at all. Omit `writable`
and NOTHING is writable; silence means "you may not". It disciplines the front door, never the
ground — a reader who wants a hard guarantee still enforces it with a lens.

Every view also carries two content addresses: **`_hex`** (the resolved view — the answer) and
**`_hviewHex`** (the gathered hyperview — the evidence). Two lenses over the same body and root
share `_hviewHex` while their `_hex` differs exactly when their schemas adjudicate
differently.

## Capabilities: authors, not owners

No ambient authority — and no ownership of ids. **Entities are unowned**: a pointer is a string
that matches or doesn't, and a delta is never a free-floating fact about an entity — it is an
assertion _from a perspective_ (a verified author, an instance of origin). Anyone with standing
may point at anything; whether anyone **listens** is the reader's business (schemas, author
ranks, admission predicates, the operator-filtered constitutional reads).

What a governed store enforces is exactly one thing: **the author's standing on this
instance** — a surviving, operator-rooted `write` grant at the store entity (`loam:store`). It
is a publishing relationship, not a truth relationship.

- The **operator** (the gateway seed) needs no grant and roots the chain; an `admin` grant can
  mint further grants and retire them (revocation is negation; audit is a query).
- A gateway opened without an operator seed is an **ungoverned local store** (any verified
  delta is welcome); one with an operator asks for standing from everyone else.
- Constitutional shapes stay honest: a grant-shaped delta from a non-admin _lands_ (writes are
  open) and _binds nothing_ (effectiveness chains root in the operator) — the same discipline
  that keeps federated foreign law inert.

```ts
import { grantClaims, STORE_ENTITY } from "@bombadil/loam";
import { signClaims } from "@bombadil/rhizomatic";

await gateway.append([
  signClaims(grantClaims(STORE_ENTITY, aliceAuthor, "write", operator, ts), operatorSeed),
]);
// Alice may now write — about anything, acting as herself:
await gateway.query(`mutation { plant(entity: "plant:fern", height: 40) { height } }`, undefined, {
  actor: aliceSeedHex,
});
```

**Negations, governed.** A negation is an assertion like any other — _whose negations a reader
honors_ is lens policy. A plain `mask drop` body honors every negation present (the honest
default when community strikes should bind unconditionally). For a governed lens, use
`governedGatherBody(operator)`: its mask trusts only the operator and the operator's direct
grantees — resolved as a **live view over the grant deltas themselves** — so a federated
stranger's strike is inert, a community member's binds, and revoking their grant un-binds
their strikes on the very next read. `tenantSchemaFor(operator)` applies the same discipline
to the audit view (operator + operator-minted admins). The trusted sets reach **one link** of
the grant chain: standing minted by an admin binds enforcement (`holdsGrant` recurses fully)
but never enters a lens's trusted set, and an admin's revocation bars the door without by
itself shrinking the trusted sets — the operator's signature is what the lenses read.
`pullFrom`'s `admit` predicate remains the coarse boundary at the federation door.

## Derived functions (the runner)

Function _definitions_ live in the store as data; a **runner** — a peer client — reads them,
installs each into a derivation host with an implementation it holds, and animates the gateway so
they fire on ingest. A store with definitions but no runner is passive; attach a runner and it
computes. In a governed store, only the operator's blessed definitions run.

```ts
import { Runner } from "@bombadil/loam";
Runner.attach(gateway, { seed: runnerSeedHex, implementations: { "fn:avgHeight": avgHeight } });
```

## Federation

Two instances meet and merge — union, order-blind, conflict-free — over the authed HTTP surface.

```ts
import { pullFrom } from "@bombadil/loam";
// pull a peer's published deltas into the local store; verify + merge, idempotent
await pullFrom(localGateway, "https://peer.example/default", peerOperatorToken);
```

**What a store admits is data.** One operator-signed declaration at `loam:trust` sets the
door's posture — `open` (admit everything that verifies; the default, and the aggregator's
stance), `roster` (the operator plus named authors), or `closed`. `pullFrom` and `federate`
resolve the policy **live from the store's own deltas on every pull**: a roster edit is a
delta, the next pulse obeys it, and the history of who was trusted when is a query. A fresh
declaration only _adds_ to the roster; removal is negation — strike the declaration that
admitted them. The same roster reaches read-time masks via `trustRosterPred(operator)` (an
`inView` over the very same declaration deltas), so admission and resolution share one source
of truth. An explicit `admit` predicate always overrides.

```ts
import { trustClaims } from "@bombadil/loam";
// the aggregator turns selective with one delta:
await gateway.append([signClaims(trustClaims("roster", [alice, bob], operator, ts), seed)]);
```

A store publishes everything, or what its `offeredLens` (a term) selects. **Federation is union,
not a governed write:** a peer's deltas cross by signature verification alone, and whether they
shape a local view is a read-time trust choice (a policy's `byAuthorRank`) — never a write denial.
Foreign law stays inert: a peer's self-signed grant merges as a delta but governs nothing, because
it roots in no operator you blessed. **Each instance must have its own operator seed** — two
sharing one trust each other's constitution completely.

**The CLI recipe, end to end.** Pulling is one step, not the story. A governed store binds only
its own operator's law, so the first query after a pull answers `nothing is registered` — the
refusal says the store holds registrations that do not bind, foreign law is inert. That is the
design, not a bug: foreign law never reshapes your surface. The recipe that works end to end:

```sh
TOKEN=$(openssl rand -hex 16)                                                # THIS store's door token — minted here
loam pull http://peer.example/default --token "$PEER_TOKEN" --home ./mine   # their deltas, yours now
#   ^ PEER_TOKEN is the PEER's operator token — their door's secret, not yours to mint. Ask them.
loam register plant.json --home ./mine                                      # your own schema, binding here
loam serve --http --home ./mine --token "$TOKEN"                            # serve your ground
curl -s localhost:4321/default/graphql -H "authorization: Bearer $TOKEN" \
  -d '{"query":"{ plant(entity: \"plant:fern\") { height } }"}'
```

The pull makes their facts live in your store; the register makes a lens you own; the serve
answers it. A store that pulls and never registers gathered someone else's world with no way to
read it — the empty-surface refusal is the honest report of exactly that.

### Channels — federation that carries law, not only bytes

A **channel** is federation between two containers. You name a container to receive into and assign
the peer a **prefix**; their deltas land in a nested pool inside that container, and law that
arrives binds under your prefix. You register nothing.

```sh
loam federate open --from https://peer.example/default --into friends --prefix alice --token "$PEER_TOKEN"
loam federate list
loam federate set --channel channel:friends:alice --bless false     # reversible
loam federate drop --channel channel:friends:alice --yes            # not reversible
```

Then `alice_Note` answers on your own surface, from alice's law, with your operator key. The prefix
is **yours** — the peer never chooses it, so no peer can take a name your store already serves, and
a prefix that would collide at the GraphQL door is refused when you assign it.

Two toggles, both reversible and both read live from the ground: `--receiving false` freezes the
channel and keeps everything already received; `--bless false` stops new law binding and leaves law
already bound serving. Severing is `drop`, which purges that peer's pool at the bytes and leaves
every other channel whole.

**What a channel gets right, now.** Each of these was once on the not-yet list and is landed
with rails (spec §46, §47):

- **The standing sync survives a restart.** A channel's address rides its record and its token
  lives in the home at 0600, so `loam serve` rebuilds its channels at boot and says how many it
  is syncing. A channel it cannot resume is named on stderr rather than left in the list
  reporting `receiving`.
- **Two peers publishing byte-identical law both bind.** You and a friend can both start from
  `loam register --stock note`; `alice:Note` and `bob:Note` each answer with their own peer's
  data, under names you assigned.
- **A peer's sibling lenses arrive as siblings** — two readings over one definition each serve
  their own resolution under their own name.
- **A binding lives in the pool it was blessed into**, so severing takes the peer's law with the
  peer's data — nothing to retire, and a bystander channel's names keep serving.
- **A peer's app arrives inert, and one act mounts it.** `federate list` names every app a channel
  has received — route, bundle id, and whether this store runs it — and `federate bless-app
  --channel <name> --route <route>` is the only thing that mounts one. Neither toggle above reaches
  it: `blessing` governs NAMES, and running a stranger's code is a wider grant that takes its own
  act. A mounted app serves under the channel's prefix, from the channel's own pool, behind the
  probation frame, with its writes sequestered there — and dropping the channel takes it away.
- **A peer's computed fields refuse until you run their code.** A registration whose values come
  from the peer's own resolver code binds with that code WITHHELD: the fields answer with a reason
  naming the act that supplies them, and `bless-app --resolvers <lens>` is that act.

**What mounting a peer's app does not bound.** The pool bounds what that app may WRITE to your
store. It does not bound what its code may REACH: a bundle can open a socket or read the filesystem
of the machine you run this on. And only the app's RENDER runs in a worker with a time and memory
limit — its module body is evaluated on the serving thread, when you bless it and again the first
time a process is asked for it. Mount a peer's app the way you would run their program (§24.5, an
open flag).

**What channels do NOT do yet.** Each of these is real today, and each has a ticket:

- **Federating still costs a peer your operator token.** `GET /:mount/federate` demands it, and that
  token also registers root law, mints grants and reads everything. A container-scoped offer token
  is designed and blocked on where a runtime-issued credential should live (T196/T188 — T196's
  restart half landed; its shard stays open for this decision).

**Over MCP**, an agent gets `loam_federate_status`, `_connect`, `_set` and `_drop`, each scoped by a
`federate` grant naming one container. `_drop` **stages only**: it returns a link and a preview of
what would go and what would remain, and purges nothing. A person completes the sever in the browser,
behind a session an agent cannot obtain.

## Forgetting — erasure, GDPR, and harmful content

By default a store forgets nothing: revocation is negation, which _masks_ a delta from views but
keeps it in the ground, so the audit — who said what, when, and what was later withdrawn —
survives. That is the right default for a store of record. But grow-only cannot be the _only_
answer. A data subject exercises their right to erasure; a delta is later judged unlawful or
harmful; and the bytes must actually go.

**Erasure is a real, destructive operation, and it is the instance operator's alone.** Only the
operator — the data controller — may order a record removed: not its author, not a grantee, not a
peer. The substrate cannot stop anyone from _minting_ a delta, so the store is careful never to
_accept_ a removal-order it did not sign; the check runs at every door, append and federation
alike.

```ts
// the operator honors a request: purge the bytes from every tier, leave a signed hole
await gateway.erase(deltaId, { reason: "GDPR art. 17 request #4821" });
```

`erase` removes the delta from the live store **and every backing tier** — the sqlite, and the
archive vault if one is configured (a later heal will not replant it) — then re-seats the store
on what remains. What stays is a **tombstone**: a signed, append-only claim recording _that_ the
id was forgotten, by whom, and when — never the content. The store remembers that it forgot. The
door refuses the id's return thereafter (un-erasure is striking the tombstone). Content addressing
is what makes this honest: retaining a hash retains zero bytes.

The same machinery has a terminal surface, so a compliance officer needs no script:

```sh
loam slate list --home ./mine        # what is staged for erasure, who asked, and when it is due
loam erase <deltaId> --reason "GDPR art. 17 request #4821" --home ./mine
loam tombstones list --home ./mine   # every receipt: which id, whose record, when, and why
loam tombstones show <id> --home ./mine
```

`--reason` is required and has no default: the receipt is all that outlives the record, and one
that cannot say why is a receipt made less honest. If this home has a cold archive its
`config.json` does not name — `loam serve --archive vault` does not write the name there — `erase`
spots it and refuses until you name it with `--archive`, rather than sweep the primary and report a
completeness it never verified. A vault parked outside the home is beyond that check.

**The boundary, stated plainly: erasure is instance-level — Loam cannot retroactively retract a
delta that has already federated to another instance.** The physics is email you have already
sent, or a file already downloaded. Once a peer has pulled a delta it lives on _their_ ground,
under _their_ operator's authority; your erasure clears it from _your_ store and refuses its
re-entry through _your_ door, but it does not reach across the network and delete other people's
copies. Nor should it — a system where one signature could cascade a deletion everywhere would be
a censorship weapon, not a store of record. So a forged or coerced erasure order cannot propagate
a deletion: each operator decides for their own ground.

What Loam gives you instead is precise, auditable, per-instance forgetting, plus the machinery to
make erasure across a federation a _coordinated_ act rather than a magic one:

- **The tombstone travels as a request.** It federates like any claim, so downstream operators
  _learn_ that you erased — GDPR Art. 17(2)'s "inform downstream controllers," done as data. Each
  peer's operator then chooses to honor it on their own store.
- **Compliance is queryable.** Ask any store for the id and see what it returns — erased and
  refused, or still held. No ambiguity to argue about.
- **Bad actors are shut out going forward** by the trust roster (above): close the door, and the
  next pulse stops admitting them.

The honest limit: this is rigorous, controller-level erasure and severance — not the power to
unsend. No federated system can promise network-wide recall. Loam makes the boundary crisp and the
per-instance act exact, rather than pretending the boundary is not there.

## Deploy

A `Dockerfile` builds and runs `loam serve --http` as a non-root user, the store on a `/data`
volume:

```sh
docker build -t loam .
docker run -e LOAM_TOKEN=<secret> -v loam-data:/data -p 4321:4321 loam
```

Bind `127.0.0.1` and terminate TLS in front. **Hosted persistence is a driver, not an image
change**: the `StoreBackend` seam is five members — `append`, `deltasSince`, `purge`, `holds`,
`close` — so a libSQL/Turso client drops in beside `SqliteBackend` with no other change. The two
erasure members are not optional decoration: `purge` must remove bytes on every tier the driver
owns and `holds` must answer from the bytes, failing closed — a driver that stubs them breaks
erasure's completeness guarantee (SPEC §11) while looking healthy.

### Cold storage

A store can keep an **archive** — a cold mirror written in the same appends:

```sh
loam serve --http --archive /mnt/backup/vault    # or add "archive": "vault" to config.json
```

The archive is a directory of canonical delta files, one per delta, named by its content
address (`<id[0..2)>/<id>.json`). Plain file tools are backup tools here: rsync it, tar it,
copy it to a USB stick — copying files between two archives *is* replication, because merge is
union and the id is the name. The CRDT is what keeps this honest: a lagging copy is merely
behind, never wrong, so an unreachable archive never takes the store down (the lag is logged,
loudly) and every serve heals the pair by two-way union before it boots. Which means restore
after disaster is no procedure at all: delete the lost sqlite and serve again — the archive
replants it. Embedders get the same pieces as values: `MirrorBackend(primary, mirror)` and
`ArchiveBackend(root)`.

## Migrations

A store is grow-only and content-addressed, so a signed delta can never be rewritten — which makes
a breaking change to the on-wire format something you migrate to, not patch in place. Loam ships a
migration for every such change (a standing rule), and it supersedes rather than rewrites:

```sh
loam init --home ./store --seed <the store's original seed>   # re-signing is the operator's own hand
loam migrate my-export.json --out migrated.json               # old deltas in, new deltas out
```

For each delta a format change touched, the migration **re-signs** it into the new form and
**negates** the original with a negation that points `supersededBy` at its replacement and records a
reason — so the history reads as a linked chain of supersessions, nothing lost. It is idempotent
(re-running adds nothing) and composes across versions. See [SPEC §20](SPEC.md).

## How the repo is organized

**Source.** `src/` is the library and CLI, split by seam: `gateway/` (the store's surface —
GraphQL, mutations, registrations, accounts & capabilities, trust, erasure), `store/` (the
`StoreBackend` drivers — sqlite, archive/mirror, localStorage), `server/` (the HTTP server
itself — every door, MCP, login and OAuth, the admin pages), `surface/` (surfaces as
materializations — the GraphQL and REST/OpenAPI doors from one generator seam), `federation/`
(offer / pull / wire / translate), `runner/` (derived functions), `migrate/` (format migrations —
old deltas in, new deltas out), `stock/` (the schema shelf `init` and `register --stock` read),
`cli/`, and `browser/` + `client/` (the full in-page store and the
read-only public client). `test/` mirrors that tree;
[`demos/`](demos/README.md) holds the [tutorial](https://bombadil-labs.github.io/loam/tutorial.html) and the
village.

**The docs, by role — they don't overlap:**

- **[README.md](README.md)** — this file: the manual (what Loam is, how to use it).
- **[SPEC.md](SPEC.md)** + **[`spec/`](spec/)** — the design, and the record of what **is**: one
  file per shipped capability under `spec/` (`NN-slug.md`), each closed by a `**Provenance.**`
  footer linking the PR(s) that landed it and naming where it lives; `SPEC.md` is the index over
  them. Read it to understand the system; it grows only when work lands — a landing adds a new
  `spec/` file.
- **`.adlc/tickets/`** — the backlog: unbuilt and partially-designed work, as ADLC tickets, one shard each.
  The next thing to build is drawn from here, and its landing PR adds its `spec/` section file.
- **[JOURNAL.md](JOURNAL.md)** — the append-only record: one entry per step, what was done and why.
  An index over [`journal/`](journal/), one file per entry.
- **[CLAUDE.md](CLAUDE.md)** — the process this repo runs by (the ADLC lifecycle).

## Development

```sh
npm run check   # format + lint + typecheck + build + all tests — the green gate
npm test        # tests only
```

## Releasing

```sh
npm run release -- patch   # or minor / major
```

From a clean, up-to-date `main` only: runs the gate, bumps the version (syncing the in-source
constants), commits, tags `vX.Y.Z`, and pushes. The `release` GitHub Actions workflow picks up
the tag, runs the gate again, verifies the tag agrees with `package.json`, publishes
`@bombadil/loam` to npm, and cuts a GitHub release with generated notes. A tag that lies about
the version refuses to publish.

Publishing is tokenless — npm **trusted publishing** (OIDC): npm verifies that this repo's
`release.yml` workflow minted the release, and provenance is generated automatically. There is
no publish token to leak, rotate, or expire. (The one bootstrap exception: npm can only trust a
package that exists, so the very first publish was made locally by the author.)

The process this repo runs by is in [CLAUDE.md](CLAUDE.md).

## License

Licensed under either of

- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE) or http://www.apache.org/licenses/LICENSE-2.0)
- MIT license ([LICENSE-MIT](LICENSE-MIT) or http://opensource.org/licenses/MIT)

at your option.

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in
this work by you, as defined in the Apache-2.0 license, shall be dual licensed as above, without
any additional terms or conditions.
