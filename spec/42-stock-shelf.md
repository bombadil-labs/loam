## 42. The stock shelf

`loam register --stock <name>` registers a shape Loam ships, so day one is a command rather than an
exercise in writing a rhizomatic gather Term by hand. Before it, README's quickstart said
`loam register plant.json` and the repo never shipped `plant.json` — behind the missing file stood a
five-level gather Term, and a newcomer had to learn `group`/`select`/`mask`, pointer contexts, and
Policy folds before storing one fact. The shelf holds four ordinary shapes — `event`, `note`,
`person`, `post`, alphabetical, no entry more important than another — and `register --help` prints
each with its one-line summary.

### 42.1 A convenience, never a second door

Each shelf entry is a `loam register` file, **verbatim**: the exact at-rest JSON a person could have
typed into a file of their own, handed to the same `parseRegistrationInput` and the same
`publishRegistration` a file goes through. `--stock` changes how the JSON is *obtained* and nothing
downstream of that — no privileged parse, no weaker check, and if an entry were malformed the
ordinary validator would say so in the ordinary voice. The rail pins this as an invariant: every
entry must survive the shared validator, and `--stock note` is driven end to end — register, serve,
write over GraphQL, read the value back — because a shape a person cannot actually use is not a
convenience.

Every entry is `entityGatherJson()` — everything pointing at the root, bucketed by context — because
that is the shape an ordinary entity wants. Single-value props resolve `pick byTimestamp desc` (one
value: the last said); the list props — `tags`, `attending`, `follows` — are `all` policies, oldest
first, so every claim survives into the list. No expands, no claim templates: the interesting
choices belong to the reader who has a reason for them, and README's "Schemas are data" is waiting
when they outgrow the shelf.

`post` ships **without an `author` field**, deliberately. Every delta already carries a verified
signer; a claimed `author` string resolved latest-wins would read as provenance while being an
ordinary overwritable value — the one field on a day-one shelf a newcomer would trust for the wrong
reason. A store that wants a display byline adds one knowingly.

### 42.2 Ungoverned in both directions — and why that is load-bearing

A stock shape is ungoverned two ways, and both are named in the module header, the help text, and
README rather than left to be discovered:

- **Strikes.** The gather's negation posture is `drop`: every negation present binds, whoever signed
  it, so in a federating store a peer's strike can retract a field from a stock view.
- **Claims.** The gather names no `authoredBy`, so every author's claims are admitted too. On a
  single-value prop, a peer who signs `Note.title` at your entity with a later timestamp wins your
  view and keeps winning it; on a list prop, a peer's entry joins the list and no later claim of
  yours displaces it.

Neither is a defect, and closing them behind `--stock` would break the feature's one invariant: a
stock schema must be **the registration a person could have typed**, and every hand-authored
registration in this tree — demos, fixtures, README — is this shape. Computing a trust-masked or
author-scoped body behind the flag would make it a privileged path, which is the one thing it must
not be. The exits are stated where the shelf is: a trust mask answers only the strikes; a
federating store wants `authoredBy` in the body or `byAuthorRank` in the schema, written into a
registration of its own. The shelf is a starting point, not a deployment.

`roots` is empty on every entry for the same reason: a shipped library cannot know your entities.
An entity outside the roots is materialized lazily on first read (§21.7), so `--stock note` serves
`note:groceries` without having been told about it — and the ceiling is real: one gateway holds at
most 1024 unregistered entities live, and the read past it throws rather than growing the reactor
without bound (the anonymous door meets a smaller ceiling first — 256 public watches). A store
meant to serve more names its roots, by re-registering a file of its own.

### 42.3 The shelf is frozen through, and cloned out

`STOCK_SCHEMAS` is a module-level constant shared by every call in a process, deep-frozen at
runtime — not merely `readonly`, which the CLI's `unknown`-typed registration path erases — so no
consumer, this repo's or an embedder's, can edit what a later `--stock` registers. The rail asserts
the freeze at depth: the negation mask four hops down and the timestamp ordering three hops down
both throw on write. `--stock` additionally hands out a `structuredClone`, so a downstream consumer
that normalized its input in place would edit its own copy, never the shelf — the clone is belt
over the freeze's braces, and the freeze rail is the one that bites (its own header says it cannot
see the clone).

### 42.4 Refusals and the qualified success

The command refuses in the open, exit 2, usage voice: an unknown stock name names what was asked
for **and the whole shelf** (never a raw file error); a stock name alongside a file is refused
rather than one silently winning; no argument at all points at both ways in. Registering a stock
name twice is the ordinary evolve path and still binds. And when the deltas land but the replay
cannot serve them — a rival body already answering for the same program name — the CLI reports the
qualified truth: `registered` on stdout (the deltas *are* down) plus a `does not bind` warning on
stderr, rather than promising a surface the next serve will not grow (H7).

### 42.5 The embedder surface

The shelf is public API, by the names README uses: `STOCK_SCHEMAS`, `stockNames()`,
`stockSchema(name)`, and the `StockSchema` type, all re-exported from the package barrel — pinned
by a rail that imports them through `src/index.ts` — and the tarball ships `dist/stock/` including
the declaration file, pinned against a future narrowing of the `files` glob.

**What is deliberately not promised:** the shelf's editorial content. Whether `note` wants a
`pinned` field is a judgment, not an invariant, and no rail asserts the exact prop list — what is
pinned is that every entry is a valid registration through the shared validator and that the shapes
work end to end for a person.

**Provenance.** Landed [#385](https://github.com/bombadil-labs/loam/pull/385) (T85) —
`src/stock/index.ts` (the shelf), the `--stock` path in `src/cli/cli.ts` (`registrationSource`),
rails `test/cli/stock.test.ts` and `test/cli/pack-stock.test.ts`. The two ungoverned directions and
the absent `author` field are decisions from that PR's review, kept as defaults and named instead
of closed. [#406](https://github.com/bombadil-labs/loam/pull/406) corrected the resolution claim in
the shelf's own documentation: single-value props are `pick byTimestamp desc`; `tags`, `attending`,
`follows` are `all` policies, which no later claim displaces.
