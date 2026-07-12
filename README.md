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

The design is in [SPEC.md](SPEC.md), the roadmap in [TODO.md](TODO.md), and the working record in
[JOURNAL.md](JOURNAL.md). This page is the manual; [how the repo is organized](#how-the-repo-is-organized)
is spelled out below.

**New here? Take [the interactive tutorial](https://bombadil-labs.github.io/loam/)** — it hands
you a real store running in your browser (no signup, no server, nothing to install until the
last step) and teaches Loam by growing one: sixteen lessons from "you are the operator" to
carrying your store out of the tab and serving it from your own machine, the same store proven
hash for hash.

**Evaluating the repo — human or agent?** Start in [`demos/`](demos/README.md): the tutorial's
source lives there, and beside it the **village** — five federated stores, an adversary, and a
ledger mapping every demonstrated behavior to the machinery that proves it, end-to-end over
real HTTP.

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
  `{ registered, entity }` (operator token only). The hyperschema-schema mutation mechanism, served:
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

// Register a (HyperSchema, Schema) over the roots you want held live. The schema's body is a
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

- a **definition** — rhizomatic's hyperschema-schema claims (`publishSchemaClaims` shape: name, alg,
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

**Anatomy of a registration.** Five fields, and the whole read pipeline lives in them:

- **`name`** — the GraphQL field this schema generates (`{ plant(entity: …) }`) and the default
  schema entity (`schema:Plant`). Identity is the entity, not the name — rename freely by
  republishing at the same entity.
- **`alg`** — the L2 **algebra version** the `body` is written against (_not_ a signing algorithm).
  It pins which rhizomatic operator semantics interpret the term. There is one algebra today, so
  this is always `1`; it exists so a v1 body keeps its v1 meaning if the algebra ever grows a v2.
- **`body`** — a rhizomatic **gather term**, evaluated once per root. It selects and buckets the
  relevant deltas; it is a pure function of the ambient root, so it resolves the same on every
  machine.
- **`policy`** — a **Schema**: a per-bucket reduction. Each prop names a GraphQL field and says how
  to fold that bucket's deltas into one value.
- **`roots`** — the entities held **live**: the gather runs for each, and its view stays current
  as deltas arrive.

The `body` reads inside-out, each stage feeding the next:

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
change**: the `StoreBackend` seam takes any async append/`deltasSince`/close, so a libSQL/Turso
client drops in beside `SqliteBackend` with no other change.

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
`StoreBackend` drivers — sqlite, archive/mirror, localStorage), `surface/` (surfaces as
materializations — the GraphQL and REST/OpenAPI doors from one generator seam), `federation/`
(offer / pull / wire / translate), `runner/` (derived functions), `migrate/` (format migrations —
old deltas in, new deltas out), `cli/`, and `browser/` + `client/` (the full in-page store and the
read-only public client). `test/` mirrors that tree;
[`demos/`](demos/README.md) holds the [tutorial](https://bombadil-labs.github.io/loam/) and the
village.

**The docs, by role — they don't overlap:**

- **[README.md](README.md)** — this file: the manual (what Loam is, how to use it).
- **[SPEC.md](SPEC.md)** — the design, and the record of what **is**: one section per shipped
  capability, each closed by a `**Provenance.**` footer linking the PR(s) that landed it and
  naming where it lives. Read it to understand the system; it grows only when work lands.
- **[TODO.md](TODO.md)** — the backlog: unbuilt and partially-designed work. The next thing to
  build is drawn from here, and its landing PR migrates it into SPEC.md.
- **[JOURNAL.md](JOURNAL.md)** — the append-only record: one entry per step, what was done and why.
- **[CLAUDE.md](CLAUDE.md)** — the process this repo runs by (the build loop).

(`CURRENT_WORK.md` is a scratch checklist for whatever step is in flight — ephemeral by design.)

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
