# The Register Grammar

A field guide for defining Loam schemas over MCP — the registration envelope, the term algebra a
hyperschema body is written in, the policy language a schema resolves with, and one working
pipeline from `loam_register` to a queried view. Everything here is transcribed from the parsers
(`rhizomatic/term-json` and the register door), not paraphrased: if a shape is not on this page,
the parser refuses it.

**Who this is for.** A connection holding a register grant (`loam grant <client_id>
--verb=register --prefix=<ns>:`). You may register schemas whose names sit under your prefix —
nothing else. The examples use the `sync:` namespace.

---

## 1. The envelope

`loam_register` takes one JSON object. `hyperschema`, `schema`, and `roots` are required.

```json
{
  "hyperschema": {
    "name": "sync:person",
    "alg": 1,
    "body": { "…": "a TERM — see §3" }
  },
  "schema": {
    "props": { "name": { "pick": { "order": { "byTimestamp": "desc" } } } },
    "default": { "pick": { "order": { "byTimestamp": "desc" } } }
  },
  "roots": ["sync:person:1"],
  "writable": ["name"]
}
```

| field | meaning |
|---|---|
| `hyperschema.name` | the PROGRAM's name. Must sit under your granted prefix. |
| `hyperschema.alg` | the algebra version. Use `1`. |
| `hyperschema.body` | the term program (§3) that gathers deltas into a HyperView. |
| `schema` | the READING (§6): how each gathered property resolves to a single value. |
| `schema.name` | optional. The reading's own name; defaults to the hyperschema's. If you set it, it must also sit under your prefix. |
| `roots` | required. Seed entity id(s) the surface starts from. |
| `writable` | which props the generated mutation accepts. Anything absent is immutable-by-default. |
| `entity` | optional explicit registration entity; if sent it must equal the derived one — scoped callers gain nothing by sending it. |
| `resolvers`, `mutations` | **refused for scoped callers.** Code and mutation templates (the `mutations` field) arrive by federation and blessing, never through a grant. |

Republishing at the same name **evolves** the schema for every reader. You can evolve what you
named; you cannot touch a neighbouring namespace.

## 2. Names: the fence and the GraphQL surface

The fence checks two names — the program's (`hyperschema.name`) and the reading's (`schema.name`,
when present). Both must start with your prefix, literally: `sync:person` passes under `sync:`;
`person` and `hyperschema:sync:person` do not.

GraphQL identifiers cannot carry `:`, so the surface mangles names mechanically — every character
outside `[_A-Za-z0-9]` becomes `_`:

| store-native | derived | used for |
|---|---|---|
| `sync:person` | `sync_person` | the **stem**: initial-lowercased, it is the **query, subscription, and mutation root field** |
| `sync:person` | `sync_personView` | the **view type** (the stem plus `View`; the subscription payload type is the stem plus `Patch`) |
| prop `name` | `name` | the view field and the mutation argument |
| — | `clear` + stem | the paired retraction mutation — `clearsync_person` |

So after registering `sync:person` you talk to the field `sync_person(entity: …)`, and a fragment
or introspection query names the type `sync_personView` — the bare stem is a field name, never a
type.

## 3. The term algebra — `hyperschema.body`

A term is either the literal string `"input"` (the whole delta set flowing in) or a node
`{"op": …}`. The full op list, with exact shapes:

```jsonc
"input"                                                    // the incoming delta set

{ "op": "select", "pred": PRED, "in": TERM }               // keep deltas matching PRED
{ "op": "union",     "left": TERM, "right": TERM }
{ "op": "intersect", "left": TERM, "right": TERM }
{ "op": "difference", "of": TERM, "without": TERM }
{ "op": "mask", "policy": MASK, "in": TERM }               // trust boundary — see §5
{ "op": "group", "key": GROUPKEY, "in": TERM }             // shape deltas into properties
{ "op": "prune", "keep": "all" | STRMATCH, "in": TERM }    // drop property groups by name
{ "op": "expand",                                          // follow a pointer role into a child
  "role": STRMATCH, "schema": SCHEMAREF,
  "reading": SCHEMAREF, "in": TERM }                       // reading required for resolution
{ "op": "fix",                                             // pin a known entity through a schema
  "schema": SCHEMAREF, "entity": "id",
  "bindings": { "name": PRIMITIVE } }                      // bindings optional
{ "op": "resolve", "schema": SCHEMA, "in": TERM }          // resolve inline with a full §6 schema
```

`SCHEMAREF` is a name string (`"sync:person"`) or `{ "pinned": "<hash>" }`.

`GROUPKEY` is `"byTargetContext"` (property = the pointer target's context — the usual choice),
`"byRole"` (property = the pointer's role), or `{ "const": "prop" }` (everything into one named
property).

## 4. Predicates — `PRED`

```jsonc
"true"   /  "false"

{ "match": { "field": "author" | "timestamp" | "id",
             "cmp": "eq" | "neq" | "lt" | "lte" | "gt" | "gte" | "prefix" | "inSet",
             "const": value | [values] } }                 // inSet takes the array form

{ "hasPointer": {                                          // at least one field required
    "role": STRMATCH,
    "targetEntity": "id" | { "var": "root" } | { "hole": "name" },
    "targetDelta": "delta-id",
    "context": STRMATCH,
    "targetIsPrimitive": true,
    "targetValue": VALMATCH } }

{ "and": [PRED, PRED] }   /  { "or": [PRED, PRED] }        // exactly two
{ "not": PRED }

{ "inView": {                                              // membership in another view
    "term": TERM,                                          // input | select | union | mask only
    "field": "author" | "id",
    "extract": { "field": "author" | "id" } | { "role": "r" } } }
```

`{ "var": "root" }` means "the root entity this program is being asked about" — it is how one
program serves every instance. `inView` is stratified: no `inView` inside its own `term`.

`STRMATCH` is always an object, never a bare string, with four arms:
`{ "exact": "name" }` · `{ "prefix": "sync:" }` · `{ "inSet": ["a", "b"] }` ·
`{ "aliased": { "name": "n", "via"?: "entity:id", "trust"?: PRED } }` — the last matches through
the alias vocabulary, and its `trust` predicate must be closed (no holes, no nested `aliased`).

`VALMATCH` compares a primitive target value, with three arms:
`{ "vcmp": { "cmp": "eq"|"neq"|"lt"|"lte"|"gt"|"gte"|"prefix", "value": … } }` (set membership is
not a `cmp` — use the arm below; `prefix` wants a string) ·
`{ "between": [lo, hi] }` · `{ "inSet": [v, …] }`.

## 5. Mask policies and the trust boundary

`mask` decides which deltas COUNT before anything resolves:

```jsonc
"drop"                       // discard what the mask refuses (the common start)
"annotate"                   // keep, but marked untrusted
{ "trust": PRED }            // count only deltas matching PRED
```

Start programs with `{ "op": "mask", "policy": "drop", "in": "input" }` unless you have a reason
not to; it is the store's own idiom for "only lawful ground below this line."

## 6. The policy language — the `schema` half

A schema is `{ "props": { <prop>: POLICY }, "default": POLICY }`. Five policies:

```jsonc
{ "pick": { "order": ORDER } }               // one winner
{ "all": { "order": ORDER } }                // every value, ordered
{ "merge": FN }                              // fold: "max" "min" "sum" "count" "and" "or" "concatSorted"
{ "conflicts": { "order": ORDER } }          // surface disagreement instead of resolving it
{ "absentAs": { "const": value,
                "then": POLICY } }           // a default when nothing speaks, else delegate
```

Orders:

```jsonc
"lexById"                                     // deterministic tiebreak
{ "byTimestamp": "desc" | "asc" }             // latest/earliest wins
{ "byAuthorRank": ["ed25519:…", "…"] }        // listed authors outrank, in order
{ "byPred": { "pred": PRED, "then": ORDER } } // matching deltas first, then delegate (no inView here)
{ "chain": [ORDER, ORDER] }                   // tiebreak cascade
```

`{ "pick": { "order": { "byTimestamp": "desc" } } }` — latest-wins — is the workhorse.

## 7. The canonical entity program

Ninety percent of schemas are this shape — gather every lawful delta that points at the root,
one property per pointer context:

```json
{
  "op": "group",
  "key": "byTargetContext",
  "in": {
    "op": "select",
    "pred": { "hasPointer": { "targetEntity": { "var": "root" } } },
    "in": { "op": "mask", "policy": "drop", "in": "input" }
  }
}
```

Read bottom-up: lawful ground → deltas about this entity → shaped into properties.

## 8. A working pipeline

**Register** (`loam_register`):

```json
{
  "hyperschema": {
    "name": "sync:person",
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
    "props": {
      "name":     { "pick": { "order": { "byTimestamp": "desc" } } },
      "location": { "pick": { "order": { "byTimestamp": "desc" } } },
      "tags":     { "all":  { "order": { "byTimestamp": "desc" } } }
    },
    "default": { "pick": { "order": { "byTimestamp": "desc" } } }
  },
  "roots": ["sync:person:1"],
  "writable": ["name", "location", "tags"]
}
```

**Write** (`loam_mutate` — every argument becomes one signed delta):

```graphql
mutation {
  sync_person(entity: "sync:person:alice", name: "Alice", location: "Kyiv") {
    name
    location
  }
}
```

**Read** (`loam_query`):

```graphql
{
  sync_person(entity: "sync:person:alice") {
    name
    location
    tags
  }
}
```

**Retract your own contribution** (the paired clear mutation; each named field falls to what
survives):

```graphql
mutation {
  clearsync_person(entity: "sync:person:alice", fields: ["location"]) {
    location
  }
}
```

**Evolve**: re-send `loam_register` with the same `name` and a grown body/schema. The surface
serves the new shape immediately; old deltas are untouched and re-resolve through it.

## 9. References and edges (§51)

An entity-valued property is a REFERENCE, never a primitive — writing an id string mints a
fossil the store cannot follow. Declare it in the envelope's `refs` and the surface derives typed
edge mutations from it:

```json
"refs": {
  "experiencers": {
    "role": "experiencer",
    "reciprocal": { "role": "experience", "context": "experiences" }
  }
}
```

Rules, all mechanical:

- A prop in `refs` **loses its argument** on the base mutation — a primitive write to it refuses
  on every door. On the REST/direct seam the refusal names the link mutation to use; on GraphQL
  the argument was never built, so the refusal is GraphQL's own `Unknown argument` and the
  pointer to the link mutation lives in the mutation field's **description** instead. Don't also
  list the prop in `writable` (that draws a warning and `refs` wins).
- The surface serves `link<lens>_<prop>(entity: ID!, target: ID!)` and `unlink<lens>_<prop>` —
  for lens `sync:experience`, prop `experiencers`:
  `linksync_experience_experiencers` / `unlinksync_experience_experiencers`.
- `link` authors ONE symmetric delta: the role at the target under the reciprocal context, and
  the reverse role at the entity under the property's own context. Both sides fold from the same
  delta.
- `unlink` retracts YOUR OWN matching links only; the retraction is a claim and history survives.
- Omit `reciprocal` and the mutations still generate — the register response warns that the far
  side will not fold, and the delta carries no target-side context.
- **Evolution is a republish**: re-send your existing registration unchanged plus the `refs`
  block, same name; the surface regenerates immediately, and your existing data is untouched.
- For the far side to *display* the edges, give the target schema a prop named after the
  reciprocal context (e.g. `experiences` on `sync:person`) with an `all` policy.

## 10. Refusals you will meet, and what each means

| refusal | meaning |
|---|---|
| `registration is constitutional: it requires an operator token` | you hold no register grant, or your grant does not cover these names. The sentence is identical for both, deliberately. |
| `unknown term op …` | the body used an op outside §3's list. |
| `pred must be true \| false \| match \| hasPointer \| and \| or \| not \| inView` | a predicate node without a recognized key. |
| `propPolicy must be pick \| all \| merge \| conflicts \| absentAs` | a policy node without a recognized key. |
| about `resolvers` / `mutations` | code never rides a scoped registration — it arrives by federation and blessing. |
