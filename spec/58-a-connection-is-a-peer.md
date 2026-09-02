# §58 — A connection is a peer: the container is the grant

An MCP connection — Claude, connected through the store's own OAuth doors — is a peer, and the
container it binds to is its whole grant. §27 made the container the one primitive under
sandboxes, modules and federation; §28 made trust a property of a container; §39 said a
connection binds to exactly one container and writes through its own inbox; §46 made federation
container-to-container. Before this section the doors still ran §7's older model underneath:
consent handed a connector `write` for the whole mount, its reads were the whole mount's, and no
container was bound at all. This section's first slice, **S1 — bind at consent**, is what IS now.
The later slices — the container tools and derived standing, the offer token and the container
door, the person's acts on the page, path names, authorship on the read surface — are queued as
tickets and carry their working spec with them; nothing below promises them.

## 58.1 Consent names a container

The consent page asks the person for one thing beyond their password: *bind this connection
to* — the containers under their own name, and a way to create one. On a first day the list is
empty and the home does not exist yet, so the page makes both in one act: the home (`ada`,
exactly as the admin page's create-root would), the leaf under it (`ada:journal`), and the
person's user seed when they have none. The person never opens a terminal.

Two levels are never bound. The store root — the degenerate container where the constitution
lives — is never a connection's binding; the person's home is their reach and the place they
provision from, and is not bound either. Every binding target is at depth two or deeper under the
person who consented. A name that cannot be a container's is refused before anything is minted,
and a consent that cannot provision (no seed can be written) refuses whole and keeps nothing
partial.

The code carries the binding — whose act, and where the connection will live — and never the
seed. A code that carries no container mints nothing at the exchange: a connection is never bound
nowhere.

## 58.2 One key per person, a pool where consent said

The exchange mints one signing key per **(client, user)** pair: a connector consented by two
people holds two keys, each bound under its own person's container, and neither person's container
gathers the other's work. The seed is written first (its record `standing: false`) so a retry
after a failed bind reuses it rather than minting a second; `standing` turns true only after the
connection's inbox pool has stood.

The pool is `bindConnection`'s (§39): declared with `inboxOf` naming the bound container, a
separate container of its own, durable through the store's pool backend factory and re-attached
at boot so a binding outlives the process that made it. Its membership is **forward-only** —
the key's own deltas, timestamped after the binding — so a delta the key authored anywhere before
it was bound is not the pool's, at the bytes, and a later drop of the connection forgets exactly
its post-binding writes. The binding is re-asserted on every redemption: a struck pool is
re-declared, a consent into another container spawns a second pool there and the grant record
follows the person's latest word, and the first pool stands until it is revoked or dropped.

The token names the person. A token or a grant minted before this section names no user, finds no
pool, and fails closed at every door — Loam is greenfield here; the connector consents again.

## 58.3 Writes land in the pool, and no store-wide grant is landed

The pool's own ground carries the connection's whole standing: the operator authors the person's
admin grant there, the person's key authors the connection's write grant, and the pool's door
authorizes each write on that chain. **The exchange lands no store-wide grant.** The primary never
grants the key anything, and a store-wide write grant an operator lands by hand for a bound key
changes nothing at the doors: it is real through the library and inert through every door.

The door derives the binding from the grant record on every request and the library routes on it.
A request that carries a binding writes into `inbox` and reads over `container`: the GraphQL
mutations, the REST door and the MCP tools all take the same seam, so a bound connection's deltas
land in its pool and never in the primary. The raw `/append` door routes a bound batch into the
pool too, fenced to what the key itself signed — one foreign signature refuses the whole batch,
because a delta another author signed would ride the connection's token into a place that author
was never bound to. The operator, a §57 client and an actor token append to the primary exactly
as before; the fence is the binding's, not the door's.

Refusals fail closed, in words: a binding whose actor is absent, an inbox that is not attached,
a pool mid-drop. Three doors resolve this store's own ground and cannot scope to a container, so
each refuses a bound connection with a 403 and a sentence: the live subscription (a stream
resolves over a materialization the connection's scope does not reach), the rendered-route door
(§23, whose write half signs as the renderer's pen into the primary), and the byte door (§23.7,
a read proved through a lens over this store's ground). The query door is where a bound
connection reads, and the refusals name it.

`whoami` speaks the binding (the person, the container, the inbox) and reads write standing from
the pool, so a strike on the pool's grant flips the answer on the very next call while the token
still names the connection.

## 58.4 Reads are the container's

A bound read resolves over the bound container's scope — its own members, its subtree's, and
every inbox pool composed into it (`connectionScope`) — narrowed by this store's own surviving
strikes, so a retraction that lives in the primary binds on a claim that lives in a pool (H1).
It never resolves over the store's primary materialization, which is maintained over the whole ground and would answer with everything the
store holds. Read closure narrows it as it narrows every read, and a surviving strike in the
primary binds on a claim that lives in a pool. The retraction gather, the pinned read, the time
pin and the listing follow the same binding. A row that lives in another container answers as if
it were absent; consenting again into that container, or into a wider one, is how the same
connection comes to see it. The operator's read stays the primary's, which the pool never
composes into.

## 58.5 Revocation is one person's, and the drop is total

A revoke from the admin page is the pair's: that person's key, token and codes go by name, the
connector's generation stays (bumping it would refuse every other person's token), and the write
grant is struck in every pool that key holds in the person's reach — a sibling pool bound
elsewhere under the same person goes with it, named on the confirm page before anything happens.
Another person's binding of the same connector stands untouched, and a person revoking a foreign
key's inbox in their own reach strikes that pool alone. A row whose pool is not attached refuses
with the rows that can act; a strike that fails on a sibling answers 503 and names the retry.
`loam grant revoke` remains the whole-client act. Nothing rewrites history: every delta the
connection wrote keeps its author and stays where it landed.

## 58.6 Greenfield

There are no installs to carry. A connector that consented before this section holds a
store-wide grant and a token that names no user; both confer nothing now. It consents again and
binds like any new one. Its earlier writes stay where they are — the ground forgets nothing — and
a person who wants them gathered declares a container whose membership is what that key authored.

**Provenance.** PRs #517 (the working spec), #520–#524 (S1a: the consent page's binding field and
the exchange's per-pair key and pool), #525 (the library seam), #529 and its spend (the six
frozen-rail revisions the retired store-wide grant required), #526 (S1b-ii, S1c and S1d: the
doors), and the landing PR (T262). Implementation: `src/server/oauth.ts` (the consent page's
binding field and provisioning; the exchange: one key per pair, `bind`, no store-wide grant),
`src/server/oauth-file.ts` (the grant record's `user`/`container`/`inbox`), `src/server/http.ts`
(`contextFor` carries the binding; the `/append` fence; the subscribe refusal; `whoamiFor`),
`src/gateway/mutate.ts` (`sinkFor`), `src/gateway/reads.ts` (`boundGroundFor`),
`src/gateway/container.ts` (`poolForBindingImpl`, the forward-only membership,
`resumeInboxesImpl`), `src/server/admin-federation.ts` (the pair revoke and its siblings).
Rails: `test/server/consent-binding.test.ts`, `test/server/consent-exchange.test.ts`,
`test/gateway/binding-route.test.ts`, `test/server/connection-writes.test.ts`,
`test/server/read-scope.test.ts`, `test/browser/consent-binding.test.ts`.
