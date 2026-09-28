# Step 6 inventory: host-author reads of child grounds

Status: inventory, approved by Sol 2026-09-28, with the step-6 contract folded in. Main at the step 5 wrap-up (#646).

Today every child ground (inbox pool, channel pool, quarantine or separate container) is governed
by its host's key: it opens with `seed: gw.childSeed()`. Step 6 gives each child its own
governing key. This list names every place where a key choice then matters: a child's rows read
with the host's key, or read with the child's key when the rows are host-signed.

For each finding:
- (a) the ground whose rows are read;
- (b) the key that governs those rows after cutover;
- (c) whether the read also resolves user facts (those stay host facts, through `usersGovernor`);
- (d) the concern: admission, serving, arrival testimony, erasure, or other.

## Four patterns

1. **Seeded copies.** A separate, quarantine or channel pool is seeded from its host
   (`reseed()` federates `gw.offeredDeltas()`, container.ts:1797). It holds host-signed copies of
   the container table, registrations, trust, grants, erasures, slates and renderer twins. Every
   reader in the pool that uses the pool's own key stops seeing them. Inbox pools are mostly spared:
   their seeding scope takes only the connection's own deltas.
2. **Erasure fan-out.** The host's erasures land in pools, still host-signed. Pools judge them with
   their own key.
3. **Inbox grants read with the host key.** Inbox grants are pool law (`poolLaw`, #644), but
   several readers still pass `gw.operatorAuthor`.
4. **Host-seed writes into pools.** User recovery and grant revoke sign pool rows with the host's
   seed.

The decisions these need are for the step-6 contract: which copies a child accepts from its host
under the host's key (patterns 1 and 2), and whether a host may still write a child's law
(pattern 4).

## The contract (Sol, 2026-09-28)

Sol's step-6 contract settles the patterns. API names stay provisional until the SPEC-6 vectors
freeze.

- A peer is its governing public key. Local append and foreign transfer enter one verification and
  refusal boundary. The caller names the receiving peer and the receive time; nothing is inferred
  from the host process. Host and child trust is application policy, not a substrate parent.
- **Seeded copies (pattern 1).** Seeded host deltas stay HOST-authored testimony in the child. A
  child may select the host as a trusted author for named law contexts. The child's own law uses
  `pool.signer.author` alone. No reader treats {host, pool} as one governor.
- **Erasure (pattern 2).** An old host erasure copied into a child is testimony, not a child
  refusal. A host refusal already in force on the old surface is CARRIED state at handoff. After
  cutover each child takes its own erasure order through its own admission: child-signed, or
  host-signed only where the child pins the host as an erasure governor and the order names that
  child. Each child reports its own obligation and byte result; a roll-up reports the conjunction.
- **Pool law (patterns 3 and 4).** Pool cuts, outcomes, owner grants, strikes, arrival stamps and
  incarnations use the pool signer. The host recovery record and user claims use the host signer.
  A host command may write pool law through its local pool handle, with the pool's signer. A
  host-signed claim has no general authority in a child. Grant revoke needs the child's signer or
  a declared delegation rule.
- **Auto-bless.** Exclude both the pool's key and the host's seeded key.
- **Cutover.** Replacing `childSeed()` alone is invalid. An existing shared-key pool is a surface
  of the host until a barriered handoff commits: carry the whole refusal set and the active byte
  obligations into durable child state, fence the old purge workers, commit ownership and proof
  once, then let the child admit and serve. Imported bytes keep their authors and ids. The child's
  arrival testimony starts at its own import. On failure the old surface stays responsible, and
  the child cannot serve. A NEW, empty pool starts with its own key and needs no handoff.

## Tags

Each finding carries one or two of the contract's four tags:

- **own pool law**: the child's own records, read and written with the child's key.
- **selected host law**: host-signed copies the child admits, read with the host's key where the
  child explicitly selects the host for that law context.
- **host user ground**: user facts, read with the host's key through `usersGovernor`.
- **peer-local erasure state**: the child's own refusals and byte obligations. After cutover this
  means carried refusals and targeted, pinned host orders, never "filter copied host erasures by
  the host key". Where a table says "host" in (b) on an erasure row, read it that way.

## Findings

### Admission

| where | (a) rows | (b) key after | (c) users | note | tag |
|---|---|---|---|---|
| ingest.ts:352-375 `appendAdmitted`, recovery barrier: `liveCutIds`, `refusedIds` on each pool with `gw.operatorAuthor` | inbox and channel pools | pool | yes (record, manifest: host) | the pool's own door reads the same cuts with the pool key | own pool law |
| ingest.ts:289/862 `refusedIds`, :296/871 `readSlates`, :888/934 `eraseDefect`, :889 `slateDefect`, :918/928 `erasedInBatch`, when the gateway is a pool | any child | host (erasure and slates are the host's power) | no | pattern 2 | peer-local erasure state |
| ingest.ts:890/932 `recoveryDefect` at a pool door | any child | host, through `usersGovernor` | yes | UNSURE: pools hold no recovery records today | host user ground |
| ingest.ts:325 `authorize` and :459-462 `admitForImpl` at a pool door | quarantine and channel pools | pool for its own policy; the seeding edge must admit the host's key | no | pattern 1 | own pool law; selected host law (seeded trust) |
| container.ts:1204-1225 `openerStands`: `holdsGrant(inbox, …, gw.operatorAuthor)` | inbox | pool | no | reached from connection-authority.ts, the http door, renderer selection | own pool law |
| the same `openerStands` read through `keepSyncingImpl` (channel.ts:2524), `boundBindingsImpl` (lifecycle.ts:548), `openChannel`'s protected-opener check (channel.ts:2128) | inbox | pool | no | also syncing and serving | own pool law |
| http.ts:543-593 `registerStanding` / `federateStanding` at a container mount | quarantine or separate pool | host (seeded grants) | no | UNSURE | selected host law |
| user-recover.ts:290-301 `signCut`: incarnation and refused set on a pool with the host key; the cut is signed by the host seed | inbox and channel pools | pool | yes | pattern 4 | own pool law |
| user-recover.ts:308-358 `settleCuts`: outcomes on a pool with the host key and seed | inbox and channel pools | pool | yes | pattern 4 | own pool law |
| erase.ts:1491-1515 `eraseReplicaImpl` gates: `eraseDefect`, `localEraseTarget` with the pool key on a host-signed erasure | any child | host | no | pattern 2 | peer-local erasure state |

### Serving

| where | (a) rows | (b) key after | (c) users | note | tag |
|---|---|---|---|---|
| channel.ts:840-844 `arrivedBindings`: `readForeignRenderers(ground, …, gw.operatorAuthor)` | channel pool | exclude the pool key (its blessings) AND the host key (seeded twins) | no | feeds the apps report and bless-app | own pool law; selected host law |
| slate.ts:1086-1095 `readClosedIds` on a pool (every reactor, through `declareReadHidden`) | any child | host | no | slates are ordinary host deltas in the offer, so they reach seeded pools | peer-local erasure state |
| reads.ts:337 `channelGroundFor`: `erasedInScope(…, gw.operatorAuthor, scope)` | channel pool | host for fan-out; the pool's key for its own local-control erasures | no | UNSURE about the split | peer-local erasure state |
| reads.ts:364 `boundGroundFor`: the same over inbox pools | inbox | host for fan-out | no | | peer-local erasure state |
| listing.ts:598 `withoutErasedScope`: the same | any child | host for fan-out | no | | peer-local erasure state |
| reads.ts:461-472 `gatherPoolForRetraction`: governed evaluation embeds the host key in lens bodies (`lawfulStrikersJson`) | inbox and channel pools | pool for pool grants | yes, fine | UNSURE | own pool law |
| ingest.ts:589-592/616 `deadSet` / `withoutErased` on a pool gateway | any child | host | no | a nested pool's offer or reseed | peer-local erasure state |
| container.ts:906/929 `containerScopeImpl` inside a pool: host-seeded declarations with the pool key | quarantine and channel pools | host | no | pattern 1: blessed lenses that scope the parent fail | selected host law |
| container.ts:1796-1809 reseed, then `pool.replayRegistrations()` with the pool key | quarantine and channel pools | host (seeded rows) | no | pattern 1 | selected host law |
| admin-federation.ts:338 `connectionRowHtml` → `connectionGrantState` (:180 `holdsGrant`, :204 `struckAt`, :209-211 `grantRoots`, `delegationStatesFor`) with the host key | inbox | pool | no | the connections panel | own pool law |
| http.ts:1383-1390 `whoamiFor` → `writeStanding`: `holdsGrant(pool, …, gateway.operatorAuthor)` | inbox | pool | no | whoami | own pool law |
| http.ts:3532 users door on a container mount: `rolesOf(pool.reactor, pool.operatorAuthor)` | any child | host | yes | UNSURE: only an embedder reaches it | host user ground |
| cli.ts:3940-3950 `cmdGrantList`: `holdsGrant(inbox, …, host)` | inbox | pool | no | the ledger | own pool law |
| erase.ts:661 `readGrounds` → `maskReadings(pool)` | any child | pool (correct), but seeded registrations drop out | no | pattern 1 | own pool law; selected host law |

### Arrival testimony

| where | (a) rows | (b) key after | (c) users | note | tag |
|---|---|---|---|---|
| local-channel-events.ts:531 `localChannelEvidence`: `readErasures(ground, …, ground.operatorAuthor)` | channel pool | host for fan-out erasures; the pool's key for its own local-control erasures | no | the received operand, renderer selection | peer-local erasure state |

### Erasure reporting

| where | (a) rows | (b) key after | (c) users | note | tag |
|---|---|---|---|---|
| erase.ts:1009 `liveOpening`: `pool.reactor.get(id)?.claims.author === gw.operatorAuthor` | channel pool | pool | no | decides "the pool's own byte" | own pool law |
| erase.ts:1424 `erasureStandings`, recursing into `quarantinePools`: `readErasures(gw = pool, …)` | any child | host | no | otherwise every pool reads "owed" forever | peer-local erasure state |
| ingest.ts:245 `appendLocalErasure` → `localEraseTarget(…, gw.operatorAuthor)` from `eraseReplicaImpl` | any child | host | no | | peer-local erasure state |
| container.ts:1658 `openSeparateImpl`: `readErasures(gw, …)` when `gw` is itself a pool | nested child | host | no | UNSURE | peer-local erasure state |

### Other

| where | (a) rows | (b) key after | (c) users | concern | tag |
|---|---|---|---|---|
| channel.ts:663 `bindArrived`: skip when `author === gw.operatorAuthor` | channel pool | exclude the pool key AND the host key | no | auto-bless: excluding only the host key recreates the `alice:alice:Plant` re-bless loop | own pool law; selected host law |
| container.ts:2630 `revokeConnectionImpl`: `byOperator = owner === pool.operatorAuthor`; cli.ts:4061-4068 `cmdGrantRevoke` falls back to the host seed | inbox | pool | no | revocation voice (pattern 4) | own pool law |
| admin-federation.ts:633, :648-654, :895-901 `planRevoke` and the revoke handler: `holdsGrant(pool, …, gw.operatorAuthor)` | inbox | pool | no | revoke plan | own pool law |
| user-recover.ts:716-726 commit leg: `strikes(inbox, host)`, signed by the host seed | inbox | pool | yes | stripping a retired key's standing (pattern 4) | own pool law |
| adopt.ts:253-256 `promoteImpl`: `dataStrikeWitnesses(source, …, source.operator)` | any child | UNSURE: the comment assumes the host's review strike binds in the pool | no | promotion | UNSURE: own pool law |

Already correct: every pool read keyed by the pool itself in lifecycle.ts (:456, :530-534, :552,
:800), renderer-selection.ts:278, renderers.ts:397/:763, adopt-law.ts:1378-1381, container.ts
(:2044-2101, :2440-2502, :2586-2728) and mutate.ts (:153, :219). Some of them drop seeded host
rows after cutover (pattern 1).

## Construction tasks

1. **`childSeed()`** (gateway.ts:490-492) returns the host's seed. Its one caller is container.ts
   :1699 (with `pens`). Every child comes through it: `attachChannelPool` (channel.ts:1304),
   `bindConnectionImpl` (container.ts:2420), `resumeInboxesImpl` (:2566), quarantine pools. Step 6
   replaces it with a child key: minted, stored and loaded per child.
2. **`options.seed` exposure.** gateway.ts:513 (constructor → `signer`, `operatorAuthor`),
   gateway.ts:570 (`Gateway.open` marker check), gateway.ts:639 (`Gateway.boot` from
   `genesis.operatorSeed`). Step 6 stops exposing it, so the `Signer` becomes the only holder.
3. **Host-seed writes into children**: user-recover.ts:299, :342, :725 and cli.ts:4068. Each
   either becomes the child's own signer, or a host act the child admits by a contract rule.

The runner's (runner.ts:335) and the client's (client/index.ts:87) `options.seed` are their own
keys, not a gateway's.

## Counts

34 findings, each in one table under its main concern: admission 10, serving 14, arrival testimony
1, erasure reporting 4, other 5.
