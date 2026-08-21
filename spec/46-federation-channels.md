## 46. Federation is container-to-container

Pulling was one anti-entropy step and the story stopped there: a peer's deltas landed as bytes and
their law stayed inert (§28), so a receiver who wanted to *read* what they had pulled wrote their own
schema and became the author of law they did not write. A **channel** is the rest of the story.

A channel joins a container of theirs to a container of yours. You name the container you receive
into, and you assign the peer a **prefix**; their deltas land in a pool nested inside that container,
and law that arrives binds under your prefix — `alice:Note`, because *you* called the channel
`alice`, never because the peer asked for anything. One receiving container holds many channels, one
pool per peer, because the container gather composes every pool that marks it (§39.3).

### 46.1 The pool is the boundary

A channel's pool is a `separate` container declared `inboxOf` the receiving container: its own ground,
its own bytes. The peer's deltas never enter the receiver's primary ground, which buys three things at
once — the receiver's own computations never see a peer's bytes uninvited, severing a peer is
`drop()`'s proven physical purge rather than a filtered delete by author, and (since §47) the law a
channel blesses lives in the same pool, so a drop takes the law with the data and leaves nothing to
retire.

Reads of a channel's lens resolve over the channel's pool — never the primary ground, and never
another channel's pool. The pool file's name carries a digest of the full channel name, because
folding unsafe characters is many-to-one and a shared file would let one channel's drop purge a
bystander's bytes.

### 46.2 Names are the receiver's

Law identity is a content address that deliberately excludes the living name, so what travels is the
law and the *receiver* names it. The prefix is checked store-wide for GraphQL-field injectivity at
assignment time — `al:ice` and `al_ice` flatten to one field, and the refusal arrives while a person
is present to choose differently. The bare name is never bound by inference: a receiver's own `Note`
keeps its name when a peer's arrives, and the peer's serves as `alice:Note` beside it.

### 46.3 Two reversible toggles, one irreversible act

`receiving` freezes a channel — nothing new arrives, everything received still reads. `blessing`
stops *new* law binding and leaves bound law serving; a **curse** retires one bound law, durably
across polls (the curse is recorded, because a standing sync would otherwise silently undo it), and
lifting a curse negates the strike itself — the re-published binding re-mints the struck id, so
nothing less would revive it. All of these are deltas, read live from the ground on every sync.

Severing is `loam federate drop`, which purges the pool at the bytes, negates the channel's record
so `federate list` cannot contradict the drop, and refuses outright when it cannot prove it holds the
pool's real bytes — an honest refusal is always available, and a false purge report is not
recoverable.

### 46.4 The channel's own state is data

`lastSyncedAt` and `consecutiveFailures` live on the channel record, so a peer that has been
unreachable since yesterday is distinguishable from a peer with nothing new — "0 accepted" alone is
the H9 shape. A channel's address rides its record; the token it presents lives in the home at 0600
beside the pen seeds, because a secret never enters the ground. `loam serve` rebuilds channels from
those two halves at boot and starts the standing sync, naming any channel it cannot resume rather
than listing it as `receiving`.

### 46.5 Over MCP

Four tools — `loam_federate_status`, `_set`, `_connect`, `_drop` — each scoped by a container-scoped
`federate` grant verb (mirroring §45's register-by-prefix; the operator holds it at root by
construction). Tools rather than one passthrough because tools are the unit of *consent*: a client
can auto-approve `status` while `drop` always asks. `_drop` only ever **stages** — it returns a link
and a two-sided preview and purges nothing; the sever completes on the admin page's existing
container-drop confirm, behind a session a connector token can never obtain. The fifth tool,
`loam_federate_offer`, waits on where a runtime-issued federation credential lives; until then,
federating still requires the peer's operator token, and the docs say so.

**Provenance.** Landed across [#434](https://github.com/bombadil-labs/loam/pull/434) (the channel
model), [#435](https://github.com/bombadil-labs/loam/pull/435) (the MCP surface),
[#437](https://github.com/bombadil-labs/loam/pull/437) (the severed-lens guard and honest docs),
[#440](https://github.com/bombadil-labs/loam/pull/440) (the source survives the process), and
[#445](https://github.com/bombadil-labs/loam/pull/445) (bindings moved into the pool, §47).
Implementation: `src/federation/channel.ts`, the federate tools in `src/server/http.ts`, and
`loam federate` in `src/cli/cli.ts`. Sixteen rails in `test/federation/` plus
`test/server/federate-mcp.test.ts`.
