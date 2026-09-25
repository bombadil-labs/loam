# Time and ordering audit: where Loam builds around rhizomatic

Loam treats the author's `timestamp` as three different things. It is a claim of when something happened, an ordering key inside one process, and a part of the delta's identity. There is also no arrival time in the ground at all. Most of the entries below come from those two facts. Everything here comes from reading files; I edited nothing and ran nothing. All paths are relative to `/home/mykola/bombadil-labs/loam-refactor` unless stated.

### 1. The delta timestamp is really a per-process counter
- **Loam does:** `nextTimestamp()` returns `max(Date.now(), last+1)` (`src/gateway/gateway.ts:1408-1411`). `lastMutationTs` starts at `0` in every process (`gateway.ts:438`), so it is not seeded from the store's own highest timestamp. `mutate.ts:66-69` says this makes ties impossible within one instance, and that "across restarts the wall clock is the only witness." The client copies the same pattern (`src/client/index.ts:95-98`). `slate.ts:34-36` and `slate.ts:602` call this value "DELTA-TIME". They say it "may run ahead" and must never be compared with wall-clock values.
- **Substrate gap:** SPEC-1 §6 says `timestamp` is the author's claim and that it carries no clock. It has no creation-time versus sequence split. The causality annotation is left open (SPEC-1 §10, §9 `txn.prior`). Two consequences follow. After a restart with a backward clock step, new writes can sort before old ones and lose latest-wins. When a burst runs the counter ahead, the "creation time" is not the time of creation.
- **vNext candidate:** Split (a) author creation time from the ordering and causality signal, using an HLC or `prior`. At minimum, the author's own counter should be seeded from its own history.
- **Class:** rhizomatic contract. **Tier:** delta. **Confidence:** CONFIRMED.

### 2. Adoption backdates the operator's own claim to get stable identity
- **Loam does:** `promoteImpl` re-signs the source content as the operator but reuses `timestamp: src.claims.timestamp` (`src/gateway/adopt.ts:315`). `adopt-law.ts:12-23` does the same. The reason: the id hashes `{author, pointers, timestamp}` (H4 in `src/gateway/SUBSTRATE-HAZARDS.md:118-130`). Reusing the timestamp makes re-adoption produce the same id, so a tombstoned adoption stays dead. The cost is stated in `adopt-law.ts:18-22`: a blessing "cannot outrank an incumbent by RECENCY", so `supersede` has to carry a negation instead. `federation/channel.ts:2547-2551` shows a further cost. A lifted curse re-mints the same struck id, so the fix is to negate the negation.
- **Substrate gap:** SPEC-1 §4/§6 uses one timestamp for both identity and time. There is no "re-assert with the original valid-from" form.
- **vNext candidate:** With valid-from separated from creation time, adoption could carry the source's valid-from and a fresh creation time. That changes identity, so the erasure idempotence that relies on "same id" needs another anchor, for example a key on (content, valid-from) or on the source id.
- **Class:** decision for Myk. **Tier:** delta / forgetting. **Confidence:** CONFIRMED.

### 3. Hand-written latest-wins readers keep the first record they see on a tie
- **Loam does:** `latestByKey` has `if (prior.at >= d.claims.timestamp) continue` over `byTarget` order (`src/gateway/attention.ts:119`). The channel status reader does the same over `snapshot()` order (`src/federation/channel.ts:529`). Both hand-roll `pick byTimestamp desc` without `lexById`. In contrast, `binding-policy.ts:156-158`, `registration.ts:1056-1058` and `accounts.ts:275,386` do break ties by `(timestamp, id)`.
- **Substrate gap:** SPEC-5 §2 says every order must end in `lexById`. SPEC-4 §114 says arrival order must not reach content. These two readers leak arrival order on ties. Ties can happen across restarts (entry 1) or between two processes that share a seed.
- **vNext candidate:** Expose a resolve-tier "latest record per key" primitive with the normative tiebreak, so the "standing record, superseded in place" pattern stops being re-implemented. Otherwise this is a Loam bug fix.
- **Class:** Loam policy (a bug), with a candidate in the resolve tier. **Tier:** resolve. **Confidence:** CONFIRMED.

- **Recording shows** (`recordings/out/time.latest-tie.json`): `latestByKey` reads through the reactor's by-target index, so its tie winner is the same in both ingest orders. It breaks ties by index order, not by `lexById`. The arrival-order claim above holds for the channel reader, which walks the snapshot, and is not recorded yet.

### 4. As-of reads use author time only, so they cannot answer "what did this store hold at T"
- **Loam does:** `groundAsOfImpl` filters the whole snapshot with `claims.timestamp <= asOf` (`src/gateway/reads.ts:71-73`). `spec/26-as-of-reads.md` admits that timestamps are "testimony, gameable." Two effects follow. A backdated delta that arrives late rewrites past as-of answers, so the same as-of query gives different answers on different days. A future-dated delta is missing from every present-day as-of read. The filter is also an O(N) walk in JS, although rhizomatic has `match(timestamp, lte, T)` (SPEC-2 §79).
- **Substrate gap:** SPEC-1 §6 gives only claimed time. Arrival time (c) exists only as an optional annotation, and no tier indexes it.
- **vNext candidate:** Add a peer-testified arrival index (c) to storage or reactor, so a reader can choose between "valid at T" and "known here by T". As-of would then be a pair of axes.
- **Class:** rhizomatic contract. **Tier:** storage / reactor. **Confidence:** CONFIRMED.

### 5. Loam fakes arrival time with its own `loam.arrival` stamps
- **Loam does:** `arrivalClaims` writes a receiver-signed `loam.arrival` delta that lists up to 256 arrived delta-refs (`src/federation/channel.ts:316-367`). Its time is the stamp's own `nextTimestamp()` (`channel.ts:430`). Debt that could not be stamped earlier is stamped late "and says so only by the stamp's own timestamp" (`channel.ts:426-429`). Custody that cannot be stamped is carried as an `unattested` list on the channel record (`channel.ts:303-311`).
- **Substrate gap:** This is exactly the annotation pattern that SPEC-1 §6 and SPEC-6 §3 recommend but never specify: no vocabulary, no index, no binding to admission. Local writes get no arrival stamp. Only channel pulls do.
- **vNext candidate:** A federation-tier `rhizomatic.arrival` testimony, emitted at admission (SPEC-6 §5 step 4) for every ingest path, including local ones.
- **Class:** rhizomatic contract. **Tier:** federation. **Confidence:** CONFIRMED.

### 6. Since-last-looked uses author clocks, and a backdated claim can hide under the marker
- **Loam does:** `attentionSummaryImpl` skips `d.claims.timestamp <= lookedAt` (`src/gateway/attention.ts:265`). The comment at `attention.ts:20-24` and `spec/49-legibility.md:38-40` name the gap: "the honest close reads arrival attestations … named, deferred." The looked record stores `at` and the delta timestamp as two separate `nextTimestamp()` calls (`src/server/admin.ts:279`), so the moment is recorded twice.
- **Substrate gap:** No arrival time is available (same gap as entry 4).
- **vNext candidate:** Follows from entry 4 or 5. "Since" should mean arrival.
- **Class:** rhizomatic contract, with the use being Loam's. **Tier:** storage / federation. **Confidence:** CONFIRMED.

### 7. Admission has no timestamp check, so a future-dated delta wins latest-wins permanently
- **Loam does:** The append and federate doors verify signatures, tombstones and slates, but no path checks timestamp sanity (`src/gateway/ingest.ts:236-250`, `ingest.ts:645-660`). A grep for skew, backdating or "future" in `src/` found nothing. Law resolves by "ground order", meaning `(timestamp, id)` (`binding-policy.ts:156`, `registration.ts:1146`). The stock policy is `pick byTimestamp desc` (`src/stock/index.ts:70`). The REST `vN` aliases also come from ground order (`src/surface/rest.ts:69`).
- **Substrate gap:** SPEC-6 §5 step 3 lists "timestamp sanity windows" as local admission policy but defines no shape for them.
- **vNext candidate:** A standard admission predicate that rejects timestamps beyond arrival plus a skew bound. This works naturally once arrival time (c) exists.
- **Class:** decision for Myk (the policy), with the predicate shape in the federation tier. **Tier:** federation. **Confidence:** CONFIRMED that no check exists. The attack path is PLAUSIBLE (not exercised).

### 8. The slate `deadline` and `requested-at` are wall-clock times kept as primitives, beside the delta time
- **Loam does:** The slate record carries `requested-at` and `deadline` as primitives in wall-clock ms (`src/gateway/slate.ts:34-36`, `slate.ts:146`, `slate.ts:291-293`). The lapse is decided when a door is read, as `now > deadline` (`slate.ts:626`). `now` is required on the read seam, and callers supply `Date.now()` implicitly (`ingest.ts:243,311,495,653`, `erase.ts:963`, `gateway.ts:654,1482,1497`). `requested-at` exists only because the delta's timestamp cannot be trusted as creation time (entry 1).
- **Substrate gap:** There is no signed valid-until or self-expiry, and no trustworthy creation time (SPEC-1 §6).
- **vNext candidate:** With (a) trustworthy and an optional signed valid-until, `requested-at` could become the delta's creation time. The deadline would stay a Loam primitive: it is a compliance deadline, not the claim expiring. The read-time lapse is Loam policy.
- **Class:** Loam policy, which depends on the delta-tier time split. **Tier:** delta / forgetting. **Confidence:** CONFIRMED.

### 9. The present-tense read path depends on the wall clock
- **Loam does:** `gatherImpl` and `resolvedNode` need `now` because of the slate lapse (`src/gateway/reads.ts:106-110`). `watchEntityImpl` defaults `nowAt` to `Date.now` (`reads.ts:525`). `readGrounds` defaults `now = Date.now()` (`erase.ts:427`), and `healthImpl` does the same (`erase.ts:1512`). The result is that one ground can resolve to different views at different wall times.
- **Substrate gap:** SPEC-5 resolution is a pure function of the ground. Loam's slate narrowing sits outside it, so the view depends on (ground, now).
- **vNext candidate:** None if this remains a Loam narrowing. If valid-until lands, "at moment M" becomes an explicit resolve input rather than an ambient one.
- **Class:** Loam policy. **Tier:** resolve. **Confidence:** CONFIRMED.

### 10. Capability grants never expire
- **Loam does:** An authority chain is "timeless: reachability, not arrival order" (`src/gateway/accounts.ts:304`). Grants, revocations and trust records carry only the delta timestamp. Nothing has a validity window. Expiry exists only off-ground, in session and OAuth files that use a monotonic clock (`src/server/session.ts:15-33`, `src/server/oauth-file.ts:151-160`).
- **Substrate gap:** There is no signed valid-until (SPEC-1 §6).
- **vNext candidate:** A signed valid-until would allow expiring grants in the ground. Whether to use it is a separate question.
- **Class:** decision for Myk. **Tier:** principal. **Confidence:** CONFIRMED.

### 11. The pulse law and `lastSyncedAt`
- **Loam does:** A quiet sync writes nothing (`src/federation/channel.ts:1682-1695`). Arrival stamps are skipped when nothing was accepted (`channel.ts:406-411`). `lastSyncedAt` is set with `gw.nextTimestamp()` (`channel.ts:1714`), so it is delta-time, not wall time. `soup-meter.ts:7-12` flags periodic writers from author `timestamp` gaps.
- **Substrate gap:** Liveness has no place except in deltas. The pulse law exists because "last polled" cannot live anywhere else. The arrival time (c) that a peer testifies to is the natural home for "last contact".
- **vNext candidate:** Peer-local arrival testimony (entry 5) could carry last contact, which removes the reason to stamp a pulse at all. Otherwise the pulse law stays Loam policy.
- **Class:** Loam policy. **Tier:** federation. **Confidence:** CONFIRMED.

### 12. `arrivalLog()` is used as a cursor; this part is correct
- **Loam does:** It uses `reactor.arrivalLog()` only as a high-water cursor for memos (`src/federation/local-channel-events.ts:64-79`, `src/gateway/container.ts:529`, `src/gateway/listing.ts:461`). It never uses the log for meaning. This matches SPEC-4 ERRATA V2 and §114.
- **vNext candidate:** None. Note that the order is per process and carries no time, so it cannot stand in for (c).
- **Class:** Loam policy. **Tier:** reactor. **Confidence:** CONFIRMED.

### 13. The renderer memo and the auth clocks are off-ground
- **Loam does:** The renderer memo `until` uses `Date.now()` (`src/gateway/renderers.ts:472,524`). The OAuth, session and CIMD TTLs use `performance.now()` (`oauth.ts:791,1459`, `session.ts:345`, `cimd.ts:255`). The wall-clock `issuedAt` and `registeredAt` fields are display only.
- **vNext candidate:** None. These are process caches and file state, not ground.
- **Class:** Loam policy. **Confidence:** CONFIRMED.

## Recording targets

These functions decide things from time or order. Their current outputs should be recorded over fixed corpora before anything moves. Corpora should include equal timestamps, future-dated and backdated deltas, and deltas from more than one author.

- **`readSlates(reactor, operator, now)`** (`src/gateway/slate.ts`). Needs an explicit `now`. The callers pass `Date.now()` implicitly: `ingest.ts:243,653`, `erase.ts:963`. Record each slate before and after its deadline.
- **`groundAsOfImpl(gw, asOf)`** and **`annotateImpl`** (`src/gateway/reads.ts:71,86`). Also record **`forgottenSince(reactor, operator, since)`** (`src/gateway/erase.ts:704`). Include a negation dated after `asOf`, and a tombstone.
- **`latestByKey`, `quietContainersImpl`, `readLookedImpl`, `attentionSummaryImpl`** (`src/gateway/attention.ts`). These have the first-seen tie problem. Record under two different ingest orders of the same set to show the order dependence.
- **The channel status reader** around `src/federation/channel.ts:505-570`. Same tie problem. Use two ingest orders.
- **`interpretBindingPolicy(candidates, mode, operator)`** (`src/gateway/binding-policy.ts`). Pure, with a `(timestamp, id)` tiebreak.
- **`readRegistrations` / `survivingCandidates`** (`src/gateway/registration.ts:1056,1134`). This is ground order, including the "first claimed" moment. Also record the REST `vN` aliasing (`src/surface/rest.ts:69`).
- **The earliest-revocation and tenant-winner pickers** (`src/gateway/accounts.ts:263-277, 363-390`).
- **`soupMeterImpl`** (`src/gateway/soup-meter.ts`). Needs streams of timestamps (periodic and irregular).
- **`egressWithheld(gw, now)` and `landsReadClosure(gw, batch, now)`** (`src/gateway/ingest.ts`). Implicit `Date.now()` at `ingest.ts:311,495`.
- **`readGrounds(gw, extra, now = Date.now())`** (`erase.ts:427`) and **`healthImpl(gw, now = Date.now())`** (`erase.ts:1512`). Both default to the wall clock; pin `now`.
- **`nextTimestamp`** (`gateway.ts:1408`) is not pure. Record its behaviour across a simulated restart with an earlier `Date.now()`, to show the reset to `lastMutationTs = 0`.
