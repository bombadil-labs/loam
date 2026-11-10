# Decision: how Loam files its law for the store

Status: open. Owner: Myk. Written 2026-11-09 against Loam `4161f883` and rhizomatic `fdd5bd1`.
Marks: **V** = verified in the code. **I** = inferred.

## 1. The decision

Loam must stop reading law with a scan of the whole delta set.
Choose how a reader finds "all law of one kind": a fixed entity (A), or a context index (B).

## 2. Why now

- SPEC-18 forbids a whole-set scan on a serving path (§3 rule 2, §6.6). **V**
- `lawfulSnapshot` and `lawfulHistory` scan the whole set. They have 22 call sites. **V** (`src/gateway/lawful.ts:12-30`)
- SPEC-18 §12 lists this gap as open for slice 5 or 6. Loam moves in slice 5. **V**
- The greenfield rule makes a wire change cheap today. It will cost more after a release.

## 3. The law kinds

All records are operator-signed. A pool reads its own key first, then its selected hosts (`lawAuthors`).
Counts are orders of magnitude. **I** for every count.

| Kind | Context | Filed at today | Fixed entity today? | Main readers | Count |
|---|---|---|---|---|---|
| Registration binding | `loam.registration` | `registration:<hyperschema entity>` (`registration.ts:621`) | No | replay `lifecycle.ts:447`; admin `admin.ts:498`; erase `erase.ts:302` | 10-100, +1 per republish |
| Hyperschema, schema definition | `definition` | `hyperschema:<name>`, `schema:<lens>`, `schema:<lens>@<hash>` | Name is known | `loadHyperSchema`, `loadSchema` | 3 per republish |
| Renderer | `loam.renderer` | `renderer:<route>` (`renderers.ts:269`) | No | `gateway.ts:1062`; pools `channel.ts:859` | 1-10 per app |
| Translation | `loam.translation` | `translation:<name>` (`translate.ts:150`) | No | federation ingest `translate.ts:282` | 0-10 |
| Channel record | `loam.channel` | `channel:<name>` (`channel.ts:275`) | No | `channelStatus`, sever | 1 per status change |
| Curse | `loam.channel.curse` | `channel:<name>` (`channel.ts:2683`) | Name is known | `cursesOf` | 0-10 |
| Container table | `loam.container`, `.excluded`, `.detached` | the container entity | No | `readContainerTable` (memo) | 1-10 per container |
| Runner binding | `loam.binding` | `binding:<name>` (`runner.ts:38`) | No | runner attach `runner.ts:139` | 0-10 |
| Adoption (law and fact) | `loam.adoption` | `loam:adoption` (`adopt.ts:16,49`) | **Yes** | `gateway.ts:1649`; `adopt.ts:145` | 1 per blessing |
| Graveyard | `loam.erasure.graveyard` | `loam:slate` and the container (`slate.ts:157-158`) | **Yes** | `gateway.ts:1192`; slate doors | 1 per cut |
| Erasure order | `loam.erasure` | `loam:erasure` (`erase-law.ts:40`) | **Yes** | `erase-law.ts:354-356` uses the index | 1 per erasure |

- Federation: law arrives in a channel pool under the peer's key. **V** (`renderers.ts:405-425`)
- A blessing publishes again under the operator's key, through the ordinary door. **V** (`adopt-law.ts:1-18`)
- Rhizomatic loads a definition from its root entity. It does not scan by context. **V** (rhizomatic `schema-deltas.ts:26-38`)

### The 22 call sites

| Need | Sites | Count |
|---|---|---|
| Whole kind, no anchor today | `registration.ts:861`; `renderers.ts:312,326,424`; `translate.ts:168`; `channel.ts:517,518`; `container-law.ts:534`; `container.ts:1638` | 9 |
| Whole kind, a fixed entity exists today | `slate-law.ts:803`; `slate.ts:853,975`; `adopt-law.ts:637,638` | 5 |
| Name is known, an entity anchor exists today | `registration.ts:1162,1272,1336`; `channel.ts:2320,2744`; `adopt-law.ts:878`; `lifecycle.ts:1070`; `receive-snapshot.ts:52` | 8 |

- Thirteen sites need no decision. They can move to the target index now.
- Four more whole-set law scans do not use the two helpers. **V**
  - `runner.ts:139` and `renderers.ts:457` need a whole kind.
  - `adopt.ts:145` has `loam:adoption`. `channel.ts:2570,2661` know the lens, so `schema:<lens>` serves.

### History readers

- Most readers order by signed time, then id. **V** (`registration.ts:845-847`, `renderers.ts:390-395`, `translate.ts:203-205`)
- `readChannels` breaks a timestamp tie by arrival order. **V** (`channel.ts:497-498,531`)
- An index read returns id order under A and under B. **V** (`lawful.ts:46-48`)
- A scope result carries each member's arrival record (SPEC-18 §4.3). The reader can sort on it. **I**
- Safer: give `readChannels` the (timestamp, id) tie rule. Then no law reader needs arrival order.

## 4. The options

### A. File law at one fixed entity per kind

- **What changes.** Each record of six kinds gains one pointer. The shape copies `loam:erasure`:
  `{role: "declares", target: {entity: {id: "loam:<kind>", context: <the kind's context>}}}`.
  - Entities: `loam:registration`, `loam:renderer`, `loam:translation`, `loam:channel`, `loam:container`, `loam:binding`.
  - Readers call `lawfulHistoryAt` with that entity. The index only narrows.
  - The author filter and the context filter still run after the index read. **V** (`lawful.ts:98-105`)
- **Cost.** A Loam wire change. Every law delta id changes. Old stores are refused. No rhizomatic change.
- **What can go wrong.**
  - Three readers take the first pointer in the context as the key. **V** (`registration.ts:877-882`, `translate.ts:170-175`, `channel.ts:520-522`)
    The new pointer shares that context. These readers must select by role.
  - Any author can point a delta at a `loam:` id. The door does not refuse it. **V** (`repair.ts:28-35`)
    Such a delta binds nothing, but it makes the read larger. SPEC-18 pushdown has no author field. **V**
  - The read grows with the law history of the kind, not with live law. Struck records and old versions stay.
    The store size no longer matters. Channel records are the largest set. **I**
  - Two kinds must not share one entity. Slates left `loam:erasure` for this reason. **V** (`slate-law.ts:27-34,86-97`)
- **Federation, adoption, containers, erasure.**
  - The pointer is inside the signed delta, so it travels. A pool is read with the same anchor.
  - A blessing uses the ordinary claims builder, so it gains the pointer. Same input still gives the same id. **I**
  - A container's law stays a name filter over the peer's set (SPEC-18 §5.2 accepts this cost).
  - A purge removes index rows with the delta. A two-sided rail per kind must prove this.
  - A membership Term that selects `loam:<kind>` now matches every record of the kind. Only the operator writes such Terms. **I**
- **Leaves open.** A door rule that refuses a non-operator pointer at a `loam:` id.

### B. A context anchor in the store

- **What changes.** `ScopeRequest.anchors` gains a fourth kind. The store gains a `contexts(c)` index read.
  SPEC-17 `anchorAnalysis` pins entities only. **V** (rhizomatic `resolve/anchored.ts:85-101`) It needs a new pin rule.
- **Cost.**
  - Both witnesses, the conformance vectors, and every store architecture in SPEC-18 §5 carry the index.
  - The index covers every pointer of every user delta. Loam reads about eight contexts from it.
  - Rhizomatic itself has no reader that needs it. **V** Loam is the only consumer.
- **What can go wrong.** The same oversized read as A: any author can write a `loam.` context.
  A context such as `name` has one row per user fact. An ad hoc read of it is very large.
- **Leaves open.** Nothing in Loam's wire format. The slice-5 schedule then depends on rhizomatic work.

### C. A derived index by predicate (SPEC-18 §4.7.5)

- **What changes.** Loam registers a predicate, `hasPointer{context: C}`. The store keeps its index.
- **Cost.** It arrives in slice 6, after Loam moves. Until then each law read is a flagged full-surface read. **V** (§10)
  Each peer pays one full backfill per index.
- **What can go wrong.** §4.7.5 ties an index to a registered hyperschema. Registrations are the law that names them.
  Loam needs a built-in registration to start. The index is a local cache, so a stale one gives a false absence (H8).
- **Leaves open.** The largest design question of the three. It is real, but it is late.

### D. Read law once into memory, then follow the change feed

- The container table does this today over the arrival log. **V** (`container-law.ts:479-503`)
- It cannot start cold without a whole-set read. SPEC-18 §1 forbids that at open.
- It is a cache on top of A, B or C. It is not an alternative.

### E. A separate index delta that the gateway writes

- Two deltas can disagree, and a missing index delta reads as "no such law". Reject E.
- Option A is the same idea with the pointer inside the record.

## 5. Comparison

| | A fixed entity | B context anchor | C derived index |
|---|---|---|---|
| Loam wire change | Yes, six kinds | No | No |
| Rhizomatic change | None | Spec, TS, Rust, vectors, all stores | Slice 6 as planned, plus a consumer predicate |
| Ready for slice 5 | Yes | Only if rhizomatic lands it first | No |
| Works with SPEC-17 scope today | Yes | No | No |
| Read cost | Law history of the kind | Law history of the kind | Law history of the kind |
| Index cost on user data | None | One entry per pointer | One predicate check per write |
| A stranger can enlarge the read | Yes | Yes | Yes |
| Precedent in Loam | Five kinds | None | None |
| Sites that still need it | 9 of 22, plus 2 outside | 9 of 22, plus 2 outside | the same |

## 6. Recommendation

**Take Option A.**

1. Loam already does it. Erasures, slates, graveyards, adoptions and the binding policy use a fixed entity. **V**
2. It needs no rhizomatic work. Law becomes an ordinary entity-anchored scope, closed under negations.
3. B and C make every store pay for a need that only Loam has. Rhizomatic's own schema vocabulary is root-anchored. **V**
4. The greenfield rule removes the migration cost now.

What I am unsure of:

- I did not measure record counts. The channel history size is a guess.
- I did not check each federation egress path for law records.
- I did not read the Rust witness. The cost of B there is an estimate.
- Pens (`loam.pen`) and arrivals (`loam.arrival`) are not in the 22 sites. I did not classify their readers.
- `lawfulSnapshot` is a public export (`src/index.ts:243`). Removal changes the package surface.

## 7. The PR stack if A is taken

| # | PR | Wire change | Merge |
|---|---|---|---|
| 1 | Five sites with a fixed entity today read the target index. `adopt.ts:145` too. | No | On evidence |
| 2 | Eight name-known sites read their entity anchor. `channel.ts:2570,2661` too. | No | On evidence |
| 3 | `readChannels` takes the (timestamp, id) tie rule. | No | On evidence |
| 4 | The three "first pointer in context" readers select by role. | No | On evidence |
| 5 | **Writers add the `declares` pointer for all six kinds. One format marker. Old stores are refused at boot.** | **Yes** | **Myk** |
| 6-11 | One PR per kind: the reader moves to `lawfulHistoryAt`. Each has a two-sided rail and a stranger-delta rail. | No | On evidence |
| 12 | Delete `lawfulSnapshot` and `lawfulHistory`. Update the public export. | No (API) | On evidence |
| 13 | Optional: the door refuses a non-operator pointer at a `loam:` id. | No (new refusal) | Myk |

PR 5 is the only wire change. Keep it small: writers and the format marker only.
