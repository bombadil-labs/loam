## 31. The mount table — which world answers at a name, asked per request

Every served path in Loam begins `/:mount/` (§5, §17, §23, §26), and until now the table behind that segment
was **frozen at `serve()`**. One mount was one store was one isolated world (§7), decided at boot and
unchanged until the next boot. That was the right shape while a store was the only kind of world. §27 made
containers a primitive and §24 made them live objects — spawned, attached, dropped at runtime — and a frozen
table quietly capped the whole story: *ingest this module and run it* ended at a restart.

This section is the serving surface for containers, and it is new ground rather than an amendment. §27 is
normative for the container PRIMITIVE (membership, identity, the merges), §24 for the quarantine POLICY, §12
for what an anonymous door may answer, §5 and §17 for the door SET each mount exposes. None of them owns the
routing question — *which gateway answers at this name, right now* — and that question turns out to carry
safety properties of its own the moment its answer can change between two requests.

### 31.1 Three tiers, and the precedence IS the safety property

A mount name resolves through three tiers, consulted in exactly this order:

| tier | source | who decides |
|---|---|---|
| 1. **static** | `serve({ mounts })` | the operator, at boot |
| 2. **dynamic** | `addMount(name, gateway)` / `removeMount(name)` on the running handle | the operator, at runtime |
| 3. **containers** | every ATTACHED container of any gateway mounted above, at its declared entity name | derived — nobody registers it |

The order is not a convenience. **Containers resolve LAST, so a container can never displace a name the
operator already spoke for.** A store loads modules it did not write; a module declares its own container
name; if that name could shadow tier 1 or tier 2, a stranger's manifest would decide where the operator's own
world is served. Being last, it cannot. `addMount` completes the rule from the other side by refusing any name
that already resolves — tier 3 included — because re-pointing a live name would silently move every consumer
of it.

The asymmetry is real and deliberately one-sided: a container attached *after* an `addMount` of the same name
is simply **unreachable**, not shadowing. The server does not own the `openContainer` call and cannot refuse
it, so the only honest options are "unreachable" and "displaces the operator" — and §31.4 is how unreachable
stops being silent.

### 31.2 The container tier is DERIVED, never registered

Tier 3 holds no table of its own. It reads the host gateway's own attachment index live, at resolve time. So
`openContainer` needs no callback into the server to mount, `drop()` and `detach()` need none to unmount, and
**the two facts cannot drift** — there is no second place for the truth to be stale in. A dropped container
leaves no zombie gateway behind still serving from a world its own operator has proven gone.

Liveness asks BOTH the questions §24.8's erasure guard asks: the container is named in the attachment index
**and** its gateway is in the host's `quarantinePools`. Those are two records of one fact, and a wall present
in one but not the other is exactly a wall outside §11's erasure fan-out — so it serves nothing. One question
would have been enough to route; two are what keep the served set inside the set erasure can reach. A
PROPERTY container (§27.1) has no gateway of its own and never appears here at all: it is a query over shared
ground, and the ground's own mount already serves it.

### 31.3 A mount can vanish mid-request, and a captured gateway is not a licence

The gateway resolved at routing time is a claim about the past. Every `await` in a handler is a window —
and the widest one is client-paced: a request body arrives at whatever rate the caller sends it, so `drop()`
or `removeMount()` can land in the middle of reading one. Answering from the captured gateway afterwards
serves bytes a drop had already proven gone: a 200 about a dead world, which is H7's shape at the transport
layer.

So every handler carries a **mount guard** and re-resolves before it touches the gateway: *same name, same
gateway instance* — or else it answers exactly what an absent mount answers that caller. Not an error, not a
500: the ordinary refusal, so the window closing changes the timing and never the vocabulary.

The subscription path is the same window with worse consequences (a stream registering *after* a teardown
sweep has already run would never be swept), so the two are provably ordered rather than merely careful:
check-to-register contains no `await`, and the sweep's remove-and-snapshot is one synchronous turn.
`removeMount` ends the live streams on THAT mount and no others — a mount going away is not a reason to
disconnect the rest of the server.

### 31.4 A name no URL can reach is said out loud

A mount name has to survive one round trip through a URL path segment, or the mount it names is a door that
reported success and opened nothing. The rule is one function applied to all three tiers — empty names, `/`,
control characters, and a name carrying its own percent-escape (which the router would reach under a spelling
nobody mounted) are all refused.

Tiers 1 and 2 refuse at the call: `serve()` throws, `addMount` throws. Tier 3 cannot — the server does not own
`openContainer` — so a container whose declared name is not routable is SKIPPED at resolve, and
**`unroutableMounts()` lists exactly what was skipped**. That listing is the point: a silent skip and a
phantom mount are the same lie told from opposite ends, and an operator whose module went nowhere needs to be
able to read why. `removeMount` is symmetric about honesty — it refuses a static mount (boot's word is not
revocable at runtime) and refuses a container's own mount (that door lives and dies with the container, so
`drop()` or `detach()` is the way to close it) rather than answering `false`, because a caller told "nothing to
remove" would believe a door shut that stands open.

### 31.5 What a moving mount table must NOT change

**The door discipline is unchanged, and that is the load-bearing part.** To a tokenless caller, a mount that
exists, a mount that was removed, and a mount that never existed must be byte-identical refusals (§12). A
moving mount set is precisely how a 404-vs-401 oracle gets reintroduced — existence becomes observable
through timing or wording — so the refusal is the uniform one on every verb, live or gone or never-there.

**The anonymous door on a container mount is the HOST's live decision, never the wall's copy of it.** Two
questions have two owners: the host answers WHETHER a tokenless caller may read at all, the wall answers
WHAT it reads. The operator's `loam:public` declaration lives at the host and is revocable there; a wall holds
only a seeded snapshot of it, which moves on `reseed()` (§24.2). Gating on the pool's own answer would make a
§12 revocation **unrevocable at every container mount** — strike the declaration, the host's door closes, and
every module's door stays open forever. Both must be open for a tokenless read to be served.

**The token table is the host's, whole.** A dynamic mount answers under the same identities as a static one; a
container that needs its own identities is a later design.

**The write doors are open on a container mount, and that is a consequence rather than an oversight.** An
operator or actor token may `POST /<container>/append` or `/register` straight into the walled arena, bypassing
the container's `admit` / `membership` — because those govern the SEEDING EDGE, not the door. Nothing there
exceeds what the same token can already do to the host, since a wall shares the host's operator (§24.1), so
this widens no authority under one operator. It is written down because §28's wall governs writes, law-reach,
and trust-crossing — never visibility — and a reader who took "the wall governs writes" literally would expect
the door to be shut.

**Provenance.** **BUILT** [#209](https://github.com/bombadil-labs/loam/pull/209) (realizes ticket T78,
2026-07-25) — `src/server/mounts.ts` is the three-tier table (`resolve` / `add` / `remove` / `unroutable`,
plus the one `mountNameDefect` every tier shares), wired into `src/server/http.ts` as
`ServerHandle.addMount` / `removeMount` / `unroutableMounts` and a per-handler mount guard re-resolved past
every `await`. Tier 3 reads `Gateway.attachedContainers` ∩ `Gateway.quarantinePools` live, so §27's
`openContainer` and `drop()`/`detach()` mount and unmount themselves with no callback and no second copy of
the truth. Rails `test/server/dynamic-mounts.test.ts` (23) assert at the OBJECT level throughout — what the
HTTP door ANSWERS, before and after — because the whole product here is a served door; the delta level is
T32's, already railed under `test/gateway/container-*`. Watched red before the code (14 of 15 failed on the
bare handle, and the precedence rail earned a twin so it cannot pass empty), with six hand-run mutation
probes killed: dropping the `quarantinePools` check, ending every stream instead of the mount's, leaking mount
existence to the tokenless door, deleting the percent-escape branch, widening the control-character boundary
to `0x20`, and dropping dynamic hosts from the host list.

An independent door-discipline review found **two confirmed defects in the first version, both
authorization-shaped**, and both rails were watched red before the fix. **Revocation was defeated (§12):** the
anonymous gate asked the CONTAINER's `hasPublicSurface()`, and a wall holds its own seeded copy of
`loam:public` that moves only on `reseed()` — so striking the declaration closed the host's door and left
every container mount's open permanently (probe: `/commons` 200, strike, `/garden` 401, `/commons` still 200).
The gate is now the host's live word, carried on the resolved mount. **And a mount could vanish mid-request:**
the gateway was captured before the identity check and before every `await`, and `readBody` is client-paced, so
a slow body held across `drop()` was answered from the dropped world — §31.3 is that fix. The same read found
the name rule binding only two of three tiers (a container declared `"a/b"` attached and was silently
unreachable; one declared `"a%2Fb"` answered under a spelling nobody wrote) and the write doors implied rather
than stated (§31.5's last paragraph is the sentence the header owed a reader).

**Residual, and it should land before dynamic mounts are advertised: ticket T88.** T78 closed the severe half
of the anonymous-door problem — the host now decides WHETHER — but the host still only decides whether, and
the wall still decides what. So an operator who NARROWS their public set (strike the declaration, publish a
smaller one) leaves the attached wall serving its own snapshot of the wider set until a `reseed()`. The door's
openness is live; its content is a point-in-time copy by construction (§24.2). Closing that needs a
Gateway-side seam — a cached public-lens-set reader to intersect the wall's answer against — not a transport
one, which is why it is its own ticket and not a fold here. No delta changes shape; this is transport only →
**no §20 migration**. New serving surface on an anonymous door → Myk's merge (P6).
