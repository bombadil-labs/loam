# Erasure and forgetting: where Loam built around rhizomatic

I read the files below in `/home/mykola/bombadil-labs/loam-refactor` (HEAD a9276e96) and the rhizomatic spec. I made no edits and ran no tests.

## Entries

**1. The tombstone vocabulary is Loam's, and it contradicts P2**
- **Loam does:** An erase appends a signed claim at `loam:erasure` / `loam.erasure`. Its roles are `erases`, `spoken-by`, `reason` and an optional `slate` (`src/gateway/erase.ts:57-90`). The bytes are then purged (`erase.ts:1045`).
- **Substrate gap:** SPEC-0 P2 says deltas are never modified or deleted (`00-overview.md:34`). SPEC-1 §7 says both deltas remain "forever". `00-overview.md:160` pushes erasure out to instance storage policy. SPEC-6 §7 is "not yet normative".
- **vNext candidate:** Amend P2: meaning is append-only, bytes may be forgotten. The forgetting tier owns a normative forget-record vocabulary.
- **Class:** rhizomatic contract. **Tier:** forgetting. **Confidence:** CONFIRMED.

**2. Refusing re-entry is a Loam-only admission step, and it scans the whole ground**
- **Loam does:** Both doors check `dead.has(d.id)`: append at `src/gateway/ingest.ts:236,251`, federation at `ingest.ts:646,668`. `readTombstones` walks `reactor.snapshot()` on every call (`erase.ts:206-245`). `deadSet` (`ingest.ts:458-465`) exists only to skip that cost.
- **Substrate gap:** The SPEC-6 §5 admission pipeline has no forgotten-id step. Its only local hook is step 3, the admission predicate.
- **vNext candidate:** Make "refuse forgotten id" a normative admission step. The forgotten set should be an indexed reactor structure, not a scan.
- **Class:** rhizomatic contract. **Tier:** federation (admission) and forgetting. **Confidence:** CONFIRMED.

**3. Purge and the byte-presence probe are a storage-seam exception**
- **Loam does:** `StoreBackend.purge` is described in its own comment as "mechanical, not law". `holds`, `holdsAny` and `ids` fail closed (`src/store/backend.ts:40-80`). An unanswerable store counts as holding bytes (`erase.ts:870-887`).
- **Substrate gap:** SPEC-8 has no removal operation. SPEC-8 §7 only flags erasure.
- **vNext candidate:** The storage tier gets `forget(ids)` and a byte-presence probe with a three-state answer: gone, held, unproven. How each driver purges stays Loam policy.
- **Class:** rhizomatic contract (the interface) plus Loam policy (the drivers). **Tier:** storage. **Confidence:** CONFIRMED.

**4. The reactor cannot forget, so Loam rebuilds the gateway**
- **Loam does:** After a purge, `gw.reseat()` (`erase.ts:1051`) replaces the whole reactor from the backend (`src/gateway/gateway.ts:479`). This orphans indexes keyed on the old reactor (`src/gateway/listing.ts:251,278`). Live streams must be torn down (`gateway.ts:427`).
- **Substrate gap:** SPEC-4 handles removal only through the negation index. It has no delta-removal operation.
- **vNext candidate:** A reactor `forget(id)` that invalidates the affected materializations, the same way a negation does.
- **Class:** rhizomatic contract. **Tier:** reactor. **Confidence:** CONFIRMED.

**5. Forgetting a strike brings its target back, and the substrate does not define that**
- **Loam does:** A before/after diff finds which claims a removal revived (`erase.ts:233-250`, `revivedAcross` at 529). `condemnedClosure` follows `negates` pointers (`src/gateway/slate.ts:1013`). Egress withholds targets transitively (`ingest.ts:556-575`). §29.5 reports the "resurfacing set" before a cut.
- **Substrate gap:** SPEC-1 §7 and SPEC-2 `mask` assume a strike is present forever.
- **vNext candidate:** Under "meaning is append-only", a forget record could keep the forgotten strike's suppression in force. Then no revival happens. This reverses what Loam does today.
- **Class:** decision for Myk. **Tier:** algebra. **Confidence:** CONFIRMED.

**6. Tombstones from other signers are refused, not kept as testimony, and a request has no vocabulary**
- **Loam does:** `eraseDefect` refuses any tombstone the operator did not sign (`erase.ts:166-200`). It runs at the federation door too (`ingest.ts:671`), so a peer's order is never stored. §11 says "a request may travel as ordinary data". A search of `src/` found no request vocabulary.
- **Substrate gap:** SPEC-6 §5 says a rejection "is never communicated as authority". The protocol has no shape for a forget request or a forget receipt.
- **vNext candidate:** Split into three records:
  - a local forget order: binding only on its own signer's peer;
  - a forget request: plain data;
  - a forget receipt: testimony.
  The ruling says the authority check is "signed by this peer's own principal". "Operator" stays a Loam role.
- **Class:** decision for Myk (does a peer store a foreign order as testimony or drop it?). **Tier:** forgetting and principal. **Confidence:** CONFIRMED (the "no vocabulary" part is by grep).

**7. No peer publishes what forgetting it honors**
- **Loam does:** Nothing. The only statements are text lists printed on the local report: `ERASURE_NON_CLAIMS` says "PEERS ARE NOT REACHED" (`erase.ts:1438-1458`).
- **Substrate gap:** The ruling wants each peer to publish the degrees it honors. No spec defines that.
- **vNext candidate:** A forgetting-posture declaration listing the degrees: refuse re-entry, surface requests, purge on request, hold sealed payloads, destroy keys.
- **Class:** rhizomatic contract. **Tier:** forgetting and federation. **Confidence:** CONFIRMED (absence).

**8. There are no sealed payloads and no key destruction**
- **Loam does:** Nothing is implemented. The "sealed authorship" feature is `sealCommitment = sha256(salt‖author)` (`erase.ts:732`). That is an authorship commitment, not an encrypted payload.
- **Substrate gap:** Blob indirection plus key destruction is proposed in SPEC-6 §7, SPEC-8 §7 and NOTE-12 §4 tier 2. None of it is normative. NOTE-11 §3 says a publish cannot be taken back.
- **vNext candidate:** A sealed-payload vocabulary and key destruction in the forgetting tier. This is the only way to keep the public promise about peers. The word "sealed" also needs one meaning: rename sealed authorship.
- **Class:** rhizomatic contract, plus a naming decision. **Tier:** forgetting. **Confidence:** CONFIRMED.

**9. Point reads still serve a tombstoned delta whose bytes remain**
- **Loam does:** A comment at `ingest.ts:550-556` admits it. `select`, `freeze` and `offeredDeltas` apply no dead-set filter (T90). If a purge fault leaves bytes, those doors keep serving and republishing a delta that has a tombstone. Only egress hides it.
- **Substrate gap:** Rhizomatic has no idea of "present but forgotten".
- **vNext candidate:** The reactor or resolve tier treats forgotten ids as absent whether or not the bytes are present. That closes the gap by construction.
- **Class:** rhizomatic contract. **Tier:** reactor and resolve. **Confidence:** CONFIRMED (from the comment; I did not check the code paths).

**10. Receipts exist in two forms, and neither is a protocol object**
- **Loam does:** `TombstoneReceipt` / `receiptLedger` (`erase.ts:626-701`) with an `inert` count. §29.7 defines an exported signed document that re-probes the bytes every time it is issued. Its serialization is deferred (§29.7, §29.10).
- **Substrate gap:** No receipt format exists. The ruling treats a receipt as testimony that a later serve can prove false.
- **vNext candidate:** A protocol receipt: signed testimony that states its own non-claims and carries the three-state verdict. The live probe stays Loam policy.
- **Class:** rhizomatic contract (format), Loam policy (probe). **Tier:** forgetting. **Confidence:** CONFIRMED for the ledger. PLAUSIBLE for `deriveReceiptImpl` (`slate.ts:1823`), which I did not read.

**11. Heal is kept from bringing back purged ids by a guard built outside the substrate**
- **Loam does:** `MirrorBackend.heal(exclude)` (`src/store/mirror.ts:256-290`). The boot path builds a throwaway reactor over both tiers to compute the dead set (`src/cli/cli.ts:1188`, `erase.ts:723`).
- **Substrate gap:** Neither the SPEC-8 §4 rehydration contract nor §5 repacking has an exclusion set.
- **vNext candidate:** Storage repair and rehydrate take the forgotten set as input. Packs need this too.
- **Class:** rhizomatic contract (the hook), Loam policy (the mirror). **Tier:** storage. **Confidence:** CONFIRMED.

**12. Erasure fans out to the operator's own replicas**
- **Loam does:** Before any work, erase refuses if a declared store is unreachable (`erase.ts:925-940`). It then fans out to quarantine pools with `allSettled` (`erase.ts:1060-1075`), per §24.8.
- **Substrate gap:** A forget order is binding only inside one principal's walls. Rhizomatic has no notion of "a replica of the same principal".
- **vNext candidate:** The principal tier could define that relation, so replicas honor the order. The fan-out itself stays Loam policy.
- **Class:** Loam policy, with a possible principal-tier hook. **Tier:** principal. **Confidence:** CONFIRMED.

**13. Undoing an erasure ("forgiveness") is a strike on the tombstone, and some tombstones cannot be forgiven**
- **Loam does:** A lawful strike on a tombstone removes it from the dead set (`erase.ts:218-230`). Local-control tombstones cannot be forgiven (`erase.ts:224-226`, `spec/59-local-channel-incarnations.md:42-46`).
- **Substrate gap:** Nothing in rhizomatic defines withdrawing a forget order.
- **vNext candidate:** Decide whether "unforget", meaning the id may re-enter, is protocol or local.
- **Class:** decision for Myk. **Tier:** forgetting. **Confidence:** CONFIRMED.

**14. Slating, the cut, graveyards, the live-opening rule and anonymous reassertion are Loam policy**
- **Loam does:**
  - The slate workflow, the cut and graveyard proofs (`slate.ts:1216`, `slate.ts:1699`).
  - The §59 rule that a live channel opening cannot be erased (`erase.ts:749-868`, `erase.ts:975-1008`).
  - Anonymous reassertion and redaction. These are compositions only: there is no reassertion verb, just the `sealCommitment` helper.
- **Substrate gap:** None needed. SPEC-1 §4 puts the author in the content address (H4), which is why reassertion needs a new id.
- **vNext candidate:** None; Loam policy.
- **Class:** Loam policy. **Confidence:** CONFIRMED.

### What H7 and H9 say about claims of completeness
- **H7** (`SUBSTRATE-HAZARDS.md:197`): an idempotence short-circuit must prove it actually landed something. A presence check over a stale index gives a false "done".
- **H9** (`SUBSTRATE-HAZARDS.md:273`): a swallowed failure answers "no". A `holds()` false that means "could not ask" becomes a false claim that the bytes are gone. It has bitten the archive's `holds`, heal's `purgeFailures` and the pool fan-out.
- **For vNext:** every verdict about forgetting must be three-state (gone / held / unproven) at the substrate interface. This is the storage-level form of the "receipt is testimony" ruling.

## Recording targets

| Function | File | Inputs it needs |
|---|---|---|
| `eraseDefect(delta, reactor, operator)` | `erase.ts:166` | Tombstone shapes: duplicate `erases`, missing or duplicate `spoken-by`, a bad `slate`, signed by someone other than the operator, a wrong `spoken-by` against a live target, no operator. |
| `survivingTombstones` / `readTombstones` | `erase.ts:206,218` | Corpora with struck, double-struck and non-operator tombstones, plus local-control tombstones with and without a matching order. |
| `tombstonesIn(deltas, operator)` | `erase.ts:723` | Delta lists from two tiers, to check it agrees with `readTombstones` at boot. |
| `receiptLedger` | `erase.ts:660` | Same corpora; record `receipts` and `inert`. |
| `forgottenSince(reactor, op, since)` | `erase.ts:704` | Corpora with timestamped tombstones and several `since` values. |
| `eraseClaims`, `sealCommitment` | `erase.ts:66,732` | Fixed arguments; record the exact bytes and ids as goldens. |
| `condemnedClosure(reactor, seed)` | `slate.ts:1013` | Strike chains: strike-on-strike, and a claim with two strikes. |
| `graveyardCompleteness(reactor, op, id)` | `slate.ts:1699` | Graveyards with members that are cited, prior-tombstoned, forgiven or missing, and one with an erased membership Term. |
| `slateDefect`, `slateRefusal`, `freezeAgreement`, `readSlates(…, now)` | `slate.ts:242,967,520,604` | Slate records and container declarations with fixed `now`. `readSlates` needs a fixed clock. |

These are pure over (corpus, operator key, now). Everything else in `eraseImpl` and `cutImpl` does I/O and belongs in integration rails, not recording.
