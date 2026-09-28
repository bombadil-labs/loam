# Step 6 inventory: host-author reads of child grounds

Status: draft for Sol, 2026-09-28. Main at the step 5 wrap-up (#646).

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

## Findings

### Admission

| where | (a) rows | (b) key after | (c) users | note |
|---|---|---|---|---|
| ingest.ts:352-375 `appendAdmitted`, recovery barrier: `liveCutIds`, `refusedIds` on each pool with `gw.operatorAuthor` | inbox and channel pools | pool | yes (record, manifest: host) | the pool's own door reads the same cuts with the pool key |
| ingest.ts:289/862 `refusedIds`, :296/871 `readSlates`, :888/934 `eraseDefect`, :889 `slateDefect`, :918/928 `erasedInBatch`, when the gateway is a pool | any child | host (erasure and slates are the host's power) | no | pattern 2 |
| ingest.ts:890/932 `recoveryDefect` at a pool door | any child | host, through `usersGovernor` | yes | UNSURE: pools hold no recovery records today |
| ingest.ts:325 `authorize` and :459-462 `admitForImpl` at a pool door | quarantine and channel pools | pool for its own policy; the seeding edge must admit the host's key | no | pattern 1 |
| container.ts:1204-1225 `openerStands`: `holdsGrant(inbox, …, gw.operatorAuthor)` | inbox | pool | no | reached from connection-authority.ts, the http door, renderer selection |
| the same `openerStands` read through `keepSyncingImpl` (channel.ts:2524), `boundBindingsImpl` (lifecycle.ts:548), `openChannel`'s protected-opener check (channel.ts:2128) | inbox | pool | no | also syncing and serving |
| http.ts:543-593 `registerStanding` / `federateStanding` at a container mount | quarantine or separate pool | host (seeded grants) | no | UNSURE |
| user-recover.ts:290-301 `signCut`: incarnation and refused set on a pool with the host key; the cut is signed by the host seed | inbox and channel pools | pool | yes | pattern 4 |
| user-recover.ts:308-358 `settleCuts`: outcomes on a pool with the host key and seed | inbox and channel pools | pool | yes | pattern 4 |
| erase.ts:1491-1515 `eraseReplicaImpl` gates: `eraseDefect`, `localEraseTarget` with the pool key on a host-signed erasure | any child | host | no | pattern 2 |

### Serving

| where | (a) rows | (b) key after | (c) users | note |
|---|---|---|---|---|
| channel.ts:840-844 `arrivedBindings`: `readForeignRenderers(ground, …, gw.operatorAuthor)` | channel pool | exclude the pool key (its blessings) AND the host key (seeded twins) | no | feeds the apps report and bless-app |
| slate.ts:1086-1095 `readClosedIds` on a pool (every reactor, through `declareReadHidden`) | any child | host | no | UNSURE whether slates reach pools; erasures do |
| reads.ts:337 `channelGroundFor`: `erasedInScope(…, gw.operatorAuthor, scope)` | channel pool | host for fan-out; the pool's key for its own local-control erasures | no | UNSURE about the split |
| reads.ts:364 `boundGroundFor`: the same over inbox pools | inbox | host for fan-out | no | |
| listing.ts:598 `withoutErasedScope`: the same | any child | host for fan-out | no | |
| reads.ts:461-472 `gatherPoolForRetraction`: governed evaluation embeds the host key in lens bodies (`lawfulStrikersJson`) | inbox and channel pools | pool for pool grants | yes, fine | UNSURE |
| ingest.ts:589-592/616 `deadSet` / `withoutErased` on a pool gateway | any child | host | no | a nested pool's offer or reseed |
| container.ts:906/929 `containerScopeImpl` inside a pool: host-seeded declarations with the pool key | quarantine and channel pools | host | no | pattern 1: blessed lenses that scope the parent fail |
| container.ts:1796-1809 reseed, then `pool.replayRegistrations()` with the pool key | quarantine and channel pools | host (seeded rows) | no | pattern 1 |
| admin-federation.ts:338 `connectionRowHtml` → `connectionGrantState` (:180 `holdsGrant`, :204 `struckAt`, :209-211 `grantRoots`, `delegationStatesFor`) with the host key | inbox | pool | no | the connections panel |
| http.ts:1383-1390 `whoamiFor` → `writeStanding`: `holdsGrant(pool, …, gateway.operatorAuthor)` | inbox | pool | no | whoami |
| http.ts:3532 users door on a container mount: `rolesOf(pool.reactor, pool.operatorAuthor)` | any child | host | yes | UNSURE: only an embedder reaches it |
| cli.ts:3940-3950 `cmdGrantList`: `holdsGrant(inbox, …, host)` | inbox | pool | no | the ledger |
| erase.ts:661 `readGrounds` → `maskReadings(pool)` | any child | pool (correct), but seeded registrations drop out | no | pattern 1 |

### Arrival testimony

| where | (a) rows | (b) key after | (c) users | note |
|---|---|---|---|---|
| local-channel-events.ts:531 `localChannelEvidence`: `readErasures(ground, …, ground.operatorAuthor)` | channel pool | host for fan-out erasures; the pool's key for its own local-control erasures | no | the received operand, renderer selection |

### Erasure reporting

| where | (a) rows | (b) key after | (c) users | note |
|---|---|---|---|---|
| erase.ts:1009 `liveOpening`: `pool.reactor.get(id)?.claims.author === gw.operatorAuthor` | channel pool | pool | no | decides "the pool's own byte" |
| erase.ts:1424 `erasureStandings`, recursing into `quarantinePools`: `readErasures(gw = pool, …)` | any child | host | no | otherwise every pool reads "owed" forever |
| ingest.ts:245 `appendLocalErasure` → `localEraseTarget(…, gw.operatorAuthor)` from `eraseReplicaImpl` | any child | host | no | |
| container.ts:1658 `openSeparateImpl`: `readErasures(gw, …)` when `gw` is itself a pool | nested child | host | no | UNSURE |

### Other

| where | (a) rows | (b) key after | (c) users | concern |
|---|---|---|---|---|
| channel.ts:663 `bindArrived`: skip when `author === gw.operatorAuthor` | channel pool | exclude the pool key AND the host key | no | auto-bless: excluding only the host key recreates the `alice:alice:Plant` re-bless loop |
| container.ts:2630 `revokeConnectionImpl`: `byOperator = owner === pool.operatorAuthor`; cli.ts:4061-4068 `cmdGrantRevoke` falls back to the host seed | inbox | pool | no | revocation voice (pattern 4) |
| admin-federation.ts:633, :648-654, :895-901 `planRevoke` and the revoke handler: `holdsGrant(pool, …, gw.operatorAuthor)` | inbox | pool | no | revoke plan |
| user-recover.ts:716-726 commit leg: `strikes(inbox, host)`, signed by the host seed | inbox | pool | yes | stripping a retired key's standing (pattern 4) |
| adopt.ts:253-256 `promoteImpl`: `dataStrikeWitnesses(source, …, source.operator)` | any child | UNSURE: the comment assumes the host's review strike binds in the pool | no | promotion |

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
