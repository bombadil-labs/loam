# Loam

Beneath everything that grows, there is ground.

Loam is a general database built on [rhizomatic](https://github.com/bombadil-labs/rhizomatic) — a
portable format for signed, content-addressed deltas whose merge is union: order-blind,
idempotent, conflict-free. Rhizomatic is the format and the reactive core; Loam is the wrapper
that makes it a deployable, GraphQL-fronted, persistent, multi-tenant, federatable server.

Its shapes are grown, not imposed — you declare a schema and a policy, and the medium resolves
your data into views, maintains them live, and remembers everything. Nothing is deleted; the
store only ever learns. Two Loam instances that meet simply merge. Trust is a lens the reader
holds, not a verdict the ground hands down.

The design is in [SPEC.md](SPEC.md); the working record in [JOURNAL.md](JOURNAL.md). This page is
the manual.

---

## Install

Loam is a Node package (Node ≥ 22.13) that ships both a library and a `loam` CLI.

```sh
npm install @bombadil/loam
```

It depends on `@bombadil/rhizomatic` (the substrate), `graphql`, and `better-sqlite3` (the durable
store driver — a native addon with prebuilt binaries for common platforms).

## The model in one breath

- A **delta** is a signed, content-addressed fact. A **store** is a grow-only set of them.
- A **HyperSchema** gathers the deltas relevant to an entity into a **Hyperview**; a **Policy**
  resolves that hyperview into a **View** — the answer. One schema, many policies; one policy,
  many entities.
- The **Gateway** fronts one store: it derives a GraphQL surface from the (schema, policy) pairs
  you register, and serves `query`, `mutate`, and `subscribe` over it.
- **Capabilities** govern writes: nothing is written except by a verified author a surviving
  grant permits. The **operator** (the gateway's signing seed) roots the chain.
- **Federation** is union at the substrate: peers exchange verified deltas; trust is the reader's
  policy lens, never a write denial.

## Quickstart — the CLI

```sh
# create a home directory and mint an operator identity (the seed is written 0600, never printed)
loam init --home ./my-store

# give the store a shape: define + register a schema from a file (see "Schemas are data")
loam register plant.json --home ./my-store

# serve it over HTTP with a bearer token
loam serve --http --home ./my-store --token "$(openssl rand -hex 16)" --port 4321

# inspect a store
loam store --home ./my-store
```

`loam serve` self-initializes: a fresh home mints (or, via `LOAM_SEED`, imports) an operator
identity, so a container serves with nothing but a token. Configuration is by flag or environment:

| flag           | env          | meaning                                        |
| -------------- | ------------ | ---------------------------------------------- |
| `--home DIR`   | `LOAM_HOME`  | the store's home directory (default `.loam`)   |
| `--token TOK`  | `LOAM_TOKEN` | the bearer token (required to serve)           |
| `--port N`     |              | HTTP port (default 4321; `0` for ephemeral)    |
| `--store PATH` |              | override the store file path                   |
| `--seed HEX`   | `LOAM_SEED`  | import an operator seed instead of minting one |

## The HTTP API

A served store exposes three surfaces per mount, behind a `Bearer` token:

- **`POST /:mount/graphql`** — `{ query, variables? }` → `{ data, errors }`. Both queries and
  mutations; the mutation acts as the token's identity.
- **`GET /:mount/subscribe?query=…`** — a `text/event-stream` (SSE). The query must be a
  `subscription` operation (`subscription { plant(entity: "…") { height _hex _fromHex _changed } }`):
  an initial snapshot, then one `data:` frame per change (`_fromHex → _hex`, `_changed`, and the
  fields).
- **`POST /:mount/mcp`** — a minimal MCP JSON-RPC surface (`initialize`, `tools/list`,
  `tools/call`) exposing `loam_query`, `loam_mutate`, and `loam_register`.
- **`POST /:mount/register`** — `{ schema: { name, alg?, body }, policy, roots, entity? }` →
  `{ registered, entity }` (operator token only). The schema-schema mutation mechanism, served:
  the definition and its registration land as deltas, and the surface serves the new type
  immediately. Republishing at the same entity evolves it. (An endpoint rather than a GraphQL
  mutation because an empty store has no GraphQL surface to mutate through — this is how it
  gains one.)
- **`POST /:mount/append`** — `{ deltas: [wire deltas] }` → `{ accepted, duplicates }`. The
  **non-custodial door**: a client signs its own deltas and presents them; the token
  authenticates transport only, and each delta is authorized by its own verified author's
  standing. The server never holds the key.
- **`GET /:mount/federate`** — the store's published deltas as wire JSON (operator token only).

A junk or missing token is `401`; an unknown mount is `404` (only to the authenticated — an
unauthenticated caller cannot tell a real mount from a missing one).

```sh
curl -s localhost:4321/default/graphql \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"query":"{ plant(entity: \"plant:fern\") { height _hex } }"}'
```

## Embedding the library

Everything the CLI and server do is a small API you can drive directly.

```ts
import { Gateway, MemoryBackend, SqliteBackend, serve } from "@bombadil/loam";
import { parseTerm } from "@bombadil/rhizomatic";

// A store, governed by an operator seed. Omit the seed for an ungoverned local store.
const gateway = await Gateway.open(new SqliteBackend("./store.sqlite"), { seed: operatorSeedHex });

// Register a (HyperSchema, Policy) over the roots you want held live. The schema's body is a
// rhizomatic term; the policy's props name the GraphQL fields and their shapes.
gateway.register(
  {
    name: "Plant",
    alg: 1,
    body: parseTerm({
      op: "group",
      key: "byTargetContext",
      in: {
        op: "select",
        pred: { hasPointer: { targetEntity: { var: "root" } } },
        in: { op: "mask", policy: "drop", in: "input" },
      },
    }),
  },
  {
    props: new Map([["height", { kind: "pick", order: { kind: "byTimestamp", dir: "desc" } }]]),
    default: { kind: "pick", order: { kind: "byTimestamp", dir: "desc" } },
  },
  ["plant:fern"],
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

- a **definition** — rhizomatic's schema-schema claims (`publishSchemaClaims` shape: name, alg,
  and the body as canonical CBOR) filed at a schema entity, `schema:<Name>` by default;
- a **registration** — a reference under `loam.registration`: a pointer to that entity, the
  policy as canonical JSON, and the roots. No schema body rides it.

The GraphQL surface is **generated**: on boot (and after every publish) the gateway
meta-resolves each referenced entity via `loadSchema` over the surviving definitions. The
consequences are the whole point:

- **Evolution is append.** Republish a definition at the same entity — via
  `publishRegistration`, `POST /:mount/register`, or `loam register` — and the surface serves
  the new shape, live, no restart. The schema's identity is the _entity_, not the name.
- **Deprecation is negation.** Negate a definition and its registration is unbound; the type
  drops from the surface. Nothing is deleted; the store only learns.
- **Foreign law stays inert.** In a governed store only operator-authored definitions and
  registrations bind — a peer's federated definition merges as data and reshapes nothing, the
  same discipline that keeps foreign grants powerless.
- Streams subscribed before an evolution keep watching the shape they subscribed to; new
  subscriptions see the new shape.

The `loam register` file (also the `POST /register` body, under a `schema` key):

```json
{
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
  },
  "policy": {
    "props": { "height": { "pick": { "order": { "byTimestamp": "desc" } } } },
    "default": { "pick": { "order": { "byTimestamp": "desc" } } }
  },
  "roots": ["plant:fern"]
}
```

`loam register` writes to the home's store directly, so run it before `loam serve` (the store is
single-writer); a running server takes the same registration over `POST /:mount/register`.

## Writes are claims

A relation is one delta with many pointers — "Miles hosted a screening of The Matrix with Wren
and Sally on July 4" is ONE fact filing simultaneously into four entities' views. The schema
declares its write shapes as **claim templates** (data, traveling in the registration beside
the read program), and each template becomes a GraphQL mutation that emits exactly one signed
delta:

```jsonc
// in the register file/body, beside body/policy/roots:
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

Every view also carries two content addresses: **`_hex`** (the resolved view — the answer) and
**`_hviewHex`** (the gathered hyperview — the evidence). Two lenses over the same body and root
share `_hviewHex` while their `_hex` differs exactly when their policies adjudicate
differently.

## Capabilities: authors, not owners

No ambient authority — and no ownership of ids. **Entities are unowned**: a pointer is a string
that matches or doesn't, and a delta is never a free-floating fact about an entity — it is an
assertion _from a perspective_ (a verified author, an instance of origin). Anyone with standing
may point at anything; whether anyone **listens** is the reader's business (policies, author
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

**A caveat, stated plainly (negations).** Read-time masks currently honor every negation
present in the gathered set — so a hostile _federated_ negation could suppress honest data for
readers whose pulls admitted it. Until the substrate grows dynamic trust predicates
([rhizomatic#2](https://github.com/bombadil-labs/rhizomatic/issues/2)), the boundary is the
pull: local negations only enter through the granted-author door, and `pullFrom`'s `admit`
predicate is the place to refuse foreign negations you don't trust (see the federation
section).

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

A store publishes everything, or what its `offeredLens` (a term) selects. **Federation is union,
not a governed write:** a peer's deltas cross by signature verification alone, and whether they
shape a local view is a read-time trust choice (a policy's `byAuthorRank`) — never a write denial.
Foreign law stays inert: a peer's self-signed grant merges as a delta but governs nothing, because
it roots in no operator you blessed. **Each instance must have its own operator seed** — two
sharing one trust each other's constitution completely.

## Deploy

A `Dockerfile` builds and runs `loam serve --http` as a non-root user, the store on a `/data`
volume:

```sh
docker build -t loam .
docker run -e LOAM_TOKEN=<secret> -v loam-data:/data -p 4321:4321 loam
```

Bind `127.0.0.1` and terminate TLS in front. **Hosted persistence is a driver, not an image
change**: the `StoreBackend` seam takes any async append/`deltasSince`/close, so a libSQL/Turso
client drops in beside `SqliteBackend` with no other change.

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
`@bombadil/loam` to npm (the `NPM_TOKEN` repository secret), and cuts a GitHub release with
generated notes. A tag that lies about the version refuses to publish.

The process this repo runs by is in [CLAUDE.md](CLAUDE.md).

## License

MIT OR Apache-2.0.
