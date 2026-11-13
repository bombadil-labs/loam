# Store move inventory

**Status:** analysis only. No source file changed. Written 2026-11-09 against Loam `main` at
`6cce5a25`.

**Base commit.** Every line number and count in this document refers to commit `6cce5a25`. Main
has moved since. Section "Changed on main since" lists what moved.

## Changed on main since

These changes landed after `6cce5a25`. The tables below still show the `6cce5a25` state.

- `ingest.ts:610` `deadSet` now reads the target index at `ERASE_ENTITY` (#695).
- `local-channel-events.ts` `heldAt` now reads the target index (#695).
- Caches C1 and C6 now key on the ground revision (#696). Plan item A4 is done.
- Registries K1 to K4 are now one `WeakMap<Reactor, GroundDeclarations>` (#696).
- The `Ground` read type exists, in `src/gateway/ground.ts` (#697).
- The callers of the two `lawful.ts` helpers fell from 22 to 16 (#699).

**Contract read:** rhizomatic `spec/18-store.PROPOSAL.md` (SPEC-18), all sections. Slice 5 of that
proposal moves Loam onto the store. This document plans that move.

**How to read a claim.** VERIFIED means the author read the code at the cited line and its context.
INFERRED means the class comes from the cited line and its function name only.

## 0. Method and counts

- One site is one source line that calls the reactor or a `StoreBackend`.
- The search covered `src/` only. Comment lines are not sites.
- Each site has exactly one label. One line carries two: `runner.ts:271` is a write site and a
  view site, so it counts as two sites.

The six classes from the brief cover reads:

| Class | Meaning after the move |
|---|---|
| scope | Part of a read with known anchors. One `scope` call, then synchronous evaluation. |
| indexed | A point lookup: `get`, `targets` or `negators`. |
| feed | Notices change or catches up. Becomes `changes(from)` or a revision compare. |
| admin | Whole-set by nature. Becomes the `Exporter`. |
| **whole-set, serving** | A full scan that serves a request with no anchor today. |
| dies | Exists only for boot replay, reseat or the memory set. |

Five more labels cover sites that are not reads. Without them a write would carry a read class.

| Label | Meaning after the move |
|---|---|
| write | `ingest`, `ingestBatch`, backend `append`, `close`. Becomes `PeerStore.append` or `Store.close`. |
| purge | Backend `purge` and byte probes. Section 4 maps each one. |
| view | Maintained views: `register`, `materializedView`, `subscribe`, `advanceTime`, `refreshAll`, `nextValidityBoundary`. A memory cache until slice 6, then stored views. |
| local | A throwaway `new Reactor()` over deltas the caller already holds. No store call. |
| cache | A `WeakMap<Reactor, …>` declaration or a `reactor.size` key. Section 3 covers each. |

Raw pattern counts by line (VERIFIED, `grep -rnE` over `src/**/*.ts`):

| Pattern | Lines | Note |
|---|---|---|
| `reactor.get(` | 124 | SPEC-18 §10.1 says 125. |
| `.snapshot()` | 52 | 42 are reactor snapshots. 5 are journal snapshots, 1 is a throwaway reactor, 4 are comments. |
| `byTarget(` | 34 | |
| `negationsOf(` | 33 | SPEC-18 §10.1 counts 53 for both; this count includes aliased receivers. |
| `arrivalLog(` | 10 | |
| `reactor.size` | 5 | |
| `evalAnchored(` | 2 | |
| `.subset(` | 1 | |
| `reactor.ingest(` and `ingestBatch(` | 8 and 1 | |
| `deltasSince(` | 22 | 12 calls outside `src/store`, 4 calls inside `mirror.ts`, 6 definitions. |
| `reseat(` | 8 | 3 calls, 1 definition, 4 comments. |
| `WeakMap<Reactor` | 8 | One declaration spans two lines, so a one-line grep finds 7. |
| `reactor.eval(` | 0 | Empty. |

Sites left out of the classes, with the reason (VERIFIED by pattern):

| Group | Lines | Reason |
|---|---|---|
| Gateway door appends (`gw.append(`, `pool.append(`, `sink.append(`) | 65 | Already asynchronous. They call the door, not the reactor. They do not change. |
| `gw.store.holds(` | 8 | `Store` here is Loam's container tree (`src/gateway/store.ts:33`), not a `StoreBackend`. |
| `WeakMap` keyed on `Delta`, `Signer`, `Schema`, `Gateway`, `Ctx` | 11 | Not keyed on the reactor. Section 3 lists the two that still depend on it. |

### The `StoreBackend` interface

`src/store/backend.ts:32-92` (VERIFIED). Counts are call lines found by receiver name, so treat
them as INFERRED to within one or two.

| Method | Calls outside `src/store` | Calls inside `mirror.ts` | After the move |
|---|---|---|---|
| `append` | 4 (`gateway.ts:634,781`; `ingest.ts:514,1082`) | 5 | `PeerStore.append`. |
| `deltasSince` | 12 (`gateway.ts:723,1694`; `container.ts:957,990`; `erase.ts:798`; `repair.ts:84`; `cli.ts:1188,1304,2389,2440,2490,2540`) | 4 | Boot use dies. The rest become `Exporter` or `changes`. No caller passes a non-empty watermark except `erase.ts:798` and `mirror.ts:390`. |
| `purge` | 5 (`erase.ts:980,1286`; `container.ts:707,969`; `purge-settle.ts:29`) | 2 | `purge` with a `PurgeReport`. |
| `holds` | 11 (`erase.ts:988,1183`; `container.ts:704,709,977`; `custody.ts:22`; `gateway.ts:1576`; `ingest.ts:914`; `purge-settle.ts:34`; `cli.ts:5007,5311`) | 5 | No direct equivalent. Gap G5. |
| `heldAmong` | 3 (`custody.ts:20`; `container.ts:701,974`) | 2 | No direct equivalent. Gap G5. |
| `holdsAny` | 4 (`custody.ts:45`; `container.ts:617,1012`; `cli.ts:1184`) | 3 | No direct equivalent. Gap G5. |
| `ids` | 2 (`custody.ts:35`; `gateway.ts:733`) | 2 | `Exporter.ids()`. |
| `revision` | 5 (`gateway.ts:721,824,1697,1720`; `portable-door.ts:265` reads it as a property) | 0 | `Snapshot.revision`. |
| `close` | 6 (`gateway.ts:2557`; `erase.ts:779`; `channel.ts:1273`; `cli.ts:1316,2392,2556`) | 1 | `Store.close`. |

Side interfaces a driver may also implement (VERIFIED):

| Interface | Where | Methods | Calls outside `src/store` |
|---|---|---|---|
| `JournalBackend` | `src/store/peer-image.ts:11-25` | `journalStore`, `journalPeers`, `journalRowIds`, `holdsAnyRow`, `discardJournals`, `setAside`, `keepsJournals` | `journalStore` 5 (`gateway.ts:705,716,841`; `container.ts:739`; `cli.ts:1194`), `journalPeers` 3 (`cli.ts:1184`; `container.ts:617`; `gateway.ts:695`), `setAside` 1 (`gateway.ts:729`), `journalRowIds` 1 (`gateway.ts:733`), `holdsAnyRow` 1, `discardJournals` 1 |
| `RepairableBackend` | `src/store/quarantine.ts:115-140` | `quarantine`, `discardRow`, `restoreQuarantined` | `quarantine` 11, `discardRow` 2 |
| `HoldsPoolKeys` | `src/store/peer-image.ts:40-45` | `poolKeys` | 1 |

## 1. Every call site, by file

### `src/gateway/accounts.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 205-207 | `dataStrikeWitnesses` | scope | Anchors: the read's members (their negators) and `STORE_ENTITY` grants for the striker set. (2 sites) | VERIFIED |

### `src/gateway/adopt-law.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 473 | `containerOf` | indexed | One batch `get` of the version's member ids per attached pool. (1 sites) | VERIFIED |

### `src/gateway/adopt.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 145 | `readAdoptions` | **whole-set, serving** | Scans every delta for adoption records. Needs a context anchor (gap G1) or a fixed filing entity. (1 sites) | VERIFIED |
| 197-348 | `promoteImpl` | indexed | Point `get` of cited ids in source and destination. (4 sites) | INFERRED |

### `src/gateway/attention.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 115-116 | `latestByKey` | scope | Anchors: the entity ids the caller passes. (2 sites) | VERIFIED |

### `src/gateway/budget.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 181 | `countHeldBy` | **whole-set, serving** | Counts every held delta by author on the append door. Needs a per-author count (gap G3). (1 sites) | VERIFIED |
| 204 | `budgetRefusal` | indexed | Batch `get` of the batch ids. (1 sites) | VERIFIED |

### `src/gateway/container-census.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 102 | `containerCensusImpl` | **whole-set, serving** | Lists every id of each attached pool for the census page. Becomes a per-pool `get` of the scope's ids. (1 sites) | VERIFIED |
| 125 | `containerCensusImpl` | indexed | Batch `get` of scope member ids. (1 sites) | VERIFIED |

### `src/gateway/container-law.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 461 | `?` | cache | See section 3 (C2). (1 sites) | VERIFIED |
| 493 | `readContainerTable` | feed | Sweeps the arrival log from a high-water mark. Becomes `changes(from)`. (1 sites) | VERIFIED |
| 1139-1166 | `subjectFacts` | scope | Anchors: `STORE_ENTITY` grants and the negators of the struck id. (5 sites) | INFERRED |
| 1201-1202 | `survivingGrantIds` | scope | Anchor: `STORE_ENTITY`. (2 sites) | INFERRED |

### `src/gateway/container.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 123 | `memberRows` | **whole-set, serving** | A separate container's members are its whole pool. Serves every scoped query (hard site H2). (1 sites) | VERIFIED |
| 164,518 | `membersOf` | indexed | `get` of the published membership term (`membershipAt`). (2 sites) | VERIFIED |
| 617 | `poolGovernor` | purge | `holdsAny` asks "is this pool store empty" before a new pool key is recorded. See section 4 (E-probe). (1 sites) | VERIFIED |
| 701-709 | `openSeparate` | purge | Attach-time sweep of the erased set from a pool store. See section 4. (4 sites) | VERIFIED |
| 739 | `openSeparate` | dies | `journalStore()` opens the pool's journal. The journal becomes a store capability (§4.7.3). (1 sites) | VERIFIED |
| 922 | `openSeparate` | **whole-set, serving** | `Container.members()` returns the whole pool. Same site class as line 123. (1 sites) | VERIFIED |
| 957-958,990 | `discardBytes` | admin | Drop of a whole pool: enumerate every id. Becomes `Exporter.ids()`. (3 sites) | VERIFIED |
| 960-961,991 | `discardBytes` | purge | Drop of a whole pool: `quarantine()` lists the pen, `discardRow` removes each row, then `quarantine()` again as the pen's verdict. See section 4.3 item 3. (3 sites) | VERIFIED |
| 969-977,1012 | `discardBytes` | purge | Drop of a whole pool: purge, then byte verdict. See section 4. (4 sites) | VERIFIED |
| 1003,1011 | `discardBytes` | purge | `holdsAnyRow()` refuses the drop while any row remains. `discardJournals()` then deletes the journals. See section 4.3 item 4. (2 sites) | VERIFIED |
| 1177-1184 | `delegationStruckForGood` | scope | Anchors: the delegation delta's negators (two levels). (3 sites) | VERIFIED |
| 1477-1506 | `revokeConnectionImpl` | indexed | `get` of ids in the inbox pool to read their author. (3 sites) | INFERRED |

### `src/gateway/custody.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 20-45 | `probePhysicalRetention` | purge | Byte probes (`holds`, `heldAmong`, `ids`, `holdsAny`). See section 4. (4 sites) | VERIFIED |

### `src/gateway/erase-law.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 110 | `?` | cache | See section 3 (K2). A pin, not a cache. (1 sites) | VERIFIED |
| 178 | `eraseDefect` | indexed | `get` of the erasure target. (1 sites) | INFERRED |
| 253,256,260 | `erasedFromReading` | cache | `reactor.size` as a cache key. See section 3 (C1). (3 sites) | VERIFIED |
| 254-255 | `erasedFromReading` | indexed | Batch `get` of refused ids and their negation targets. (2 sites) | VERIFIED |
| 349-350 | `boundErasures` | scope | Anchor: `ERASE_ENTITY`. (2 sites) | VERIFIED |
| 377,392 | `erasuresIn` | local | Throwaway reactor over raw rows, before boot. Its caller is admin (`cli.ts:1304`). (2 sites) | VERIFIED |

### `src/gateway/erase.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 102 | `erasedInDeltas` | local | Throwaway reactor over a delta list the caller already holds. (1 sites) | VERIFIED |
| 358 | `readGrounds` | **whole-set, serving** | Health and receipt screens walk every delta per ground. Needs the erased ids only: scope at `ERASE_ENTITY` plus batch `get`. (1 sites) | VERIFIED |
| 599-600 | `receiptLedger` | scope | Anchor: `ERASE_ENTITY`. (2 sites) | VERIFIED |
| 679,697 | `liveOpening` | purge | `reactor.size !== 0` asks "does this pool hold anything". See section 4 (E-probe). (2 sites) | VERIFIED |
| 685 | `liveOpening` | indexed | `get` of the pool declaration. (1 sites) | VERIFIED |
| 726-728 | `liveOpening` | admin | Walks the pool's whole inventory and `get`s each id. Exporter on the erase door (hard site H5). (2 sites) | VERIFIED |
| 779 | `liveOpening` | write | `backend.close()` becomes `Store.close()`. (1 sites) | VERIFIED |
| 793 | `incarnationMembers` | **whole-set, serving** | Scans every delta for events of one opening. Anchor exists: the `channel:<name>` event entity. (1 sites) | VERIFIED |
| 798 | `incarnationMembers` | purge | Reads rows the journal dropped but the store still holds. Becomes the journal's owed purge list. (1 sites) | VERIFIED |
| 848 | `eraseImpl` | indexed | `get` of the erase target. (1 sites) | VERIFIED |
| 980-988,1183 | `eraseImpl` | purge | Purge and byte verdict. See section 4. (3 sites) | VERIFIED |
| 1007,1294 | `eraseImpl` | dies | `reseat()` after a purge. (2 sites) | VERIFIED |
| 1235 | `localOrderAuthorized` | indexed | `get` of the order in each parent. (1 sites) | VERIFIED |
| 1240-1241 | `localOrderAuthorized` | scope | Anchor: `ERASE_ENTITY` in the nearest parent. (2 sites) | VERIFIED |
| 1270 | `eraseReplicaImpl` | indexed | `get` of the target. (1 sites) | VERIFIED |
| 1286 | `eraseReplicaImpl` | purge | Replica purge. See section 4. (1 sites) | VERIFIED |

### `src/gateway/gateway.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 564 | `ingestVia` (field initializer) | write | `reactor.ingest` behind the door. Becomes `PeerStore.append`. (1 sites) | VERIFIED |
| 603 | `constructor` | local | Trial evaluation of the offered lens over an empty ground. Needs no store. (1 sites) | VERIFIED |
| 626 | `attachPersistence` | feed | Raw subscription: write-through and `publicOpen` invalidation. The write-through dies; the invalidation follows the feed. (1 sites) | VERIFIED |
| 634 | `attachPersistence` | write | Write-through `backend.append`. The store append is the write; this queue dies. (1 sites) | VERIFIED |
| 642 | `attachPersistence` | indexed | `get` of the emitted id after a conflict catch-up. (1 sites) | VERIFIED |
| 686-744 | `open` | dies | Boot replay: read every row, ingest every row, count rows outside the journal. (5 sites: lines 695, 723, 729, 733, 744; lines 705, 716 and 721 are counted in the side-interface and `revision` tables) | VERIFIED |
| 752,758 | `open` | admin | `quarantine()` at open: count unreadable rows, and refuse an unreadable operator marker. Becomes the integrity-fault report (gap G6). (2 sites) | VERIFIED |
| 781-799 | `open` | write | The incarnation marker at open. Becomes one `append`. (3 sites) | VERIFIED |
| 824 | `durableCurrent` | feed | `durableCurrent`: compares the SQLite `data_version` to notice another writer. Becomes a revision compare. (1 sites) | VERIFIED |
| 841 | `boot` | dies | `journalStore()` opens the host's journal. The journal becomes a store capability (§4.7.3). (1 sites) | VERIFIED |
| 1576 | `probe` | purge | `probe({holds})`. See section 4. (1 sites) | VERIFIED |
| 1691-1738 | `reseatGround` | dies | `reseatGround`: rebuild the reactor from the store. (8 sites) | VERIFIED |
| 1887,1920,2051 | `advanceToNow` | view | `advanceTime` and `refreshAll` refresh memory views. (3 sites) | VERIFIED |
| 1901,2411 | `armValidityTimer` | view | `nextValidityBoundary` over the whole set. Becomes a boundary per view or per fetched scope (gap G8). (2 sites) | VERIFIED |
| 1958-1970 | `walkDown` | scope | Anchors: the delta, its negators and its negation targets. (3 sites) | VERIFIED |
| 2557 | `close` | write | `backend.close()`. (1 sites) | VERIFIED |

### `src/gateway/governed-trust.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 173 | `grantGround` | scope | Anchor: `STORE_ENTITY`. Already S(E) through `scopeIds` and `subset`. (1 sites) | VERIFIED |
| 182 | `?` | cache | See section 3 (K3). A registry, not a cache. (1 sites) | VERIFIED |

### `src/gateway/grants-law.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 45-92 | `honoredStrikeOn` | scope | Anchors: the grant id's negators. (3 sites) | INFERRED |
| 115-116 | `grantSubjects` | scope | Anchor: `STORE_ENTITY`. (2 sites) | INFERRED |
| 140-142 | `survivingAt` | scope | Anchor: the tenant entity the caller passes. (2 sites) | INFERRED |

### `src/gateway/ingest.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 148-262 | `persistChannelEvent` | indexed | `get` of one id to confirm an admitted delta is held. (3 sites) | INFERRED |
| 352 | `catchUp` | feed | Compares every held id with the journal to notice a removal by another writer. Becomes `changes().removed`. (1 sites) | VERIFIED |
| 354 | `catchUp` | dies | `reseat()` on a noticed removal. (1 sites) | VERIFIED |
| 358 | `catchUp` | feed | Finds rows another writer admitted. Becomes `changes().added`. (1 sites) | VERIFIED |
| 448 | `preflightAppend` | indexed | `get` in an attached pool. (1 sites) | INFERRED |
| 496 | `ingestTogether` | indexed | Batch `get` for duplicate detection. (1 sites) | VERIFIED |
| 501-514 | `ingestTogether` | write | `ingestBatch`, `ingest`, `backend.append`. Become one `append`. (3 sites) | VERIFIED |
| 610 | `deadSet` | **whole-set, serving** | Scans every delta to find any erasure. Easy: `targets([ERASE_ENTITY])` is non-empty. (1 sites) | VERIFIED |
| 643-644 | `withoutErased` | scope | Anchors: the served ids (their negators). (2 sites) | VERIFIED |
| 676-678 | `offeredDeltasImpl` | **whole-set, serving** | The federation offer: everything, or an offered lens over everything (hard site H1). (2 sites) | VERIFIED |
| 718 | `selectImpl` | **whole-set, serving** | `select`: any membership Term over the whole ground. Sync and public (hard site H1). (1 sites) | VERIFIED |
| 738,781 | `watchImpl` | **whole-set, serving** | `watch`: the same Term again on every pulse (hard site H1). (2 sites) | VERIFIED |
| 789 | `watchImpl` | feed | Raw subscription for the watch pulse. (1 sites) | VERIFIED |
| 914 | `ordersFor` | purge | `holds(targetId)` for an arriving order. See section 4. (1 sites) | INFERRED |
| 1082 | `federateAdmitted` | write | `backend.append` on the federation door. (1 sites) | VERIFIED |
| 1096 | `federateAdmitted` | indexed | `get` to compare a duplicate. (1 sites) | INFERRED |

### `src/gateway/lawful.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 17-28 | `lawfulSnapshot` | **whole-set, serving** | `lawfulSnapshot` and `lawfulHistory`: filter the whole set by author. 22 callers (hard site H3). (3 sites) | VERIFIED |
| 83-90 | `lawfulHistoryAt` | scope | Anchor: the `LawAt` entity. (2 sites) | VERIFIED |

### `src/gateway/lifecycle.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 279-1045 | `matForImpl` | view | `reactor.register`: a maintained view. (4 sites) | INFERRED |
| 783 | `originOf` | indexed | `get` to name a binding's origin. (1 sites) | VERIFIED |

### `src/gateway/listing.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 290 | `isPlainClaim` | indexed | `negators` of one arriving delta. (1 sites) | VERIFIED |
| 444 | `currentIndex` | feed | Advances the listing index from the arrival log. Becomes `changes(from)`. (1 sites) | VERIFIED |
| 463 | `currentIndex` | cache | See section 3 (C5). (1 sites) | VERIFIED |

### `src/gateway/mutate.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 182 | `retract` | indexed | `get` in a pool before a retraction. (1 sites) | INFERRED |

### `src/gateway/negation-closure.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 47-79 | `withNegationClosure` | scope | Anchors: the given ids. This is the negator closure `scope` returns. (4 sites) | VERIFIED |

### `src/gateway/negation.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 14-32 | `negatedAt` | scope | Anchors: the ids asked. Effective negation over their negator chains. (2 sites) | VERIFIED |
| 48 | `isLawful` | indexed | `get` of one id. (1 sites) | VERIFIED |

### `src/gateway/peer-admission.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 61 | `openHostPeer` | dies | Lists every arrival to replay rows in arrival order. (1 sites) | VERIFIED |
| 208 | `reportPurged` | purge | Reads owed purge obligations from the journal. See section 4. (1 sites) | VERIFIED |

### `src/gateway/pool-keys.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 65-66 | `recordedPoolKey` | scope | Anchor: `POOL_KEYS_ENTITY`. (2 sites) | INFERRED |

### `src/gateway/portable-door.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 83-84 | `retired` | scope | Anchors: negators of a law id. (2 sites) | INFERRED |
| 116-117 | `lawAt` | scope | Anchor: the law entity. (2 sites) | INFERRED |
| 265 | `classifyPortableRead` | feed | `gw.backend.revision === undefined` asks whether the store can report other writers' commits. Every snapshot has a revision after the move, so the check dies. (1 sites) | VERIFIED |
| 281 | `classifyPortableRead` | scope | Anchors: the root entity and every expanded child. Already `evalAnchored`. (1 sites) | VERIFIED |
| 289 | `classifyPortableRead` | indexed | Batch `get` of scope members. The scope result already carries the bytes. (1 sites) | VERIFIED |

### `src/gateway/principal.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 110 | `keyActsFor` | indexed | `targets([root])` is non-empty. (1 sites) | INFERRED |
| 190 | `bindingHeld` | indexed | `get` of one id. (1 sites) | INFERRED |
| 199 | `?` | cache | See section 3 (K4). A registry, not a cache. (1 sites) | VERIFIED |
| 270-314 | `delegationStatesFor` | scope | Anchor: the delegating root entity. (3 sites) | INFERRED |
| 350 | `delegationRootsTo` | **whole-set, serving** | Walks the arrival log for delegations naming one key. Becomes a value lookup on role `key` (slice 6). (1 sites) | VERIFIED |
| 372-373 | `delegationRecordsFor` | scope | Anchor: the root entity. (2 sites) | INFERRED |

### `src/gateway/purge-settle.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 18-34 | `settleOwedPurges` | purge | Pays owed purges. See section 4. (3 sites) | VERIFIED |

### `src/gateway/read-contribution.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 32 | `readContributionImpl` | **whole-set, serving** | Copies the whole ground for every serving scope (hard site H2). (1 sites) | VERIFIED |
| 35 | `readContributionImpl` | indexed | Batch `get` of read-closed ids. (1 sites) | VERIFIED |

### `src/gateway/reads.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 161 | `evalPrimary` | scope | Anchors: the root entity and every expanded child. Already `evalAnchored`. (1 sites) | VERIFIED |
| 163 | `evalPrimary` | **whole-set, serving** | Fallback for a program the anchor check cannot scope. Becomes a flagged full-surface read. (1 sites) | VERIFIED |
| 279-280,799,841 | `gatherImpl` | view | Reads and subscribes to a maintained view. (4 sites) | VERIFIED |
| 478-479 | `negatedInGround` | scope | Anchors: negators of one id. (2 sites) | VERIFIED |
| 528 | `gatherForRetractionImpl` | **whole-set, serving** | A retraction gather evaluates over a whole pool. Becomes a scope read in the pool at the same root. (1 sites) | VERIFIED |
| 576 | `gatherPoolForRetraction` | **whole-set, serving** | The same gather over one inbox pool's own ground. Becomes a scope read in the pool at the same root. (1 sites) | VERIFIED |

### `src/gateway/receive-policy.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 110-139 | `reactor` | local | Throwaway reactors over delta lists the caller passes. (2 sites) | VERIFIED |

### `src/gateway/receive-snapshot.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 44 | `fromMembers` | local | Throwaway reactor over members the caller passes. (1 sites) | VERIFIED |

### `src/gateway/recovery-cut.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 133-134 | `held` | scope | Anchor: `RECOVERIES`. (2 sites) | VERIFIED |
| 142 | `?` | cache | See section 3 (C3). (1 sites) | VERIFIED |
| 144 | `arrivalIndex` | indexed | Arrival position of one id. Needs the arrival record of a held id (gap G4). (1 sites) | VERIFIED |
| 231-251 | `cutState` | indexed | `get` of a recovery record. (2 sites) | INFERRED |
| 256-258 | `manifested` | scope | Anchor: `RECOVERIES`. (2 sites) | INFERRED |
| 336 | `historyBefore` | **whole-set, serving** | Walks the arrival log up to a cut and filters by author. Needs an arrival-range read by author (gap G4). (1 sites) | VERIFIED |
| 380-490 | `cutErasureDefect` | indexed | `get` presence checks on batch ids. (6 sites) | INFERRED |

### `src/gateway/registration.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 885-890 | `survivingCandidates` | scope | Anchors: negators of each candidate, transitively. (3 sites) | VERIFIED |

### `src/gateway/renderers.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 425,794 | `readPoolRenderers` | indexed | `get` presence check in the host. (2 sites) | INFERRED |
| 457 | `readForeignRenderers` | **whole-set, serving** | Scans every delta for foreign renderer bindings. Needs a context anchor (gap G1). (1 sites) | VERIFIED |

### `src/gateway/repair.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 84 | `reAdmit` | admin | Repair re-reads every row. (1 sites) | VERIFIED |
| 85 | `reAdmit` | admin | `quarantine()` asks whether the key is still in the pen. Becomes the integrity-fault report (gap G6). (1 sites) | VERIFIED |

### `src/gateway/slate-law.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 215-331 | `slateStateDefect` | indexed | `get` of a member or a published term. (2 sites) | INFERRED |
| 417 | `evalMembership` | **whole-set, serving** | A slate freezes its membership Term over the whole ground. Same site class as `select` (H1). (1 sites) | VERIFIED |
| 712-866 | `condemnedClosure` | indexed | `get` of ids while following `negates` pointers. (3 sites) | VERIFIED |

### `src/gateway/slate.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 271-276 | `resurfacingOf` | indexed | `get` of members and their negation targets. (2 sites) | VERIFIED |
| 356 | `duplicatesFor` | **whole-set, serving** | Finds every delta that references a slate member by any pointer. Needs a reference index (gap G2). (1 sites) | VERIFIED |
| 402 | `readGround` | **whole-set, serving** | `readGround`: the whole set less read-closed ids. Its callers are anchored reads; pass the closed ids as `excludeIds`. (1 sites) | VERIFIED |
| 805-1075 | `readTermAt` | indexed | `get` of records and members. (3 sites) | INFERRED |
| 983 | `operatorStrikes` | scope | Anchors: the ids asked (operator strikes). (1 sites) | INFERRED |

### `src/gateway/tiers.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 69 | `danglingCitations` | **whole-set, serving** | Erase manifest: every delta that cites the target, per tier. Needs a reference index (gap G2). (1 sites) | VERIFIED |

### `src/gateway/user-root.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 184-186 | `heldAt` | scope | Anchor: `userEntity(name)`. (2 sites) | INFERRED |
| 339 | `heldRecord` | indexed | `get` of one record. (1 sites) | INFERRED |
| 376-436 | `retiredKeysOf` | scope | Anchor: `RECOVERIES`. (6 sites) | INFERRED |
| 463-541 | `standingRootClaim` | scope | Anchor: the user entity. (6 sites) | INFERRED |
| 621 | `?` | cache | See section 3 (K1). A registry, not a cache. (1 sites) | VERIFIED |
| 665-683 | `struck` | scope | Anchor: `userEntity(name)` and negators. (4 sites) | VERIFIED |
| 745-809 | `subjectCouldName` | scope | Anchor: `userEntity(subject)` and two levels of negators. (10 sites) | VERIFIED |

### `src/federation/channel.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 641,695 | `bindArrived` | **whole-set, serving** | `bindArrived` reads and freezes a whole pool on every sync (hard site H4). (2 sites) | VERIFIED |
| 1075 | `blessChannelAppImpl` | indexed | `get` presence check. (1 sites) | INFERRED |
| 1092-1185 | `blessChannelAppImpl` | **whole-set, serving** | Blessing reads and freezes a whole pool (hard site H4). (3 sites) | VERIFIED |
| 1273 | `?` | write | `backend.close()`. (1 sites) | INFERRED |
| 1500,1570 | `syncChannelCommit` | indexed | Batch `get` of offered ids in the pool. (2 sites) | INFERRED |
| 2196 | `dropChannelCommit` | purge | `reactor.size !== 0` asks "does this pool hold anything". See section 4 (E-probe). (1 sites) | VERIFIED |
| 2309-2316 | `severedForGood` | scope | Anchors: negators of one id (two levels). (3 sites) | INFERRED |
| 2570,2661 | `curseChannelLawImpl` | **whole-set, serving** | Scans a ground for registration bindings of one lens. Needs a context anchor (gap G1). (2 sites) | VERIFIED |
| 2578 | `curseChannelLawImpl` | indexed | `negators` of one binding. (1 sites) | VERIFIED |

### `src/federation/local-channel-events.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 32 | `verifiesAgainstHeld` | indexed | `get` of one id. (1 sites) | VERIFIED |
| 77 | `?` | cache | See section 3 (C4). (1 sites) | VERIFIED |
| 87 | `protectedIngressIds` | feed | Sweeps the arrival log from a high-water mark on every append. Becomes `changes(from)`. (1 sites) | VERIFIED |
| 249-295,374 | `localChannelsInContainer` | **whole-set, serving** | Scans every delta for local channel events. Anchor exists: the event entity `channel:<name>` or the parent container. (4 sites) | VERIFIED |
| 254,267,324-325,468 | `localChannelsInContainer` | indexed | `get` of a declaration or status id. (5 sites) | VERIFIED |

### `src/federation/renderer-selection.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 203-204 | `selectRendererForActivation` | scope | Anchors: negators of one binding in the pool. (2 sites) | INFERRED |

### `src/federation/translate.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 297,383 | `translate` | **whole-set, serving** | The translation pass walks every delta. A batch job: follow the feed from the last revision. (2 sites) | VERIFIED |

### `src/server/admin-federation.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 57 | `membershipTermOf` | indexed | `get` of the published membership term. (1 sites) | VERIFIED |
| 139-183 | `unnegatedOperatorGrantIds` | scope | Anchor: `STORE_ENTITY`. (4 sites) | INFERRED |

### `src/server/admin-pages.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 551 | `memberHtml` | indexed | `get` presence check. (1 sites) | INFERRED |

### `src/server/admin.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 1200-1225 | `postPromote` | indexed | `get` presence checks. (2 sites) | INFERRED |

### `src/server/http.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 2481 | `handleMcp` | indexed | `get` presence check. (1 sites) | VERIFIED |

### `src/server/users.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 241-250 | `check` | scope | Anchor: `userEntity(name)`. Line 250 takes the whole set only as the operand of an anchored term. (4 sites) | VERIFIED |
| 340-385 | `keyEvidenceHeld` | scope | Anchor: the user entity. (4 sites) | INFERRED |
| 401 | `nameStillHeld` | **whole-set, serving** | Walks the arrival log for grants and memberships naming a user. Becomes value lookups (slice 6). (1 sites) | VERIFIED |
| 421 | `nameStillHeld` | indexed | `get` of a published term. (1 sites) | VERIFIED |

### `src/cli/cli.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 1184-1195 | `restoreIntoJournal` | admin | Restore from the archive into a new journal. (3 sites) | VERIFIED |
| 1304 | `cmdServe` | admin | Reads both tiers whole before boot to find erased ids for `heal`. (1 sites) | VERIFIED |
| 1316 | `cmdServe` | write | `mirror.close()`. (1 sites) | VERIFIED |
| 1406 | `cmdServe` | admin | `quarantine()` counts set-aside rows for a startup warning (gap G6). (1 sites) | VERIFIED |
| 2389,2440-2540 | `cmdStore`, `cmdRepair` | admin | `loam store` and `loam repair` read every row to fill the quarantine pen (gap G6). (4 sites) | VERIFIED |
| 2390,2441,2491,2541 | `cmdStore`, `cmdRepair` | admin | `quarantine()` reads the pen after the full read fills it (gap G6). (4 sites) | VERIFIED |
| 2499 | `cmdRepair` | purge | `discardRow(key)` removes one penned row's bytes. See section 4.3 item 3. (1 sites) | VERIFIED |
| 2392,2556 | `cmdStore` | write | `backend.close()`. (2 sites) | VERIFIED |
| 2985-2998 | `claimIdsBySurvival` | scope | Anchor: the entity the command names. (3 sites) | INFERRED |
| 3088 | `penRecordsFor` | indexed | `get` of one pen record. (1 sites) | VERIFIED |
| 3838-3873 | `groundGrants` | scope | Anchor: `STORE_ENTITY`. (3 sites) | INFERRED |
| 4639 | `setAsideWarning` | admin | `quarantine()` on the host and each quarantine pool, for the set-aside warning (gap G6). (1 sites) | VERIFIED |
| 4486 | `cmdClientRevoke` | **whole-set, serving** | `client revoke` scans every delta for a `subject` value. Becomes a value lookup (slice 6); a CLI command, not a door. (1 sites) | VERIFIED |
| 5007,5311 | `heldWhere` | purge | Byte probes for the erase command. See section 4. (2 sites) | VERIFIED |
| 5275 | `cmdErase` | indexed | `get` of the erase target. (1 sites) | VERIFIED |

### `src/cli/user-recover.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 196-205 | `struckForGood` | scope | Anchors: negators of one id (two levels). (3 sites) | INFERRED |
| 215 | `standingOf` | **whole-set, serving** | Walks the arrival log for grants naming a key. Becomes a value lookup on role `subject` (slice 6). (1 sites) | VERIFIED |
| 234-235 | `otherRootClaims` | scope | Anchor: the user entity. (2 sites) | INFERRED |
| 326-661 | `settleCuts` | indexed | `get` presence checks. (4 sites) | INFERRED |
| 665 | `resume` | indexed | Asks the journal whether an id ever arrived, erased or not (gap G4). (1 sites) | VERIFIED |

### `src/runner/runner.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 139 | `readBindingDefinitions` | **whole-set, serving** | Runner attach scans every delta for binding definitions. Needs a context anchor (gap G1). (1 sites) | VERIFIED |
| 271 | `Runner.attach` | write | `new DerivationHost(gateway.reactor)`: the gateway's ingest then routes through the host. Becomes `PeerStore.append` plus the drain. (1 sites) | VERIFIED |
| 271 | `Runner.attach` | view | The same host drains derivations into maintained views. A memory cache until slice 6. (1 sites) | VERIFIED |

### `src/store/mirror.ts`

| Lines | Function | Class | After the move | Status |
|---|---|---|---|---|
| 109,272,365,390,527 | `journalRowIds` | admin | Tier inventory and heal read whole tiers. (5 sites) | INFERRED |
| 142,205-207,389,428 | `shadow` | write | Appends to both tiers. (5 sites) | INFERRED |
| 171-186,227-253,289-334,382,447-457 | `journalStore` | purge | Purge and byte probes on both tiers. See section 4. (10 sites) | INFERRED |
| 217 | `deltasSince` | dies | Passes the boot read to the primary. (1 sites) | INFERRED |

Sites the pattern search missed, found by reading (VERIFIED): `user-root.ts:746,761,793,803` call
`ground.get(` where `ground` is a `Reactor`. They are inside the `745-809` row above.

A second reading pass added sites that call side interfaces or read a backend field (VERIFIED):
`gateway.ts:752,758,841`; `container.ts:739,960,961,991,1003,1011`; `repair.ts:85`;
`portable-door.ts:265`; `cli.ts:1406,2390,2441,2491,2499,2541,4639`; `runner.ts:271`. Each has its
own row above, and the counts in section 2.1 include them.

## 2. Summary

### 2.1 Counts per class per directory

| Directory | scope | indexed | feed | admin | whole | dies | write | purge | view | local | cache | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `src/gateway` | 92 | 56 | 8 | 9 | 27 | 19 | 11 | 31 | 13 | 7 | 10 | 283 |
| `src/federation` | 5 | 10 | 1 | 0 | 13 | 0 | 1 | 1 | 0 | 0 | 1 | 32 |
| `src/server` | 12 | 6 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 19 |
| `src/cli` | 11 | 7 | 0 | 14 | 2 | 0 | 3 | 3 | 0 | 0 | 0 | 40 |
| `src/runner` | 0 | 0 | 0 | 0 | 1 | 0 | 1 | 0 | 1 | 0 | 0 | 3 |
| `src/store` | 0 | 0 | 0 | 5 | 0 | 1 | 5 | 10 | 0 | 0 | 0 | 21 |
| **Total** | 120 | 79 | 9 | 28 | 44 | 20 | 21 | 45 | 14 | 7 | 11 | 398 |

Empty classes: none. `src/surface`, `src/client`, `src/browser` and `src/stock` hold no site.

### 2.2 The whole-set serving sites, ranked

| # | Site | What it does | What removes it |
|---|---|---|---|
| H1 | `ingest.ts:676-678,718,738,781`; `slate-law.ts:417` | `offeredDeltas`, `select`, `watch` and the slate freeze evaluate any membership Term over the whole ground. `watch` repeats it on every pulse. | Anchor analysis on the membership Term. A Term that stays unanchored needs a derived index (slice 6). Until then it is a flagged full-surface read. |
| H2 | `container.ts:123,922`; `read-contribution.ts:32` | A separate container's members are its whole pool. Every scoped query copies each pool whole. | Push the query's anchors into each pool: one `scope` call per pool. Needs a read that spans peers (gap G7). |
| H3 | `lawful.ts:17,27-28` | `lawfulSnapshot` and `lawfulHistory` filter the whole set by author. 22 callers read registrations, the container table, renderers, translations, channels and adoptions from it. | Law is filed under a fixed context at many entities, so no entity anchor exists. Gap G1. |
| H4 | `channel.ts:641,695,1092,1107,1185` | A sync and a blessing read a whole pool and freeze it into a version address. | A pool-level digest that equals the version address, or a member list kept by the feed. Gap G3. |
| H5 | `tiers.ts:69`; `slate.ts:356`; `erase.ts:726-728` | The erase door lists every delta that cites the target, on every tier. It also walks a pool's inventory. | A reference index. Gap G2. The inventory walk becomes an `Exporter` use on a serving door, which SPEC-18 §3 rule 3 forbids. |
| H6 | `budget.ts:181` | The append door counts every held delta by author. | A count per author kept at append. Gap G3. |
| H7 | `reads.ts:163` | The fallback for a program the anchor check cannot scope. | A flagged full-surface read (§6.6). Already named as a gap in the code. |
| H8 | `principal.ts:350`; `users.ts:401`; `user-recover.ts:215`; `cli.ts:4486` | Each walks the log for a value in one role (`key`, `subject`). | Value lookups (§4.7.1). They wait for slice 6. All four are rare operator acts. |
| H9 | `local-channel-events.ts:249,276,295,374`; `erase.ts:793`; `ingest.ts:610`; `erase.ts:358` | Scans for local channel events or for erasures. | An entity anchor exists today (`channel:<name>`, `ERASE_ENTITY`). These can land now, behind the reactor. |

The 22 callers of the two `lawful.ts` helpers (VERIFIED by grep): `registration.ts:861,1162,1272,1336`;
`container-law.ts:533`; `container.ts:1643`; `renderers.ts:312,326,424`; `adopt-law.ts:637,638,878`;
`lifecycle.ts:1070`; `slate.ts:852,974`; `slate-law.ts:806`; `receive-snapshot.ts:51`;
`channel.ts:517,518,2320,2744`; `translate.ts:168`.

### 2.3 Synchronous functions that must become asynchronous

The store boundary is asynchronous. The plan keeps evaluation synchronous, as SPEC-18 §3 rule 4
says. So the async boundary moves to the door, and the law readers keep their shape:

- Most law readers take a `reactor: Reactor` parameter and call only `get`, `byTarget`,
  `negationsOf` and `negationPredicate` (VERIFIED for the files in section 1).
- A door fetches the law scope once, builds a synchronous delta source over it, and passes that in.
- So the readers do not become async. Their callers at the door do.

Functions that are synchronous today and reach the reactor (sync status VERIFIED at
`gateway.ts`; the caller chains are INFERRED from grep counts):

| Sync function today | Reads | Public door it reaches | Door async already? |
|---|---|---|---|
| `evalPrimary` `reads.ts:142` → `gatherImpl` `reads.ts:180` → `resolvedNodeImpl` | entity scope | `Gateway.query`, `queryPublic` through the GraphQL hooks (`gateway.ts:874-899`) | Yes. `prepareRead` is awaited first (`gateway.ts:2482`). |
| same chain | entity scope | `Gateway.gather` `gateway.ts:2179`, `Gateway.resolvedNode` `gateway.ts:2194` | No. Both are sync and public. 15 test files call `resolvedNode`. |
| `gatherForRetractionImpl` `reads.ts:503`, `gatherPoolForRetraction` `reads.ts:559` | pool ground | `Gateway.mutateEntity` and the other write verbs | Mixed. `clearEntity`, `removeEntity`, `severEntity`, `linkRefEntity`, `unlinkRefEntity` are sync (`gateway.ts:2233-2293`). |
| `resolveCaptured` `reads.ts:786` | view or read ground | `Gateway.subscribe` | Yes. The per-change callback is sync and must fetch. |
| `selectImpl` `ingest.ts:716` | whole ground | `Gateway.select` `gateway.ts:1788`, `freeze` `gateway.ts:1803` | No. 13 and 15 test files. |
| `watchImpl` `ingest.ts:732` | whole ground per pulse | `Gateway.watch` `gateway.ts:1794` | Returns an async generator. The first evaluation is sync. |
| `offeredDeltasImpl` `ingest.ts:672` | whole ground | `Gateway.offeredDeltas` `gateway.ts:1782`; the `/federate` offer; pool reseed | No. 17 test files. |
| `containerScopeImpl` `container.ts:107`, `connectionScopeImpl`, `readContributionImpl` `read-contribution.ts:19` | host and pools | `Gateway.containerScope` `1415`, `servingScope` `1420`, `connectionScope` `1482`, `readContribution` `1445`; `Gateway.list` | `list` is async. The four scope methods are sync. 29 test files call `containerScope`. |
| `readContainerTable` `container-law.ts:474` | arrival log, lawful snapshot | `Gateway.containers` `gateway.ts:1276`; 36 internal callers | No. |
| `readRegistrations` `registration.ts:1155`, `replayRegistrationsImpl` `lifecycle.ts:874` | lawful snapshot | `Gateway.replayRegistrations` `970`, `surface` `906`, `registrationVersions` `931`, `contestedNames` `938`, `withdrawnRegistrations` `944`, `def` `2120`, `boundSurface` `2135` | No. `prepareRead` already calls `replayRegistrations` inside an async door (`gateway.ts:1439`). |
| `openNames` `gateway.ts:2400` | public law | `hasPublicSurface`, `isPublicLatest`, `isPublicPin`, `surface("public")` | No. The HTTP server calls them per request. |
| `authorize` `accounts.ts:515`, `preflightAppend` `ingest.ts:381`, `budgetRefusal` `budget.ts:192` | grants, erasures, slates, budget | `Gateway.append`, `federate` | Yes. |
| `readSlates` `slate-law.ts:471`, `slateReportsImpl` `slate.ts:238`, `readGraveyards` `slate-law.ts:797` | `SLATE` entity, container table | `Gateway.slates` `1177`, `graveyards` `1182` | No. `cut` and `receipt` are async. |
| `readAdoptions` `adopt.ts:116`, `readLawAdoptions` `adopt-law.ts:626` | whole ground | `Gateway.adoptions` `1511`, `lawAdoptions` `1638`, `lawFrom` `1631` | No. |
| `readRenderers` `renderers.ts:305`, `readChannels` `channel.ts:492` | lawful snapshot | `Gateway.renderers` `1052`, `channelStatus` `1361`, `channelsEver` `1357`, `channelApps` `1366`, `withheldOn` `1391`, `artifactRoutes` `1069` | No. `serveRoute` and `prepareRoute` are async. |
| `resolveUserView` `users.ts:222`, `nameStillHeld` `users.ts:368` | user entity | HTTP login and session handlers | Yes (INFERRED: the handlers are async functions). |
| `userRootsRaw` `user-root.ts:645`, `subjectCouldName` `user-root.ts:733`, `grantHeld` `grants-law.ts:168` | user entities, inside governed lowering | every governed read and write | The door is async. The read happens inside evaluation, so the user entities must be anchors of a second round. |
| `readBindingDefinitions` `runner.ts:124` | whole ground | `Runner.attach` | INFERRED sync. |
| `erasedFromReading` `erase-law.ts:248`, `readClosedIds` `slate-law.ts:748` | `ERASE_ENTITY`, `SLATE` | every read door | Called inside sync reads. Fetch once per request. |

How far it propagates:

- Internal: the async-ness stops at the door when the door passes a fetched ground down.
- Public and breaking: about 30 sync `Gateway` methods become async. The largest test impact is
  `containerScope` (29 files), `containers` (29), `channelStatus` (28), `def` (19),
  `offeredDeltas` (17), `registrationVersions` (16), `freeze` (15), `resolvedNode` (15),
  `select` (13).
- The seam already exists: `Gateway.prepareRead` (`gateway.ts:1431`) runs before every GraphQL
  door. It is the place to take one snapshot and fetch the law scope.

## 3. Caches

"Reseat" below means `Gateway.reseatGround` (`gateway.ts:1687-1754`), which replaces the reactor
object after a purge or a noticed removal. All rows are VERIFIED unless marked.

### 3.1 Caches that rely on the reactor object, its size or its log

| # | Cache | Key today | What invalidates it today | Key after the move |
|---|---|---|---|---|
| C1 | `readingCache` `erase-law.ts:260`, read at `erase-law.ts:253` | reactor object, `reactor.size`, operator | A size change, a reseat (new object), new governor pins (`erase-law.ts:115`) | Peer revision and operator. Better: follow the feed and recompute only when a change touches `ERASE_ENTITY`. |
| C2 | `tableMemo` `container-law.ts:461` | reactor object, operator, a count of container-law deltas in the log, a validity interval | Sweeping `arrivalLog()` from a high-water mark; a reseat; a validity boundary | Revision of the last `changes` page read. Recompute when a change adds or removes container law. Keep the validity interval. |
| C3 | `positions` `recovery-cut.ts:142` | reactor object, log length | Log growth; a reseat | Dies. The store keeps the arrival sequence (`holding.seq`). Needs a read for it (gap G4). |
| C4 | `protectedMemo` `local-channel-events.ts:77` | reactor object, log high-water mark | Log growth; a reseat | Feed cursor (a revision). A `removed` id must leave `roots` and `dependents`, which the memo cannot do today. |
| C5 | `indexes` `listing.ts:259`, entry check at `listing.ts:463` | `Gateway`, container name, `WeakRef` to the reactor, `usersEpoch`, membership JSON, log high-water mark | Reactor identity change; a non-plain arrival; a user epoch change | Feed cursor, `usersEpoch`, membership JSON. A `removed` id forces a rebuild. |
| C6 | `publicOpen` `gateway.ts:2383` | none (one slot), with a validity interval | Any raw-stream delta (`gateway.ts:629`); a reseat (`gateway.ts:1712`); a validity boundary | Revision plus the validity interval. Or follow the feed for changes at the public entity. |
| C7 | `resolverMemo` `gateway.ts:467` | resolver address, root, the delta ids read (`resolvers.ts:253`) | Cleared on reseat (`gateway.ts:1715`) | Same key. It is content-keyed, so a revision is not needed. Clear the entries that name a `removed` id. |
| C8 | `sinks`, `lazyMats`, `publicLazyMats` `gateway.ts:501-508` | materialization name | Cleared on reseat (`gateway.ts:1709-1711`) | Memory views keyed by revision (SPEC-18 §10). Dropped when a change removes a member. |
| C9 | `channels` `gateway.ts:515` (open streams) | the stream object | Every stream is ended on reseat (`gateway.ts:1708`) | End or refresh a stream when a `removed` id is in its scope. No reseat exists to do it. |
| C10 | `durableRevision` `gateway.ts:535` | SQLite `data_version` sampled at open and at reseat | Compared on each attested read (`gateway.ts:823`) | The snapshot's revision. The comparison becomes the freshness check of §4.6. |
| C11 | `boundCache` `gateway.ts:478` | container name and a fold key | Rebuilt when the fold key moves (`gateway.ts:2141-2145`, INFERRED) | Unchanged if the fold key derives from law content. Check when the registrations become a scope read. |
| C12 | `retiredMemo` `grants-law.ts:157` | a `Ctx` object made per question | The `Ctx` is dropped after the question | Unchanged. It lives for one request. |
| C13 | The reactor's own negation memo behind `negationPredicate` | inside rhizomatic | Cleared on an accepted ingest (rhizomatic `reactor.d.ts`) | Slice 2 owns it. Loam holds closures from it across calls in one read only. |

### 3.2 Registries keyed on the reactor object (not caches)

Each one attaches configuration to a reactor. The gateway declares it again after every reseat
(`gateway.ts:1735-1737`). After the move the reactor object is stable, so each becomes a plain
field on the gateway or the peer.

| # | Registry | Where | Declared again at |
|---|---|---|---|
| K1 | `userGrounds` | `user-root.ts:621` | `gateway.ts:2060` (`declareUsers`) |
| K2 | `erasureGovernors` | `erase-law.ts:110` | `gateway.ts:551`, `gateway.ts:1735` |
| K3 | `readHidden` | `governed-trust.ts:182` | `gateway.ts:2059` |
| K4 | `declaredScopes` | `principal.ts:199` | `gateway.ts:1736` |

SPEC-18 §10.1 counts 7 caches keyed on the reactor object. This inventory finds 8
`WeakMap<Reactor` declarations: C1 to C4 and K1 to K4. C5 holds a `WeakRef` to it.

### 3.3 What "erasure replaces the reactor" hides today

These effects happen only because a reseat builds everything again. Each needs an explicit
trigger from a `removed` change record:

- Open streams end (`gateway.ts:1708`).
- Every materialization is rebuilt without the removed delta (`gateway.ts:1741`).
- The registered law is derived again, so law whose bytes were removed stops serving
  (`gateway.ts:1751`).
- The resolver memo is cleared (`gateway.ts:1715`).
- Author clocks and the validity timer are armed again (`gateway.ts:1742,1752`).
- User dependents are told (`gateway.ts:1753`).
- A runner's host is detached and the caller attaches it again (`gateway.ts:1665-1668`).

## 4. Erasure

### 4.1 What `erase` does today, in order

`eraseImpl`, `src/gateway/erase.ts:802-1067` (VERIFIED).

| Step | Lines | What happens | Store calls |
|---|---|---|---|
| 1 | 819-822 | Refuse unless this store has an operator. | none |
| 2 | 830-838 | Refuse if a declared separate container is neither attached nor detached on the record. | none (container table) |
| 3 | 845-848 | Find a standing erasure of this id. Read the target. | scope at `ERASE_ENTITY`; `get` |
| 4 | 854-877 | Refuse: target not held and nothing outstanding; target is an erasure; target is a standing slate's pinned term. | `erasureOutstanding` probes bytes on every ground in reach (`erase.ts:1143-1171`) |
| 5 | 878-912 | A local channel opening: refuse while live (`liveOpening`, 664-783). Then erase its receipts and close first, each through this same function. | `reactor.size`, `probe("any")`, `probe("inventory")`, a snapshot scan, `deltasSince` |
| 6 | 939-948 | Sign the erasure order, or reuse the standing one. | none |
| 7 | 958 | List every delta that cites the target, on every reachable tier. | whole-set scan per tier (`tiers.ts:69`) |
| 8 | 959-963 | Admit the order through the door, then `flush`. The order is durable before the target goes. | journal `admitErasures` (`peer-admission.ts:157`); the journal records a purge obligation |
| 9 | 972-978 | Rebase the journal, so the frames that admitted the target leave. | `rebaseHostPeer` (`peer-admission.ts:225`) |
| 10 | 979-983 | `backend.purge([id])`. A fault is collected, not thrown. | `purge` |
| 11 | 986-1005 | `backend.holds(id)`. Report `removed` or `failed` to the journal. | `holds`; `reportPurged` (`peer-admission.ts:201`) |
| 12 | 1006-1012 | `reseat()`: rebuild the reactor from the store. | boot-shaped read of every row |
| 13 | 1022-1027 | Fan the order out to every attached pool: `eraseReplica`. All settle before any report. | per pool: steps 8 to 12 again (`erase.ts:1255-1329`), then that pool's own pools |
| 14 | 1031-1046 | Byte verdict: `holds(id)` here, plus every pool refusal. Any fault throws "still held". | `holds` |
| 15 | 1056-1066 | Return the receipt: citations, kept stores, the erasure id, minted or reused. | none |

Purge per tier today:

| Tier | What `purge` does | What `holds` asks | Evidence |
|---|---|---|---|
| SQLite | Deletes the row with `secure_delete = ON`, then a checked `wal_checkpoint(TRUNCATE)`. | An indexed row lookup. | VERIFIED at `sqlite.ts:95-131,425-470,545` |
| Mirror | Purges both tiers and settles both. | Asks both tiers; a tier that cannot answer rejects. | VERIFIED at `mirror.ts:227,334` |
| Archive | Removes the file filed under the id, and stray copies. | A directory sweep; `heldAmong` does it in one pass. | INFERRED from `backend.ts:44-63` and `archive.ts:365-422` |
| Memory | Deletes from a map. `holds` then answers false. | A set lookup. | INFERRED from `memory.ts:55-104` |
| Local storage | Removes the key. | A key lookup. | INFERRED |
| Journal frames | A rebase replaces payload frames with a checkpoint. | The journal settles `removed` only when the store proves absence in the same transaction. | VERIFIED at `peer-admission.ts:196-232` |

Other erasure paths (VERIFIED):

- `eraseReplicaImpl` `erase.ts:1255-1329`: check the order, admit it, purge, `settleOwedPurges`,
  reseat, fan out, verdict.
- `settleOwedPurges` `purge-settle.ts:14-43`: pays obligations from orders that came through the
  append or federation door.
- Attach sweep `container.ts:696-709`: purges the host's erased set from a pool store at attach.
- Pool drop `container.ts:956-1016`: purges every id the pool can name, discards the quarantine
  pen, discards the journals, then asks `holdsAny`.
- `heal` `mirror.ts:357-457`: copies between tiers, excludes erased ids, purges them from both.
- `cut` `slate.ts:520-770`: erases each slate member through `eraseImpl` (`slate.ts:690`).

### 4.2 Map to SPEC-18 `purge` and `PurgeReport`

| Today | SPEC-18 | Result |
|---|---|---|
| Steps 3, 4: read orders and the target | `scope` at `ERASE_ENTITY`; `get` | Same answer. |
| Step 7: citations per tier | none | Gap G2. |
| Step 8: admit the order, record the obligation | `append` with `Admission.erased` (§4.5) | Same, if Loam alone supplies `erased`. See W4. |
| Step 9: rebase | Inside `purge`: the report lists "journal frames" and "checkpoints" as surfaces (§4.7.2) | Loam's explicit rebase dies. Confirm frames carry no payload after the journal split (gap G5). |
| Step 10: `backend.purge` | `purge(ids)` | Same target set: one id. |
| Step 11: `holds`, then `reportPurged` | The `PurgeReport` surfaces: `absent`, `owed`, `unprovable` | `absent` on every surface maps to `removed`. `owed` and `unprovable` map to `failed`. |
| Step 12: reseat | none; the purge writes one `removed` change record | Dies. Section 3.3 lists what must hang on the record. |
| Step 13: fan-out to pools | none; a purge is per peer (§7) | Loam keeps the fan-out. See W2. |
| Step 14: byte verdict | The same `PurgeReport`, per peer | The verdict folds every peer's report. `held-by-other-peer` needs a rule. See W2. |
| SQLite `secure_delete` and WAL truncation | Erasure class `proven` (§5.2) | Same promise. |
| Memory purge that reads as clean | Erasure class `unprovable` (§5.1) | Changes. Every erase on a memory store reports `unproven`. See W7. |

### 4.3 What Loam does today that the proposal's purge does not provide

1. **A byte probe apart from a purge.** `holds`, `heldAmong` and `holdsAny` run before an erase
   (`erase.ts:697,765,1158`), on health screens (`erase.ts:1331` onward), on the federation door
   (`ingest.ts:914`) and in the CLI (`cli.ts:5007,5311`). SPEC-18 reports absence only as the
   result of a `purge`.
2. **A purge of bytes the peer no longer lists.** A target leaves the reading when its order is
   admitted; its bytes go later (`erase.ts:795-799`). A crash-left file is also swept
   (`backend.ts:44-52`). SPEC-18 does not say whether `purge(id)` sweeps an id the peer does not hold.
3. **The quarantine pen.** `quarantine`, `discardRow`, `restoreQuarantined`, `setAside`
   (`quarantine.ts:115-140`). A pool drop discards rows that have no readable id
   (`container.ts:959-966`). An id-keyed purge cannot reach them.
4. **A whole-peer discard.** `discardJournals` and `holdsAnyRow` (`container.ts:1002-1012`).
   SPEC-18 has no operation that deletes a peer.
5. **An inventory that includes unreadable rows.** `ids()` on every tier (`custody.ts:32-39`,
   `erase.ts:717`).
6. **Arrival history that keeps erased ids.** The journal's arrival list still names an erased id
   (`peer-admission.ts:57`), and recovery reads it (`user-recover.ts:665`). SPEC-18 `purge`
   removes "arrival rows for this peer".
7. **The fan-out, the citations manifest, the cascade over a channel opening, the re-entry
   refusal.** These are Loam law. They stay in Loam.
8. **Everything a reseat did.** Section 3.3.

### 4.4 Places where the mapping could change what gets removed

The rule: the move may not widen what a purge removes. Each row is a place to put a two-sided rail.

| # | Risk | Direction | Where | What to hold |
|---|---|---|---|---|
| W1 | SPEC-18 `purge` removes the arrival row of the target. Today the arrival history keeps the id. | **Wider** (metadata) | `peer-admission.ts:57`; `user-recover.ts:665`; `recovery-cut.ts:144` | Decide with Sol whether a purge keeps an id-only arrival stub. A recovery resume reads it. |
| W2 | Pools on one shared store: a purge in the host leaves bytes a pool peer holds, and reports `held-by-other-peer`. | Narrower, and a report that can read as clean | `erase.ts:1022-1046` | Keep the fan-out. Treat `held-by-other-peer` as not settled until every peer in reach reports. |
| W3 | Pool drop as "purge every id the `Exporter` lists". `openAdmin()` is on the `Store`, not on a peer (§4.1). A store-wide list would name the host's deltas. | **Wider, and unrecoverable** | `container.ts:956-978` | The drop must list one peer's holdings only. Do not build it until the proposal says the `Exporter` is per peer, or adds a peer delete. |
| W4 | `Admission.erased` makes the store act on erasure targets inside `append`. Loam's law decides which orders bind (`erase-law.ts:338-361`: negated, receiver, shape). | **Wider** if any other party fills `erased` | `peer-admission.ts:157-190` | Loam alone computes `erased`, from `boundErasures`. Rail: a negated order and a wrong-receiver order remove nothing. |
| W5 | The mirror as a union composition. Today reads come from the primary only (`mirror.ts:217`). A union read would serve a delta only the cold tier holds. | Wider reading, not a wider purge | `mirror.ts:201-217,357-457` | Keep "read primary only", or run `heal` before any read. A purge must still reach both. |
| W6 | The attach sweep purges the host's erased set from a pool (`container.ts:696-709`). On a shared store the same ids are a per-peer purge. | Same set | `container.ts:696-709` | Rail: a bystander in the pool survives the attach. |
| W7 | Memory is `unprovable`. Loam's verdict throws when bytes are not proven gone (`erase.ts:1038`). Pools default to `MemoryBackend` (`container.ts:688`). | No change in what is removed; every report changes | `erase.ts:1031-1046` | Decide the verdict wording for an `unprovable` peer. Do not turn `unproven` into a pass. |
| W8 | Bytes are shared and counted by holdings (§7). A purge removes bytes when the last holder purges. Today each store file is separate. | Same set, new mechanism | every purge site | Rail: host and pool both hold X; purge in the pool; the host still reads X. |
| W9 | `purge` also removes "derived-index entries" and index rows. Today the reactor's indexes are rebuilt without the id. | Same set | n/a | Covered by the store vectors. Loam rail: the erased id leaves `targets` and `negators`. |

## 5. Drivers

Construction counts are `grep -rn "new <Name>("` (VERIFIED).

| Driver | What it is for | Constructed in `src` | In tests | In demos and scripts | Recommendation |
|---|---|---|---|---|---|
| `MemoryBackend` `store/memory.ts` | Tests, default pool store, scratch gateways | 2: `container.ts:688` (default pool store), `admin.ts:410` (scratch destination) | 721 calls in 303 files | 3 files | **Becomes the store's own** (`memory:`). The 721 test calls need one helper so the change is one line per file. |
| `SqliteBackend` `store/sqlite.ts` | The served store and every channel pool file | 3: `cli.ts:733` (`openStore`, also used by `channelBackendFor` `cli.ts:716`), `command.ts:80`, one comment | 239 calls in 66 files | 7 | **Becomes the store's own** (`sqlite:`). Loam keeps only its repair layer on top. |
| `ArchiveBackend` `store/archive.ts` | A cold vault of one file per delta, for backup and restore | 2: `cli.ts:1290` (`serve --archive`), `cli.ts:4585` (`erase` with vaults) | 40 calls in 14 files | 1 (`demos/village/harness.mjs:91`) | **Becomes a store implementation with a declared profile**, if Loam keeps `--archive`. Profile: no journal, no values, no arrival, no change feed; erasure `proven` only on a plain directory. Else delete with the mirror. Myk's call. |
| `MirrorBackend` `store/mirror.ts` | Writes to a primary and an archive; reads the primary; `heal` reconciles | 2: `cli.ts:1291`, `cli.ts:4585` | 72 calls in 16 files | 1 (`demos/village/harness.mjs:92`) | **Becomes a composition**, but not one SPEC-18 §5.6 lists. It is a replica, not an overlay or a union. Gap G9. |
| `LocalStorageBackend` `store/local-storage.ts` | The browser peer | **0** | 27 calls in 4 files (`contract`, `holds-any`, `local-storage`, `local-storage-restore`) | 3: `demos/tutorial/lessons.mjs:318`, `demos/village/phase17.mjs:62,145` | **Delete from the server package; keep the browser path alive another way.** It is exported at `src/index.ts:291` and `src/browser/index.ts:34`, and the tutorial uses it. SPEC-18 puts the browser on IndexedDB or SQLite over OPFS, both "later". Until one lands, the browser bundle needs the memory store plus an export to `localStorage`, or this driver stays as a store implementation with erasure `unprovable`. |

Not drivers:

| File | What it is | After the move |
|---|---|---|
| `store/peer-image.ts` | Two interfaces: `JournalBackend` and `PoolKeySource`. SQLite and memory implement the first (`sqlite.ts:638`, `memory.ts:104`); the mirror passes it through (`mirror.ts:134`). | `JournalBackend` dies: the journal is a store capability (§4.7.3). `PoolKeySource` stays; it is Loam's key file. |
| `store/quarantine.ts` | The `RepairableBackend` interface and the shared row verdict. SQLite and local storage implement it; the mirror passes it through (`mirror.ts:314`). | Stays as Loam's repair layer, built on the store's integrity-fault report (§9). The report has no shape yet. Gap G6. |
| `store/canon.ts` | `canonicalDelta`: the JSON profile's fixed point. | Stays, or moves to rhizomatic with the store. Exported at `src/index.ts:289`. |
| `store/backend.ts` | The `StoreBackend` interface. | Dies (§11). It is a public export (`src/index.ts:288`, `src/browser/index.ts:36`). |

## 6. Proposal gaps

Each gap names the Loam site, the need, and the nearest SPEC-18 section.

| # | Loam site | What Loam needs | Nearest section | Kind |
|---|---|---|---|---|
| G1 | `registration.ts:861,1162`; `container-law.ts:533`; `renderers.ts:312,457`; `runner.ts:139`; `adopt.ts:145`; `channel.ts:2570,2661` | An anchor for "every delta with a pointer in context C". Law is filed at many entities under one context (`registration.ts:621`). The target index keys on the entity id alone. | §4.7.1 (three anchor kinds); §4.7.5 (derived indexes are for registered hyperschemas) | Missing. Either a consumer-registered derived index by predicate, or Loam files law at one fixed entity per kind (a wire change). |
| G2 | `tiers.ts:69`; `slate.ts:356` | "Every delta that references id X", by any delta pointer and by named primitive roles. | §4.2 `negators` covers the `negates` role only | Missing. |
| G3 | `budget.ts:181`; `erase.ts:679,697`; `channel.ts:2196`; `channel.ts:695,1107,1185` | A count per author; "is this peer empty"; a content address over a peer's whole membership. | §4.7.6 `digest(prefix)` gives a count and a hash by id prefix | Partly. The empty check maps to `digest("")`. The per-author count does not. The version address (`freezeMembers`) is a different hash. |
| G4 | `recovery-cut.ts:144,336`; `user-recover.ts:665`; `peer-admission.ts:57-61` | Read the arrival record of a held id. List ids by arrival range. Ask whether an id ever arrived, erased or not. | §4.2 `Snapshot` has no arrival read; §4.3 has `arrivalAtMost` pushdown only; §4.7.2 removes arrival rows | Missing, and W1 conflicts. |
| G5 | `erase.ts:980-1005,1183`; `custody.ts:10-49`; `container.ts:956-1016`; `purge-settle.ts:14-43` | (a) Which interface carries `purge`: it is absent from `Store`, `PeerStore` and `Snapshot` in §4.1 and §4.2. (b) How `purge` relates to `Admission.erased`. (c) Whether `purge(id)` sweeps an id the peer no longer lists. (d) A byte probe without a purge. (e) Whether the `Exporter` lists one peer or the whole store. (f) A peer delete. (g) Whether journal frames still carry payload. | §4.5, §4.7.2, §4.7.6, §7 | Ambiguous (a, b, c, e, g). Missing (d, f). |
| G6 | `gateway.ts:752-765`; `cli.ts:2440-2540`; `container.ts:959-995`; `mirror.ts:509-529` | The shape of the "generic integrity-fault report": which rows, with what key, and a way to discard or replace one. | §9 names it; §4.7.3 says a bad row fails the read that touches it | Ambiguous. Loam's pen is filled by a full read today; `fsck` is the only stated source after the move. |
| G7 | `gateway.ts:2058-2066`; `user-root.ts:609-637`; `container.ts:107-170`; `negation-closure.ts:68-79` | One read that spans peers: a pool reads its host's users; a scope composes the host and its pools; a negation closure crosses grounds. All inside one evaluation. | §4.4 (one snapshot per read); §5.6 (a union's revision is a pair) | Ambiguous. Needs one consistent snapshot across several peers of one store. |
| G8 | `gateway.ts:1901,2411` | The next validity boundary after `now` for a view or a scope. Today it is one whole-set number. | §4.7.4 `expiresAt`, slice 6 only | Missing between slices 2 and 6. Loam can compute it from a fetched scope. |
| G9 | `mirror.ts:201-217,332-457`; `cli.ts:1290-1320,4583-4585` | A replica composition: write both, read one, purge both, reconcile with an exclusion set. | §5.6 lists union, overlay and cache | Missing. |
| G10 | every law reader in section 1 with class scope | A synchronous delta source built from a `ScopeResult`, as a public type. The readers call `get`, `byTarget`, `negationsOf`, `negationPredicate`. | §4.2 "MAY also expose the SPEC-17 `DeltaSource`" | Ambiguous. Loam needs it as a MUST for a fetched scope, with the negation readers. |
| G11 | `peer-admission.ts:124-190`; `ingest.ts:505-514` | Who builds `Admission.frame` and `nextHead`. Loam calls `OrdinaryJournalPeer.admit` today and never sees a frame. | §4.5, §4.7.3 | Ambiguous. Loam should keep calling the journal peer; say so. |
| G12 | `container.ts:688`; `erase.ts:1031-1046` | The posture rule for a host that promises proven erasure and opens default memory pools. Each pool is its own peer with its own key. | §4.7.2 (posture gating) | Needs a decision: refuse the pool, or require a `proven` pool store. |
| G13 | `ingest.ts:732-793`; `reads.ts:786-841` | A subscription that needs "which of my scope's ids were removed". The feed gives ids; the scope membership is Loam's. | §4.6, §6.5 | Covered, if a memory view keeps its member ids. Noted so slice 3 states it. |

A naming point, not a gap: Loam has a class `Store` (`src/gateway/store.ts:33`) for the tree of
containers. SPEC-18 uses `Store` for the delta store. Rename Loam's before slice 5.

## 7. A suggested order

Each row is one small PR unless it says "stack". "Now" means it can land behind the present
reactor.

### 7.1 Before the store exists

| # | PR | Size | Notes |
|---|---|---|---|
| A1 | Rename Loam's `Store` class to `ContainerTree`. | mechanical | Removes the name collision. |
| A2 | Remove the scans that already have an entity anchor: `ingest.ts:610`; `local-channel-events.ts:249,276,295,374`; `erase.ts:793`; `erase.ts:358`. | small | H9. Uses `byTarget` today. |
| A3 | A `Ground` read type: `get`, `byTarget`, `negationsOf`, `negationPredicate`, `negationWitnesses`. Law readers take it in place of `Reactor`. | mechanical, many files; stack by directory | No behaviour change. It makes each reader runnable over a fetched scope. |
| A4 | A gateway revision counter, raised per admitted batch and per reseat. Re-key C1, C6 on it. | small | After the move the counter is the store's revision. |
| A5 | Move the registries K1 to K4 from `WeakMap<Reactor>` to fields on the gateway. | small | Removes four declare-again calls. |
| A6 | One request ground. `prepareRead` builds it: the law entities (`STORE_ENTITY`, `ERASE_ENTITY`, slate, recoveries, pool keys, public) as a subset view. Doors pass it down. | medium; stack per door | The synchronous shape of the final read path. |
| A7 | Make the sync public reads async. Three PRs: entity reads (`gather`, `resolvedNode`, the sync write verbs); scopes and membership (`select`, `freeze`, `offeredDeltas`, `containerScope`, `servingScope`, `connectionScope`); law getters (`containers`, `slates`, `channelStatus` and the rest of section 2.3). | large but mechanical; tests change by `await` | An API break. Greenfield allows it. |
| A8 | Put the purge steps of `eraseImpl` and `eraseReplicaImpl` behind one port: purge, verdict, obligation report. Same behaviour on the present backend. | small | Every rail stays two-sided. It makes slice 5's erasure change a port swap. |
| A9 | The law filing decision (G1). If Loam files law at fixed entities, land it now. | wire change | It decides a wire format. Myk merges. |
| A10 | A test helper that opens a memory store, used by the 303 test files. | mechanical | One line per file later. |

### 7.2 What waits for which rhizomatic slice

| Slice | Loam PRs it unlocks |
|---|---|
| 1 (interface, memory store) | None in `src`. Loam can pin the types and write its adapter rails. Send the gaps of section 6 to Sol before slice 2 fixes the read shape. |
| 2 (reactor reads through a store) | Open a gateway on `memory:`. `MemoryBackend` dies. The request ground of A6 becomes a `scope` call. `snapshot()` callers move to the flagged full-surface read or the `Exporter`. |
| 3 (revisions and the feed) | The feed sites: `ingest.ts:347-358` (catch-up), `gateway.ts:823` (`durableCurrent`), C2, C4, C5, the `watch` pulse (`ingest.ts:789`), the write-through queue (`gateway.ts:625-665`). `refresh` becomes a feed read. |
| 4 (SQLite store, journal split, `fsck`, proven erasure) | Delete boot replay (`gateway.ts:684-748`) and `reseat` (`gateway.ts:1670-1754`). Swap the purge port of A8 to `purge` and `PurgeReport`. Hang section 3.3 on the `removed` record. Move the retired-slate check (`gateway.ts:738`) to the format string. Delete `SqliteBackend`'s generic code and `JournalBackend`. Rebuild the repair layer on the fault report (G6). |
| 5 (the move itself) | The PRs above, in this order: memory store; feed sites; SQLite and erasure; then the mirror, archive and local-storage decisions. Erasure lands alone, with Myk's merge if any row of 4.4 changes what is removed. |
| 6 (stored views, derived indexes, value anchors) | `register` and `materializedView` become stored views. H1 and H3 leave the full-surface path through derived indexes. H8 becomes value lookups. |

### 7.3 Order inside slice 5

1. Memory store under the gateway, all reads through the request ground.
2. Feed sites and cache keys.
3. SQLite store; delete boot replay.
4. Erasure on `purge`; delete `reseat`. One PR. One line in its body states what can now be
   deleted that could not before. The expected answer is "nothing".
5. Pools as peers on the shared store, or kept as separate store files. This is a decision (W2,
   W3, W8, G7, G12).
6. Mirror, archive, local storage.

## 8. Not determined

- The full caller chain from each whole-set site to each door. Section 2.3 gives the doors; the
  middle of each chain is INFERRED from grep counts.
- The body of `appendImpl` and `federateAdmitted` between `ingest.ts:505` and `ingest.ts:1100`
  was read only at the cited lines.
- The archive, local-storage and memory drivers were read at their headers and method lists only.
- `cut` (`slate.ts:520-770`) was read only at its `eraseImpl` call (`slate.ts:690`).
- The installed rhizomatic in the main checkout is `0.11.0-next.6`. `package.json:75` pins
  `0.11.0-next.10`. `evalAnchored` and `subset` were not checked against the pinned typings.
- Test and demo call sites were counted, not classified.
