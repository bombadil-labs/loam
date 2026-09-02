# §58 — A connection is a peer: the container is the grant

**Working spec (P1 instrument). Design-stage: Myk's merge.** Settled in chat 2026-09-01. Every
position marked DECIDED is Myk's sentence; every "(Myk)" carries a reasoned recommendation and
waits for his word. Realizes T261. Supersedes T258 and T260; absorbs T259.

Two review rounds shaped this draft before it reached him: a cross-model pass (Gemini) and a
three-angle premortem — the person, the substrate, reach and leakage — run as fresh contexts
without the author's reasoning. They found seventeen gaps, five blocking. Every one is folded
below, and the folds are named where they changed a position, so the reasoning is on the page.

The seam this closes: §27 says a container is the one primitive under sandboxes, modules, and
federation; §28 says trust is a property of a container; §39 says a connection binds to
exactly one container and writes through its own inbox; §46 says federation is
container-to-container. The implementation still runs §7's older model underneath — standing
as verbs granted one at a time at the store entity, and no container bound at consent. A
consented connector today holds `write` for the whole mount and nothing else; every other
standing is a CLI grant, and its reads are the whole mount's. This section finishes what the
four sections started: **an MCP connection is a peer, and the container it binds to is its
whole grant.**

## Vocabulary

Two words this section keeps apart, because the admin page already uses one of them:

- **posture** — a container's storage: `separate` (its own store) or `shared` (a reading over
  the primary ground). §27.1's immutable knob. Unchanged here.
- **leeway** — what a bound connection may do inside its subtree: *receive*, *offer*,
  *publish*, the *envelope*, and *delegate* — the terms under which the subtree may differ.
  New here; set at provisioning; one JSON value on the container's declaration.

## User stories

Each story names the surface the person uses and the rail that walks it end to end. A story
with no executable form is a story not yet specified.

**1. Ada connects Claude.** The consent page asks for her password and one more thing: *bind
this connection to* — a list of the containers under her name, and a way to create one. On her
first day the list is empty and her home container does not exist yet, so the page creates
both in one act: `ada` (her home, exactly as the admin page's create-root would) and
`ada:journal` under it, minting her user seed if she has none. From then on every note Claude
files lands in `ada:journal`, signed by Claude's key for *this* binding, and her admin page shows
it there beside her own. She never opened a terminal. *Surface:* the consent page. *Rail:* a
real browser, from a user with no containers and no seed, through password and binding to a
connected store that files a note into the chosen container.

**2. Claude grows a shape.** Ada asks for a reading log. Claude defines the shape; it binds into
`ada:journal` as `ada:journal:log` and answers at the field `ada_journal_log`. No grant was
issued and no prefix typed: the container's path plus its colon is the fence, so Claude may
shape anything under `ada:journal:` and nothing beside it — not `ada:other:log`, not `log`, and
not `ada:journalx:log`. *Surface:* `loam_register` as today. *Rail:* the derived-standing suite.

**3. Ada provisions a daily driver.** On the consent page she creates `ada:agent1` with every
switch on, a large envelope, and delegation terms that mirror them — she read each line
before flipping it. In conversation, agent1 declares `ada:agent1:scratch`, opens a
channel from a colleague's offered container into `ada:agent1:inbox`, offers
`ada:agent1:outbox`, and binds a helper key to `ada:agent1:helper` — each through a
`loam_container` tool, each inside `ada:agent1:…`, none able to reach `ada` or the store. The
helper's leeway can be no wider than agent1's, and revoking agent1 revokes the helper on the
next request. *Surface:* the `loam_container` tools. *Rail:* an MCP client driving each tool,
two-sided (the act inside succeeds; the same act one level up refuses).

**4. Ada keeps a social outbox.** She binds a second connection to `ada:outbox` and, on that
container's admin page, mints its **offer token** — the credential a peer presents to pull this
one container. She hands it to Bob. Bob runs `loam federate open --from
https://ada…/default/ada:outbox --into friends --prefix ada --token <the offer token>`, and
`ada_Post` appears on his surface: the offer serves the container's lenses by their bare names
under Bob's prefix, so the container's internal path is its own business. Each post is signed by
the outbox connection's key and attributed to Ada by its binding. Bob's pull of
`https://ada…/default` — the whole store — refuses: the mount answers only the operator token,
and a container's offer token is not that. *Surfaces:* the admin container page (mint, show,
rotate the offer token) and the CLI. *Rail:* two served stores; Ada's half walked in a real
browser to obtain the token, Bob's half by the CLI.

**5. Siblings share by federating.** agent1 cannot read `ada:journal`; it is a sibling, not a
descendant, and the journal is not offered. Ada does not widen the binding. On the journal's
admin page she chooses *share into…* and names `ada:agent1:journal`: a channel from one of her
containers into a descendant of another, in one store, needing no token because she owns both
ends. agent1 reads the journal through its pool, read-only by construction; dropping that pool
takes the access back; agent1's own request to open the same channel refuses, because the
source is not offered to it. *Surface:* the admin container page. *Rail:* a browser drives the
share form; the suite asserts the read, the refusal, and the drop, two-sided.

**6. Ada promotes.** agent1 drafts a week of notes in `ada:agent1:scratch`. Ada opens the scratch
container on her admin page, picks the ones she wants, and promotes them into a destination she
chooses — `ada:journal`. The promoted deltas are re-signed with *her* user seed and land where
her journal's membership admits them; they never land in the store root. That is her act;
agent1 could draft forever and never move a byte above its own root. *Surface:* the admin
promote form, with a destination. *Rail:* a browser drives it; the suite asserts the note is a
member of `ada:journal` through a View and absent from the root read.

**7. agent1 severs.** It tires of the colleague's channel and severs it with `loam_container
sever`. The pool was inside its own subtree; the sever completes in conversation, two-sided —
its pool purged and verified, every other channel whole — and Ada's page shows it gone.
(DECIDED.) *Surface:* the tool. *Rail:* the MCP client drives it against
two channels; the bystander is asserted at the bytes.

**8. Ada's old connector consents again.** She connected Claude last month, before this
section, and Claude wrote into the store's primary ground under a root write grant. Loam is
greenfield here — there are no installs to carry — so that connector simply consents again and
binds like any new one, to `ada:claude`. Its earlier writes stay where they are, because the
ground forgets nothing; its inbox pool starts empty and takes only what comes next, so a later
drop of that connection forgets exactly its post-binding writes. If Ada wants the earlier
writes gathered somewhere, she declares a container whose membership is what that key authored
— a container is a reading — and that is her admin page's ordinary declare form. *Surface:*
the consent page, then the admin page. *Rail:* story 1's; plus the suite asserts the pool holds
none of the pre-binding ids at the bytes.

## Positions

1. **Two levels are never bound and never offered to anyone but their owner.** DECIDED. The
   store root — the degenerate container of §28, where the constitution lives — is never a
   connection's binding and is offered only to the **operator token**: that is the test the
   door can actually run (no key is presented on a pull; a bearer is), and anyone holding the
   operator token pulls everything, stated plainly. The user's home container (`ada`) is the
   person's reach and the place they provision from, and it is not bound either. Every binding
   target is at depth two or deeper under the provisioning user. *Folded:* a non-operator user's
   own mirror or departure is a real need this arc does not answer — the home container offered
   to its owner's own §36 key — and it is a follow-on ticket (DECIDED), not a silent gap.

2. **The binding is the grant.** DECIDED. Standing is derived from the binding, never granted
   verb by verb. Bound to container `C`: *write* lands in the connection's own pool inside `C`,
   signed by its key (§39); *register* is law named under `C:` — the path **and its colon**, so
   a sibling sharing the letters (`ada:journalx`) is outside the fence — published on the
   connection's pool gateway and folded into the surface by the §47 aggregation extended from
   channel pools to inbox pools, re-attached at boot so bound law survives a restart;
   *receive* is a channel into a descendant of `C` from a source offered to this connection;
   *offer* is minting an offer token for a descendant of `C`; *read* resolves over a
   materialization scoped to `C`'s subtree — the shape `reads.ts` already uses for a channel's
   lens — so a query for rows that live in `ada:other` or in `loam.grants` answers as if they
   were not there; *delegate* is what may exist below `C` — a further key bound to a
   descendant, or a descendant whose leeway differs from `C`'s — within `C`'s delegation
   terms. `loam grant
   --verb=…` retires for connections once the tools that replace it have landed. *Folded:* three
   of those clauses were citations to mechanisms that do not exist yet for inbox pools (the
   fold, the read scope, the colon); they are requirements now, in slices S1 and S2.

3. **Full leeway inside the subtree; the walls are the edge.** DECIDED. Inside `C:…` a
   connection declares children, shapes, receives, offers, and delegates, deciding in
   conversation. It cannot cross the edge upward — nothing it writes lands in `ada` or the
   store, and moving its work up is promotion (position 6), the person's act. It cannot touch
   the constitution. It cannot make the store run code in the gateway process: resolvers
   arriving by federation stay inert until a person blesses them, and they are never a
   connection's to bless at any depth. A RENDERER arriving into its subtree it may bless itself
   (DECIDED): renderers run behind glass in a billed worker (§23.9), under this container's
   envelope, so the blast radius of a blessed renderer is the envelope's. It cannot exceed its envelope
   (§23's bills, set on the container). It cannot erase (§11 is home access).

4. **Leeway is four switches, an envelope, and delegation terms — off by default, each
   explained on the page.** DECIDED. Creating a binding target sets: *receive* (may it follow
   other containers), *offer* (may descendants be offered to other stores), *publish* (may
   lenses be declared public, §12), the *envelope*, and *delegate* — which is not a switch but
   the TERMS under which this container's subtree may differ from it:

   ```
   leeway = { receive, offer, publish, envelope, delegate: off | terms }
   terms  = { receive, offer, publish, envelope, delegate: off | "same" | terms }
   ```

   `off` means the subtree is a pure namespace: no new keys may be bound below, and every
   child inherits this container's leeway exactly, so there is nothing to configure and
   nothing to attenuate. `terms` says what may exist below; `"same"` means helpers may
   delegate further under these very terms, all the way down, without anyone writing the
   recursion out. There are no
   presets: a preset is a name for one row of a matrix whose every row stays reachable, and a
   name a friend has to learn is one more thing between them and the switch. Every switch
   starts off — the private journal is the default — and every switch carries, on the page and
   in plain words, what it gives and what it risks; the reader should have no question about
   either. The copy is part of this spec, because it is the promise:

   - **Receive** — *Let this container follow other stores.* What arrives is kept in a pool of
     its own, signed by whoever sent it, under a name you assign; you can freeze or drop it
     later. *The risk:* a store you follow can fill this pool with anything it publishes, and
     its schemas can bind here under your prefix — nothing arriving can reach outside this
     container, and nothing binds that you did not allow.
   - **Offer** — *Let other Loam stores follow this container.* You mint a token per follower;
     they receive a signed copy of what is here, under a name they choose. *The risk:* whoever
     holds an offer token can copy this container's own contents and keep that copy after you
     stop offering. An offer never includes what you follow from others.
   - **Publish** — *Let anyone on the internet read what you mark public here.* No login, no
     token: a web address. *The risk:* a public lens is readable by strangers and search
     engines until you unmark it. Nothing anonymous can ever write. Mark nothing public you
     would not print.
   - **Delegate** — *Let what exists under this container differ from it, on the terms you set
     here.* Turn it on and its terms unfold beneath: the same switches, an envelope ceiling, and
     *may delegate further*. An agent here may then declare sub-containers with their own
     leeway inside those terms, and hand out keys to helpers that live in them. *The risk:*
     anything you allow below, the agent here can reach through its subtree — an annex that
     receives is a room it can read. Helpers write under their own names, can never reach
     outside this container, and are revoked when the agent is — but until then, what they
     write is real.
   - **Envelope** — *How much compute an agent here may spend running things behind glass:*
     small, medium, or large. *The risk:* a larger envelope lets a misbehaving app run longer
     and use more memory before the store stops it. It never grants reach.

   The five are native controls with their labels and descriptions associated in the markup,
   visible without hovering, never signaled by color alone, so a screen reader and a phone read
   them the same. A leeway is a declaration on the container, so changing it later — on the
   container's admin page, with the same five lines — is a delta the next request obeys.
   **The one rule (folded twice — a premortem found escalation by nesting; Myk found that
   attenuating over a container's OWN switches made a sealed room with an open annex
   inexpressible):** a child's leeway — its switches, its envelope, and its own `delegate` —
   must fit inside its parent's `delegate` terms. The parent's own switches never enter the
   comparison. So `ada:agent1` with `receive: off` and `delegate: { receive: on, … }` cannot
   follow anything into its own room, but may declare `ada:agent1:annex` with `receive: on`
   and follow a store into that, dropping the annex later with the room untouched; and
   `publish: on, delegate: { publish: off, … }` publishes itself while its helpers cannot. A
   request for a child outside the terms is refused with the sentence naming the ceiling. The
   terms govern the whole subtree, keys or no keys — an annex needs no helper key to exist.
   **Cascade:** a delegated binding is rooted in the delegator's; revoking or dropping the
   delegator revokes every binding it delegated, on the next request. §28 called this
   effectiveness attenuating upward; no subtree can exceed what the person set at its top.

5. **Names are paths, paths are the namespace, and the tree agrees with the names.** DECIDED;
   two folds. Containers nest by name with the colon (`ada:agent1:inbox`); a bound connection's
   lenses carry the full path (`ada:agent1:log`); the GraphQL surface mangles as today
   (`ada_agent1_log`). **The edge agrees with the name:** the declaration door refuses a name
   whose path-parent (everything before the last colon) is not its declared parent, so a
   path-based fence and an edge-based reach can never disagree about one container; pool names
   (`inbox:…`, `channel:…`) are exempt by their leading token; a pre-§58 store whose edges and
   names disagree keeps its edges authoritative and lists the disagreements on the admin page as
   the to-do they are. **Injectivity is store-wide and rooted at the user:** each username's
   mangled form is reserved at creation, and a container, channel prefix, or lens whose mangled
   prefix would land on another user's is refused while a person is present; the refusal shown
   to a connection names only the connection's own name, never the other's — no oracle.

6. **Siblings share by the person's act, and promotion targets a container.** DECIDED; two
   folds. A channel's source must be offered to the puller, inside one store exactly as across
   two: a connection may receive only from a container that is offered and whose offer token it
   presents, so it cannot pull a sibling. The person opens a channel between two of their own
   containers from the admin page with no token, because they own both ends — that is the
   sibling story, and it needs no network leg (the source is a container scope, not a URL, so
   the page's paste-only rule is untouched). **Promotion, folded:** today promotion lands in the
   primary ground re-signed by the operator, which under position 1 is the wrong place and the
   wrong key. Promotion gains a destination inside the owner's subtree and re-signs with the
   owner's user seed (§40.2's seam); the destination's membership admits the promoted delta.

7. **The migration is a declaration, and the inbox never looks back.** DECIDED; one fold.
   A container is a reading. A connector that wrote into the primary ground before binding is
   adopted by `ada:claude`, a shared container whose membership is "what that key authored" —
   past writes become members without moving a byte. **One home, folded:** the connection's
   inbox pool takes only writes after the binding (its seeding scope is "author is the key AND
   timestamp after bindAt"), so a delta never has two homes, `drop` of a migrated connection
   forgets exactly what it wrote after binding, and the section says so. **One key per (client,
   user), folded:** a connector's actor seed is minted per consent, so one client consented by
   two people holds two keys and neither person's container adopts the other's work.
   **Greenfield (DECIDED):** there are no installs to carry. A connector consented before this
   section consents again and binds like any new one; a root write grant confers nothing once
   the door derives standing from bindings; nothing is deleted — the ground forgets nothing —
   and a person who wants a key's earlier writes gathered declares a container over them.

8. **The offer door serves containers, and the offer token is a designed thing.** DECIDED as
   the rule; the token is the fold. §46 deferred where a runtime federation credential lives;
   this section places it. An **offer token** is minted by a container's owner — on the admin
   container page, or by `loam_container offer` for a connection with the *offer* leeway — for
   one container; it is a secret and never a delta, stored 0600 in the home beside the channel
   tokens (§46.4); it is presented at `/:mount/<container>/federate` and nowhere else; it can be
   rotated and struck from the same page. **What an offer serves:** the container's own members
   and its connections' inboxes — never the channel pools inside it, nor the law blessed into
   them; passing a peer's deltas on is promotion first. **What Bob sees:** the offer serves the
   container's lenses by their bare names, so under his prefix `ada` the outbox's `Post` is
   `ada_Post`. **No compatibility window, folded:** the mount-level `/federate` stays
   operator-token-only, as it is today; no non-operator credential reaches it now, so nothing
   breaks and nothing needs a grace period, and a container's offer token presented at
   `/default` is refused from the first release.

## Slices

Build order, each its own landing PR, each landing its rails. The order keeps every path
walkable at every step: nothing a connection can do today stops working before its
replacement lands.

- **S1 — bind at consent.** The consent page's binding field, provisioning the home and the
  target in one act; `bindConnection` wired at consent with a per-(client, user) key and a
  forward-only inbox; reads scoped to the binding; root write grants no longer confer standing
  for connections.
- **S2 — the container tools and derived standing.** `loam_container` on the MCP roster
  (declare, leeway, receive, promote-stage, sever) landing together with register-under-
  the-path (inbox-pool publish and fold, boot re-attach), receive-within-the-subtree,
  delegation with attenuation and cascade — and only then the retirement of `loam grant
  --verb=…` for connections. S2 builds the *offer* SWITCH, which the leeway-fit rule weighs
  like any other; the offer ACT is S3's, beside the token it hands out.
- **S3 — the offer token and the container door.** Minting, showing, rotating, and striking on
  the admin container page; `loam_container offer`, so one secret's whole life is written in
  one slice; `/:mount/<container>/federate`; the bare-name rule; the no-pools-travel rule; the
  mount refusing a container credential.
- **S4 — the person's acts on the page.** Share-into for sibling channels; promotion with a
  destination and the owner's signature; leeway edits.
- **S5 — names and the tree.** Path-parent agreement at declaration; store-wide injectivity
  rooted at usernames; the pre-§58 disagreement listing. (Dissolves T260: every binding target
  is under a person, so every channel is in someone's reach.)
- **S6 — authorship on the read surface.** A view can name its authors under the declared rule,
  and a binding attributes a connection's writes to its owner; masked readers learn nothing
  new. (T259's second half; its own ticket after S2 — DECIDED.)

## Acceptance criteria

1. TWO LEVELS OFF-LIMITS, TWO-SIDED. The consent page refuses to bind the store root and the
   user's home container and binds `ada:journal`; the mount's `/federate` refuses a container's
   offer token and any non-operator credential while the operator token still pulls the whole
   ground; `/:mount/ada:outbox/federate` serves that container to its offer token and refuses
   the operator token presented as if it were one — verified by
   `test/server/consent-binding.test.ts` and `test/federation/offer-door.test.ts`.
2. THE BINDING IS THE GRANT, WITH THE COLON. A connection bound to `ada:journal`, holding no
   grant, writes into its own pool under `ada:journal`, registers `ada:journal:log` and is
   refused `ada:other:log`, `ada:journalx:log`, and `log`; its bound law is served after a
   restart; it receives into `ada:journal:inbox` from an offered source and is refused a
   channel into `ada:agent1`; it binds a helper to `ada:journal:helper` whose reach stops there
   — verified by `test/server/derived-standing.test.ts`.
3. READS ARE SCOPED. The same connection's `loam_query` of a lens whose rows live in `ada:other`
   answers as if they were absent, and of `loam.grants` likewise, while rows in `ada:journal`
   answer through the same call — verified by `test/server/read-scope.test.ts`.
4. THE WALLS. Nothing a bound connection writes lands in `ada` or the primary ground; a
   resolver arriving on its channel stays inert and the connection's attempt to bless it
   refuses, while a renderer it blesses serves behind glass under its envelope; a request to
   bind, offer, or declare above its root is refused with the sentence naming the rule; its
   envelope binds — verified by `test/server/subtree-walls.test.ts`.
5. LEEWAY FITS ITS PARENT'S TERMS, AND CASCADES. A container created with every switch off
   and `delegate: off` refuses receive, offer, and publish, and refuses any child leeway or
   helper key; with `receive: off` and `delegate: { receive: on }` the container's own channel
   request refuses while a child declared with `receive: on` binds and receives; with
   `delegate: { receive: off }` that child is refused; with `publish: on` and `delegate:
   { publish: off }` the container publishes while its child's publish refuses; a child asked
   for an envelope above the terms' ceiling is refused; revoking the delegator refuses the
   helper's next request while an unrelated binding is untouched; changing a leeway is a delta
   the next request obeys — verified by `test/server/leeway.test.ts`.
6. SIBLINGS SHARE BY THE PERSON'S ACT. Ada's share-into from `ada:journal` to
   `ada:agent1:journal` reads the journal through agent1's pool and nothing else; agent1's own
   request to open that channel refuses while the journal is unoffered; dropping the pool ends
   the access; the journal is untouched at the bytes — verified by
   `test/federation/sibling-channel.test.ts`.
7. PROMOTION TARGETS A CONTAINER AND SIGNS AS THE OWNER. A delta promoted from
   `ada:agent1:scratch` into `ada:journal` is a member of `ada:journal` through a View, is signed
   by Ada's user key, and is absent from the root read; promotion into a container outside her
   subtree refuses — verified by `test/server/promote-into.test.ts`.
8. ONE HOME, ONE KEY PER PERSON. A connection's inbox pool holds only what it wrote after
   binding — a delta its key authored elsewhere before binding is absent from the pool at the
   bytes — so a drop of that connection forgets exactly its post-binding writes; one client
   consented by two users holds two keys, and neither person's container gathers the other's
   work; a connector's pre-§58 root write grant confers no standing at any door — verified by
   `test/server/consent-binding.test.ts`.
9. NAMES ARE PATHS AND THE TREE AGREES. A declaration whose path-parent is not its declared
   parent is refused; a username whose mangled form lands on an existing path is refused at
   creation; a container whose mangled prefix lands on another user's is refused with a message
   that names only the requester's own name; a peer's law arriving into `ada:agent1:inbox` binds
   under that path plus the assigned prefix — verified by `test/gateway/path-names.test.ts`.
10. AN OFFER SERVES ITS OWN. A pull of an offered container carries its members and its
    connections' inbox writes and none of a channel pool's deltas nor the law blessed into that
    pool; the lenses arrive under the puller's prefix by their bare names (`ada_Post`) — verified
    by `test/federation/offer-scope.test.ts`.
11. THE OFFER TOKEN'S LIFE. Minted on the container page and shown once; rotating it refuses the
    old one on the next pull; striking it refuses every pull; it is never a delta and never in an
    offer — verified by `test/server/offer-token.test.ts`.
12. THE STORY RAILS. A real browser walks the consent page from a user with no containers and no
    seed, through password and binding, to a connected store that files a note into the chosen
    container; a browser drives share-into, promotion with a destination, and the offer-token
    mint; an MCP client drives each `loam_container` tool
    two-sided; the CLI follow story runs against two served stores with a token obtained through
    the page — verified by `test/browser/consent-binding.test.ts`,
    `test/browser/container-acts.test.ts`, `test/server/container-tools.test.ts`, and
    `test/cli/follow-story.test.ts`.
13. THE FIVE SWITCHES, IN WORDS. The consent page and the container's admin page render the
    five switches unchecked by default, each a native control whose label and description are
    associated in the markup and visible without hovering; each description carries the
    capability sentence and the risk sentence in position 4's words, asserted literally; a
    browser rail flips one switch and the resulting leeway declaration carries exactly that
    change — verified by `test/server/leeway-copy.test.ts` and
    `test/browser/consent-binding.test.ts`.

## Open questions (Myk)

Answered 2026-09-01, the same day, and folded above:

1. **May a connection sever its own channels without a person?** DECIDED: yes, inside its
   subtree, two-sided like every sever.
2. **May a connection bless a peer's RENDERER into its own subtree?** DECIDED: yes, behind
   glass, under its envelope; resolvers never, at any depth.
4. **Does S6 stay inside this arc?** DECIDED: its own ticket after S2.
5. **Upgrade day for already-consented connectors.** DECIDED: greenfield — there are no
   installs to carry; a connector consented before this section consents again.
6. **A non-operator user's own mirror.** DECIDED: a follow-on ticket — the home container
   offered to its owner's own §36 key — not this arc's.

3. **Presets.** DECIDED: none. Five switches, off by default, each with a plain-language
   description of what it gives and what it risks, accessible on the page — the reader should
   have no question about either. Every row of the matrix stays reachable; a row earns a name
   only if evidence shows people keep choosing it.

Nothing remains open. The spec is whole.

**Provenance.** Drafted 2026-09-01 from the conversation in which Myk named the abstraction and
settled its shape; §27, §28, §39, §46, and §47 are the precedents it finishes. T258, T259, and
T260 — three tickets minted earlier the same day for gaps a first-steps document had to route
around — are the symptoms this section retires. Seventeen premortem and cross-model findings
are folded above, each named at the position it changed.
