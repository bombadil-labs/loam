# Admission, grants and trust: where Loam builds around rhizomatic

I read the code for every entry below, except where an entry is marked PLAUSIBLE. I did not edit any file.

## Entries

**1. Write standing is reused as strike trust (the conflation)**
- **Loam does:** the governed gather decides whose negations count with `lawfulStrikersJson` (`src/gateway/accounts.ts:178-210`). The trusted set is the operator plus the subject of every operator-minted grant at `loam:store`, whatever its verb. `governedGatherBody` uses it (`:215`), and so does `dataStruck` (`:231`, called from `adopt.ts:233,333` and `translate.ts:288`). spec/07 says write standing is "resource gating rather than truth gating". This lens turns it into truth gating for suppression. The named gap at `:171-176` shows the drift: a `register` or `federate` grantee becomes a trusted striker.
- **Substrate gap:** SPEC-6 §3 names two judgments, transport and claim. SPEC-2 §4.3 `mask(trust(Pred))` is a third one, "whose retractions bind", and SPEC-6 never names it. Loam had no guidance, so it filled that slot with its publish list.
- **vNext candidate:** name suppression trust as a separate judgment in federation and resolve, next to `byAuthorRank`. Loam then declares its strikers list on its own and stops deriving it from `write` grants.
- **Class:** decision for Myk (rhizomatic contract underneath it). **Tier:** forgetting / resolve. **Confidence:** CONFIRMED.

**2. The admission roster is exported as a read mask**
- **Loam does:** `trustRosterPred` (`trust.ts:150-176`) makes the `loam:trust` roster, which governs the federation door, into a predicate for `mask(trust)`. The header (`:17-19`) calls it "one live source of truth for the door and the lenses". No code in `src/` calls it. Only `test/federation/trust.test.ts:255` and the public index use it. It also ignores `mode`: under `open` the door admits everyone, but the mask still narrows to the roster.
- **Substrate gap:** SPEC-6 §3 says "Conflating these two is the classic federation design error."
- **vNext candidate:** none for rhizomatic. Delete it, or re-document it as a deliberate claim-trust choice.
- **Class:** Loam policy. **Tier:** federation. **Confidence:** CONFIRMED.

**3. Loam has four definitions of "who may strike law"**
- **Loam does:**
  - `lawfulNegated` (`registration.ts:815`) honours only the operator, recursively. About 30 call sites use it, including trust, binding policy, container, erase, public, budget and channel.
  - `struck`/`standsFor` (`accounts.ts:317-336`) also honours effective admins, through the full chain.
  - `lawfulStrikersJson(adminsOnly=true)` (`tenantSchemaFor`, `:287`) honours operator-minted admins, one link deep.
  - `lawfulStrikersJson(false)` honours any grantee, one link deep.
- **Result:** an admin can revoke a grant, but cannot strike a trust declaration, a registration or a tombstone. spec/07 says constitutional readers honour "the operator's, or an effective store admin's" strikes. That is true only for `grantHeld`.
- **Substrate gap:** the reactor has `negationsOf` but no "negated under trust Pred" query that uses its indexes. So Loam re-implements `mask(trust(author=op))` in the host 30 times, for H8 (full-scan) reasons.
- **vNext candidate:** in reactor/forgetting, add `negatedUnder(pred)` backed by indexes, with the same semantics as SPEC-2 §4.3 `mask(trust)`. Loam then keeps one declared strikers predicate for each kind of law.
- **Class:** rhizomatic contract, plus a decision for Myk on admin strike reach. **Tier:** reactor / forgetting. **Confidence:** CONFIRMED.

**4. Admission cannot express negation closure**
- **Loam does:** `federateImpl` (`ingest.ts:630-690`) runs a lawful pass, then the per-delta admit, then `withBatchNegationClosure` (`:423`), but only when the store's own policy drove admission. An explicit `admit` owns its own closure. The comment at `:628` points to rhizomatic#2.
- **Substrate gap:** SPEC-6 §5 step 3 defines admission as a per-delta `Pred`. H1 (operand-set negation) means a Pred that filters by author strands retractions. The spec has no admission form that is "a set plus the negation closure of what it admits".
- **vNext candidate:** in federation, add a normative closure step after the admission Pred, or define admission as a DSet term over the offer.
- **Class:** rhizomatic contract. **Tier:** federation. **Confidence:** CONFIRMED.

**5. The two doors run two different validator lists**
- **Loam does:** `authorize` (`accounts.ts:611-641`) chains 10 checks: constitutional, trust, binding-policy, public, artifact, budget, envelope, container, erase and slate. The federation door (`ingest.ts:664-679`) runs only public, artifact, erase (on tombstones only), slate and slateRefusal. Malformed grants, trust declarations, binding policies and container law therefore enter through federation. Loam relies on "foreign law is inert" plus distinct operator seeds (`ingest.ts:23-29`).
- That reliance fails at the admin chain. An effective admin's grant made elsewhere binds on arrival, because `grantHeld` roots it (`:421`) and never checks `constitutionalDefect`.
- **Substrate gap:** SPEC-6 §5 allows "admission shape-requirements" but gives no way to compose them. Each vocabulary's shape check is hand-wired at each door.
- **vNext candidate:** in federation, let one admission pipeline carry the shape validators of each vocabulary and apply it to both doors. A local append is then a degenerate admission.
- **Class:** rhizomatic contract, plus Loam policy for which checks apply. **Tier:** federation. **Confidence:** CONFIRMED (the divergence). PLAUSIBLE that it is exploitable.

**6. Two derivations of the same grant fact disagree**
- **Loam does:** `grantsHeldBy` (`:447-488`) skips grants with a `constitutionalDefect` and refuses a `register` grant that an admin minted. `grantHeld` (`:398-425`), which backs `authorize` and `holdsGrant`, does neither: last subject wins, and a register grant can come through the admin chain. In `src/` today, `holdsGrant` is called only with `write` or `admin`, so the register gap cannot be reached yet.
- **vNext candidate:** none. It is a Loam defect to fix before extraction.
- **Class:** Loam policy. **Tier:** principal. **Confidence:** CONFIRMED.

**7. Recursive trust closure: only route (a) exists**
- **Loam does:** `grantHeld` and `tenantOfWith` walk the chain in the host, recursing to the operator. This is SPEC-2 §3.1 route (a), it is not cached, and §28.6 requires that. The in-lens sets reach one link only (`accounts.ts:158-165`). Route (b) is not built: `src/` has no `rhizomatic.derived.from` emitter, although §28.6 says "Run both".
- **Substrate gap:** none, because SPEC-2 §3.1 sanctions both routes. The gap is that the host walk has no standard shape.
- **vNext candidate:** in principal/derivation, ship a reference chain-flattener (route a) and a closure derived author (route b), so each host stops writing its own.
- **Class:** rhizomatic contract. **Tier:** derivation / principal. **Confidence:** CONFIRMED.

**8. The container governing key is always the root operator**
- **Loam does:** `containerAdmission` → `readTrustPolicyAt(reactor, container, operator)` (`container.ts:734`, `trust.ts:111`) takes law only from `lawfulDeltasAt(... operator)`. §28.6 recommends "admin standing in that container, recursing". That is not built. Also, no door in `src/` calls `containerAdmission`. A separate pool enforces its own root `loam:trust` through `admitForImpl`.
- **Substrate gap:** the settled ruling says a peer has a governing key pair. Loam instead passes one `operator?` string through every function, and `undefined` means ungoverned.
- **vNext candidate:** in federation, make the peer carry its governing key. Loam's operator is then the root peer's key, and a container's admission reads its own peer's key.
- **Class:** decision for Myk. **Tier:** federation. **Confidence:** CONFIRMED.

**9. Grants name raw keys**
- **Loam does:** a grant's `subject` is a primitive string compared against `claims.author` (`accounts.ts:407-412`). Revoking or rotating a key means a new grant.
- **Substrate gap:** SPEC-6 §9 leaves "key B succeeds key A" open. The principal tier (key→who) does not exist yet.
- **vNext candidate:** grants name a principal, and graded key→principal resolution happens at check time. This is optional, per the ruling.
- **Class:** decision for Myk. **Tier:** principal. **Confidence:** CONFIRMED (the code). The fit is PLAUSIBLE.

**10. The binding contest is a hand-written Schema**
- **Loam does:** `interpretBindingPolicy` (`binding-policy.ts:173-220`) first picks the latest version per (entity, lens). It then applies `byTimestamp`, or "operator's own else all, then latest", or `conflicts`. Those are `pick(byTimestamp desc)`, `pick(chain([byAuthorRank([op]), byTimestamp desc]))` and `conflicts`. `readBindingPolicy` is another copy of the latest-surviving reader. This is claim trust, so it sits on the correct side of SPEC-6 §3.
- **Substrate gap:** SPEC-5 §3 Policies run only inside `resolve` over a HyperView. There is no entry point to apply a Policy to an arbitrary candidate list.
- **vNext candidate:** in resolve, export `applyPolicy(policy, candidates)`.
- **Class:** rhizomatic contract. **Tier:** resolve. **Confidence:** CONFIRMED.

**11. The same "latest surviving declaration" reader is copied at each site**
- **Loam does:** the same logic appears in `readTrustPolicyAt` (`trust.ts:116-141`), `readBindingPolicy` and the public, budget and envelope readers: `lawfulDeltasAt`, then `lawfulNegated`, then max by (timestamp, id).
- **vNext candidate:** in resolve/schema, this is `pick(byTimestamp desc)` over a governed gather at a config entity. A "config entity" helper would remove the copies.
- **Class:** Loam policy on rhizomatic resolve. **Tier:** resolve. **Confidence:** CONFIRMED (trust and binding). PLAUSIBLE (the others).

**12. Tenancy machinery is mostly dead weight**
- **Loam does:** `tenantOf` and `membershipClaims` have no caller in `src/` beyond the public index. `authorize` checks standing only at `loam:store` (`:630`). Container trust (§28.7) keeps the vocabulary.
- **vNext candidate:** none. Decide whether to keep it before extraction.
- **Class:** decision for Myk. **Tier:** principal. **Confidence:** CONFIRMED.

**13. Loam uses "trust" for three different things**
- **Loam does:** the word "trust" names three things. The `loam:trust` mode is open, roster or closed. The container declaration's `trust` is curated or untrusted (`container.ts:253-255`). The mask policy `{trust: Pred}` is the third.
- **vNext candidate:** vocabulary hygiene. Use `admission` for the door and `trust` only for the claim or suppression judgments.
- **Class:** Loam policy. **Tier:** federation. **Confidence:** CONFIRMED.

**14. Pure checks that could become a library now**
- **Loam does:** `fenceAdmits` (`:89`) and the `federate` scope rule (whole-name match, `:494`) are pure string rules. The verb lattice ("admin covers write, never register", `:411`) and `constitutionalDefect`/`trustDefect` are pure shape checks.
- **vNext candidate:** a principal-tier capability library covering the verb lattice, scoped verbs and shape checks. The verbs themselves stay `loam.*`.
- **Class:** Loam policy (the content) on a reusable shape. **Tier:** principal. **Confidence:** CONFIRMED.

## Recording targets

These need fixed-corpus recordings before anything moves. Each "reactor corpus" needs the reactor to answer `byTarget`, `negationsOf`, `get` and `snapshot`.

- **`authorize(reactor, delta, operator?)`**, `src/gateway/accounts.ts:611`. Ambient reads: the whole defect chain, including `containerDefect`, `eraseDefect` and `slateDefect` against the reactor. Record the verdict and the refusal string.
- **`grantHeld` / `holdsGrant(reactor, tenant, author, verb, operator?)`**, `accounts.ts:515`. Record every verb against a corpus that contains: an admin chain, a cycle of self-appointed admins, an admin-minted register grant, a malformed grant, and a struck strike.
- **`grantsHeldBy(reactor, author, operator?)`**, `:447`. Use the same corpus, to pin the divergence in entry 6. `registerPrefixesOf` and `federateContainersOf` derive from it.
- **`honoredStrikeOn(reactor, id, operator?)`**, `:259`.
- **`tenantOf(reactor, entity, operator?)`**, `:429`.
- **`dataStruck(reactor, operator?)`**, `:231`. It returns a closure, so record the output for each id. It evaluates `mask(trust(lawfulStrikersJson))`.
- **`constitutionalDefect(delta)`**, **`trustDefect(claims)`**, **`bindingPolicyDefect(claims)`** and **`fenceAdmits(prefix, name)`**. These are pure. Use shape-fuzz corpora and prefix/name pairs: empty, bare, fullwidth, case.
- **`readTrustPolicyAt(reactor, subject, operator?)`**, `trust.ts:111`. The corpus needs: no declaration, struck latest, a timestamp tie, a malformed mode that still carries a roster, and an ungoverned store.
- **`admitForImpl(gw)`**, `ingest.ts:327`. It needs a gateway with `reactor` and `operatorAuthor`. Also record **`withBatchNegationClosure(batch, admitted)`**, which is pure.
- **`federateImpl`** admission partitions (lawful vs admitted vs crossed), as a report over offered batches. Ambient reads: `readTombstones`, and `readSlates(..., Date.now())`, so the clock must be pinned.
- **`interpretBindingPolicy(candidates, mode, operator?)`**, `binding-policy.ts:173`. It is pure. The corpus is the candidate lists in `test/gateway/binding-equivalence.test.ts`. That file pins only the extraction step (H10), so the contest outputs need their own recording.
- **`trustRosterPred(operator)`** and **`lawfulStrikersJson` via `governedGatherBody`/`tenantSchemaFor`**. Record the JSON bytes. A gather body's bytes are part of its identity, so any change moves exported hashes.
