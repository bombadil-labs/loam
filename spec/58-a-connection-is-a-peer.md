# §58 — A connection is a peer: the container is the grant

An MCP connection — Claude, connected through the store's own OAuth doors — is a peer, and the
container it binds to is its whole grant. §27 made the container the one primitive under
sandboxes, modules and federation; §28 made trust a property of a container; §39 said a
connection binds to exactly one container and writes through its own inbox; §46 made federation
container-to-container. Before this section the doors still ran §7's older model underneath:
consent handed a connector `write` for the whole mount, its reads were the whole mount's, and no
container was bound at all. Two slices are what IS now: **S1 — bind at consent**, and **S2 — the leeway, derived standing and
the roster**. The remaining slices — the offer token and the container door, authorship on the read
surface — are queued as tickets and carry their working spec with them; nothing below promises
them.

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
still names the connection. The operator's ledger reads the same place: `loam grant list` reports a
bound connection's standing from its pool, and `loam grant revoke` strikes that grant rather than
only the store-wide one that no longer exists — a report naming a strike nobody performed is the
shape §11's discipline refuses.

**REGISTRATION IS THE NAMED EXCEPTION.** The binding does not route it and does not refuse it.
Registration is constitutional (§17), its standing is an operator's explicit `register` grant and
never the binding's, and its deltas land in the primary under the store's own signature exactly as
they did before this section. Position 2 gives a connection law under its own container path
instead; the slice that builds it is S2, with the inbox pool's own publish, the §47 fold, and a
re-attach at boot. Until then a bound connection that holds a register grant shapes the store.

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

## 58.7 A leeway is what a container may do

A container carries a **leeway**: three switches — *receive*, *offer*, *publish* — an **envelope**
naming how much compute may run behind glass, and **delegation terms** saying what may exist below
it. Every switch starts off. A container that declares no leeway is a pure namespace and inherits
what the nearest declaring ancestor allows; the private journal is the default, and nothing here
widens what a person did not turn on.

**The one rule:** a child's leeway — its switches, its envelope and its own terms — must fit inside
its parent's **delegation terms**. The parent's own switches never enter the comparison. A sealed
room may therefore hold an open annex: a container that follows nothing itself may still let a
child follow a store into its own room. `delegate: "off"` is not "no terms": it makes the subtree a
pure namespace, where nothing may be configured and nothing bound, so a child leeway there is
refused even when it asks for nothing new.

A leeway is a **declaration on the container**, in the same delta that declares it. Latest-wins is
per declaration, so a leeway omitted from a re-declaration is a leeway deleted — every road that
re-declares a container carries the record forward whole. An absent leeway reads as every switch
off, which is why no migration was needed for stores that predate this.

## 58.8 Derived standing: the path, with its colon

A bound connection needs no grant. Its container **is** its standing, and the fence is the path
**and its colon**: bound to `ada:journal` it registers law under `ada:journal:`, and `ada:journalx`
— a sibling that merely shares the letters — is outside. Its law is published on its own inbox
pool's gateway and folded into the container's surface, re-attached at boot so a restart does not
lose it.

**A bound connection's law serves its container, and nobody else.** The root surface never carries
it. That was the open question this slice opened with, and it is settled: a connection's
registration is not the store's.

## 58.9 The walls

Nothing a connection writes lands in the person's own container or in the primary ground. A
**resolver** arriving on its channel stays inert. Declaring, offering or binding above its own root
refuses with the sentence naming the rule, and no refusal names a container outside the caller's
own fence. The envelope binds: a pool's report is clamped under the operator's ceiling on every
resolve.

**Names are paths, and the name governs.** A container named under the binding but declared with a
parent elsewhere still resolves its leeway by name, so the switch a person set on the container is
the one in force. The write verbs ask the edge as well, because writing law that governs a subtree
is not the same act as reading under a name whose leeway is already resolved.

## 58.10 Receive within the subtree, and the cascade

A connection follows another store into its own container or a descendant of it, under a prefix
inside that container, and only where the leeway in force says *receive*. What arrives is kept in a
pool of its own and serves that container alone. The channel records who opened it and from which
pool, so a connection's standing ending ends its channels: the suspension is keyed on **standing**,
not on a severance, and an unrelated binding is untouched.

**A container a person dropped stays dropped.** A shared drop strikes that container's declarations
and leaves its children standing, so "dropped" and "never declared" look alike to a walk that mints
missing levels — and re-minting one would hand the person's dropped subtree back to its reader. No
road mints a name that was ever declared, and none hangs new law beneath a container whose own
edges lead nowhere the person can see.

## 58.11 The five controls, in words

The consent page and the container's own page render the leeway as five controls — the three
switches, the envelope, and delegation — unchecked by default, as native controls with their label
and description associated in the markup, each carrying its capability and its risk in a sentence.
Delegate's terms unfold beneath it when it is on. A person reads what they are turning on, in
words, before they turn it on.

## 58.12 The roster: what a connection does in conversation

Five verbs, and each asks the same question first — is the name inside the fence this binding
draws:

- `loam_container_declare` writes a new container inside the caller's own subtree, declaring every
  missing level with it so the tree agrees with the names, and reporting every container it signed.
- `loam_container_leeway` sets what a container **below** the caller may do. A connection never
  sets its own leeway: that is what the person granted it.
- `loam_container_receive` follows a store into the subtree. It is `loam_federate_connect` under
  the roster's name — one road, two names, so the two cannot answer one caller differently.
- `loam_container_sever` **stages** the sever of a channel the container opened, and
- `loam_container_promote_stage` **stages** the promotion of one output from its gather.

The two staged verbs move no bytes. A sever purges a peer's pool and a promotion re-signs a claim
under the store's own name in canonical history, where erasure is the only way back out — so both
hand back a preview and a link, and a person completes them behind a session gate a connector token
cannot obtain. An agent nominates; a person decides.

**A sixth verb is not here.** §58's working spec decided a peer's *renderer* is blessable by a
connection and its *resolvers* never; §46.5 decided that no tool mounts a stranger's code at all,
because tools are the unit of consent and that is not a consent a connector token may give. Both
are landed and they disagree. The verb is not built until that is settled.

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

**Provenance (§58.7–§58.12, slice S2).** PRs #544 (the leeway shape and the one rule, library
only), #545 (the leeway as a declaration on the container), #546–#547 (the frozen-rail revision the
register door's widening required), and the slice's own stack: derived standing, the walls, receive
within the subtree, the cascade on revocation, the five controls in words, and #554–#555 (the
roster's five verbs). T277 carries a container the operator's federation road can still make
unreachable; T278 carries the sixth roster verb, which two landed positions disagree about.
Implementation: `src/gateway/leeway.ts` (the four switches, the envelope order and `leewayFits` —
the one rule, folded twice), `src/gateway/container.ts` (`governingLeeway`'s top-down walk and its
terms, `everDeclared` and `boundContainer` — the bind test the reader and the mint question share,
`danglingAncestor`, `withinSubtree` and `treeRootsOf`, `chainBreaksAt`, `openerStands`,
`receivesNow`), `src/gateway/lifecycle.ts` (the bound fold: the three-name fence, the contest asked
of the trial itself, the once-per-fold root check), `src/server/http.ts` (the roster's five verbs,
`receiveRefusal`, `connectionStands`, `mintableAt`), `src/server/refusal.ts` (the shared name rule
and the append refusal), `src/federation/channel.ts` (`openedBy`/`openedFrom` and the walk that
declares a missing level only where a parent stands), `src/gateway/leeway-copy.ts` and
`src/server/leeway-form.ts` (the five controls in words), `src/server/admin.ts` and
`src/server/admin-pages.ts` (the container's own leeway page).
Rails: `test/gateway/leeway-fit.test.ts`, `test/gateway/leeway-declaration.test.ts`,
`test/gateway/bound-fold.test.ts`, `test/server/derived-standing.test.ts`,
`test/server/subtree-walls.test.ts`, `test/server/subtree-receive.test.ts`,
`test/server/leeway.test.ts`, `test/server/leeway-copy.test.ts`,
`test/server/container-tools.test.ts`, `test/server/roster-staged.test.ts`,
`test/browser/leeway-controls.test.ts`.
